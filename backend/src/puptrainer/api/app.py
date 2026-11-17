"""The FastAPI application."""

import hashlib
import hmac
import math
import time
from collections.abc import AsyncIterator, Iterator, Sequence
from contextlib import asynccontextmanager
from datetime import UTC, datetime, timedelta
from typing import Annotated, Any

import numpy as np
from fastapi import (
    APIRouter,
    Depends,
    FastAPI,
    File,
    Form,
    HTTPException,
    Query,
    Request,
    Response,
    UploadFile,
)
from fastapi.exceptions import RequestValidationError
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles
from pydantic import ValidationError
from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session, selectinload, sessionmaker
from starlette.exceptions import HTTPException as StarletteHTTPException
from starlette.types import Scope

from puptrainer import __version__
from puptrainer.api.db import (
    AnalysisJob,
    AnalysisSeries,
    Device,
    MetricValue,
    Take,
    make_engine,
    migrate,
    now,
    snapshot_if_stale,
)
from puptrainer.api.storage import AudioStore, InvalidAudioError
from puptrainer.core.content import load_content, load_metrics
from puptrainer.core.metrics import KEYS
from puptrainer.core.schemas import (
    AnalysisOut,
    Content,
    Details,
    DeviceIn,
    DeviceOut,
    ErrorOut,
    Health,
    Intent,
    Item,
    JobClaim,
    JobFailure,
    JobResult,
    JobStatus,
    Login,
    MetricDef,
    Requeued,
    Series,
    SessionOut,
    TakeMeta,
    TakeOut,
    TakePatch,
    WorkerHello,
)
from puptrainer.core.settings import Settings

ERRORS: dict[int | str, dict[str, object]] = {
    code: {"model": ErrorOut} for code in (400, 401, 404, 409, 422)
}

SESSION_COOKIE = "puptrainer_session"
SESSION_SECONDS = 365 * 24 * 3600


def database(request: Request) -> Iterator[Session]:
    """A database session for one request."""
    with request.app.state.sessions() as db:
        yield db


Db = Annotated[Session, Depends(database)]


# NOTE: what `take_out` reads; a series' data column is deferred and stays unloaded
TAKE_LOAD = (
    selectinload(Take.jobs).selectinload(AnalysisJob.metrics),
    selectinload(Take.jobs).selectinload(AnalysisJob.series),
)


class SpaFiles(StaticFiles):
    """The built web app: unknown paths get `index.html`, the client routes them."""

    async def get_response(self, path: str, scope: Scope) -> Response:
        """Serve the file at `path`, or the app shell when there is none."""
        try:
            return await super().get_response(path, scope)
        except StarletteHTTPException as exc:
            if exc.status_code != 404:
                raise
            return await super().get_response("index.html", scope)


def take_out(take: Take) -> TakeOut:
    """A take as the API returns it: labels, the latest job, the newest finished results."""
    latest = take.jobs[-1] if take.jobs else None
    done = next((j for j in reversed(take.jobs) if j.status == JobStatus.DONE), None)
    return TakeOut(
        id=take.id,
        created_at=take.created_at,
        recorded_at=take.recorded_at,
        device_id=take.device_id,
        device_name=take.device.name,
        item=Item(take.item),
        intent=Intent(take.intent),
        language=take.language,
        content_ref=take.content_ref,
        note=take.note,
        original_name=take.original_name,
        sha256=take.sha256,
        sample_rate=take.sample_rate,
        channels=take.channels,
        duration_s=take.duration_s,
        analysis=None
        if latest is None
        else AnalysisOut(
            status=JobStatus(latest.status),
            pipeline_version=latest.pipeline_version,
            error=latest.error,
            finished_at=latest.finished_at,
        ),
        metrics={} if done is None else {m.key: m.value for m in done.metrics},
        details=Details.model_validate_json(done.details)
        if done is not None and done.details
        else Details(),
        series=[] if done is None else sorted(s.key for s in done.series),
    )


def create_app(settings: Settings | None = None) -> FastAPI:
    """Build the application: open the database, migrate it, load the content.

    Args:
        settings: Configuration; read from the environment when omitted.

    Returns:
        The app, serving the API under `/api/v1` and, when `settings.web_dir` is set, the
        built web app everywhere else.

    Raises:
        FileNotFoundError: The content directory does not exist.
        ValueError: The content files are malformed.
    """
    settings = settings or Settings()
    settings.data_dir.mkdir(parents=True, exist_ok=True)
    # NOTE: labels and devices cannot be recomputed: a copy of the database is kept from
    # each day it is opened, and one from before every change of its schema
    snapshot_if_stale(settings.database_path, settings.backup_dir)
    engine = make_engine(settings.database_path)
    migrate(engine, settings.backup_dir)
    sessions = sessionmaker(engine, expire_on_commit=False)
    store = AudioStore(settings.audio_dir)
    content = load_content(settings.content_dir)
    metric_defs = load_metrics(settings.content_dir)
    content_refs = {f"passage:{p.id}@{p.version}" for p in content.passages}

    @asynccontextmanager
    async def lifespan(_app: FastAPI) -> AsyncIterator[None]:
        yield
        # NOTE: closing the last connection folds the write-ahead log into the database file
        engine.dispose()

    app = FastAPI(
        title="puptrainer",
        lifespan=lifespan,
        version=__version__,
        docs_url="/api/docs",
        redoc_url=None,
        openapi_url="/api/openapi.json",
        # NOTE: one schema per model, so the generated TypeScript types have one name each
        separate_input_output_schemas=False,
    )
    app.state.worker_seen = None
    app.state.pipeline_version = None

    # --- access: open without a token (localhost only), else a bearer token (the worker)
    # or the cookie a sign-in sets (the web app, whose <audio> cannot send a header)
    token = settings.access_token
    # NOTE: the cookie holds a value derived from the token, never the token itself
    cookie_value = (
        None if token is None else hashlib.sha256(f"{token}|session".encode()).hexdigest()
    )

    def signed_in(request: Request) -> bool:
        if token is None or cookie_value is None:
            return True
        header = request.headers.get("authorization", "")
        if header.startswith("Bearer ") and hmac.compare_digest(header[7:], token):
            return True
        return hmac.compare_digest(request.cookies.get(SESSION_COOKIE, ""), cookie_value)

    def guard(request: Request) -> None:
        if not signed_in(request):
            raise HTTPException(401, "this puptrainer asks for its access token")

    public = APIRouter(prefix="/api/v1", responses=ERRORS)

    @public.get("/session", operation_id="session")
    def session_state(request: Request) -> SessionOut:
        return SessionOut(login_required=token is not None, signed_in=signed_in(request))

    @public.post("/login", status_code=204, operation_id="login")
    def login(body: Login, request: Request, response: Response) -> None:
        if token is None or cookie_value is None:
            return
        if not hmac.compare_digest(body.token.strip(), token):
            raise HTTPException(401, "that token was not accepted")
        secure = (
            request.url.scheme == "https" or request.headers.get("x-forwarded-proto") == "https"
        )
        response.set_cookie(
            SESSION_COOKIE,
            cookie_value,
            max_age=SESSION_SECONDS,
            httponly=True,
            samesite="strict",
            secure=secure,
        )

    @public.post("/logout", status_code=204, operation_id="logout")
    def logout(response: Response) -> None:
        response.delete_cookie(SESSION_COOKIE)

    app.state.engine = engine
    app.state.sessions = sessions

    @app.exception_handler(StarletteHTTPException)
    async def _http_error(_request: object, exc: StarletteHTTPException) -> JSONResponse:
        return JSONResponse({"error": str(exc.detail)}, status_code=exc.status_code)

    @app.exception_handler(RequestValidationError)
    async def _validation_error(_request: object, exc: RequestValidationError) -> JSONResponse:
        return JSONResponse({"error": describe(exc.errors())}, status_code=422)

    router = APIRouter(prefix="/api/v1", responses=ERRORS, dependencies=[Depends(guard)])

    def get_take(db: Session, take_id: str) -> Take:
        take = db.scalar(select(Take).where(Take.id == take_id).options(*TAKE_LOAD))
        if take is None:
            raise HTTPException(404, "no such take")
        return take

    def check_labels(db: Session, device_id: int | None, content_ref: str | None) -> None:
        if device_id is not None and db.get(Device, device_id) is None:
            raise HTTPException(422, "no such device")
        if content_ref is not None and content_ref not in content_refs:
            raise HTTPException(422, f"unknown content reference: {content_ref}")

    # --- health, content ---

    @public.get("/health", operation_id="health")
    def health(db: Db) -> Health:
        pending = db.scalar(
            select(func.count())
            .select_from(AnalysisJob)
            .where(AnalysisJob.status.in_([JobStatus.PENDING, JobStatus.CLAIMED]))
        )
        seen = app.state.worker_seen
        return Health(
            status="ok",
            version=__version__,
            pending_jobs=pending or 0,
            worker_seen_s=None if seen is None else time.monotonic() - seen,
            pipeline_version=app.state.pipeline_version,
        )

    @router.get("/content", operation_id="content")
    def get_content() -> Content:
        return content

    @router.get("/metrics", operation_id="metrics")
    def get_metrics() -> list[MetricDef]:
        return metric_defs

    # --- devices ---

    @router.get("/devices", operation_id="listDevices")
    def list_devices(db: Db) -> list[DeviceOut]:
        return [DeviceOut.model_validate(d) for d in db.scalars(select(Device).order_by(Device.id))]

    @router.post("/devices", status_code=201, operation_id="createDevice")
    def create_device(body: DeviceIn, db: Db) -> DeviceOut:
        device = Device(name=body.name.strip(), kind=body.kind, note=body.note)
        db.add(device)
        try:
            db.commit()
        except IntegrityError:
            raise HTTPException(409, "a device with this name exists") from None
        return DeviceOut.model_validate(device)

    @router.put("/devices/{device_id}", operation_id="updateDevice")
    def update_device(device_id: int, body: DeviceIn, db: Db) -> DeviceOut:
        device = db.get(Device, device_id)
        if device is None:
            raise HTTPException(404, "no such device")
        device.name, device.kind, device.note = body.name.strip(), body.kind, body.note
        try:
            db.commit()
        except IntegrityError:
            raise HTTPException(409, "a device with this name exists") from None
        return DeviceOut.model_validate(device)

    # --- takes ---

    @router.post(
        "/takes",
        status_code=201,
        operation_id="createTake",
        responses={200: {"model": TakeOut, "description": "Already stored under this client id"}},
    )
    def create_take(
        db: Db,
        response: Response,
        file: Annotated[UploadFile, File(description="The recording, WAV or FLAC")],
        meta: Annotated[str, Form(description="The labels, a JSON `TakeMeta`")],
    ) -> TakeOut:
        try:
            labels = TakeMeta.model_validate_json(meta)
        except ValidationError as exc:
            raise HTTPException(422, describe(exc.errors())) from None
        if labels.client_id is not None:
            # NOTE: a retry of an upload whose answer never arrived (reload, lost network)
            known = db.scalar(select(Take.id).where(Take.client_id == labels.client_id))
            if known is not None:
                response.status_code = 200
                return take_out(get_take(db, known))
        check_labels(db, labels.device_id, labels.content_ref)
        try:
            info = store.ingest(file.file.read())
        except InvalidAudioError as exc:
            raise HTTPException(400, str(exc)) from None
        take = Take(
            recorded_at=as_utc(labels.recorded_at) if labels.recorded_at else now(),
            device_id=labels.device_id,
            item=labels.item,
            intent=labels.intent,
            language=labels.language,
            content_ref=labels.content_ref,
            note=labels.note,
            original_name=(file.filename or "")[:255],
            client_id=labels.client_id,
            sha256=info.sha256,
            sample_rate=info.sample_rate,
            channels=info.channels,
            duration_s=info.duration_s,
        )
        take.jobs.append(AnalysisJob(status=JobStatus.PENDING))
        db.add(take)
        db.commit()
        return take_out(get_take(db, take.id))

    @router.get("/takes", operation_id="listTakes")
    def list_takes(
        db: Db,
        item: Item | None = None,
        intent: Intent | None = None,
        language: str | None = None,
        device_id: int | None = None,
        limit: Annotated[int, Query(ge=1, le=1000)] = 200,
        offset: Annotated[int, Query(ge=0)] = 0,
    ) -> list[TakeOut]:
        query = select(Take).options(*TAKE_LOAD)
        if item is not None:
            query = query.where(Take.item == item)
        if intent is not None:
            query = query.where(Take.intent == intent)
        if language is not None:
            query = query.where(Take.language == language)
        if device_id is not None:
            query = query.where(Take.device_id == device_id)
        query = query.order_by(Take.recorded_at.desc(), Take.id).limit(limit).offset(offset)
        return [take_out(t) for t in db.scalars(query)]

    @router.get("/takes/{take_id}", operation_id="getTake")
    def read_take(take_id: str, db: Db) -> TakeOut:
        return take_out(get_take(db, take_id))

    @router.patch("/takes/{take_id}", operation_id="updateTake")
    def update_take(take_id: str, body: TakePatch, db: Db) -> TakeOut:
        take = get_take(db, take_id)
        changes = body.model_dump(exclude_unset=True)
        check_labels(db, changes.get("device_id"), changes.get("content_ref"))
        for field in ("device_id", "item", "intent", "recorded_at", "note"):
            if field in changes and changes[field] is None:
                raise HTTPException(422, f"{field} cannot be empty")
        if "recorded_at" in changes:
            changes["recorded_at"] = as_utc(changes["recorded_at"])
        for field, value in changes.items():
            setattr(take, field, value)
        db.commit()
        db.expire(take)
        return take_out(get_take(db, take_id))

    @router.delete("/takes/{take_id}", status_code=204, operation_id="deleteTake")
    def delete_take(take_id: str, db: Db) -> Response:
        take = get_take(db, take_id)
        sha256 = take.sha256
        db.delete(take)
        db.commit()
        if db.scalar(select(func.count()).select_from(Take).where(Take.sha256 == sha256)) == 0:
            store.delete(sha256)
        return Response(status_code=204)

    @router.get("/takes/{take_id}/audio", operation_id="takeAudio", response_class=FileResponse)
    def take_audio(take_id: str, db: Db) -> FileResponse:
        take = get_take(db, take_id)
        path = store.path(take.sha256)
        if not path.exists():
            raise HTTPException(404, "the recording is missing from storage")
        return FileResponse(path, media_type="audio/flac", filename=f"{take.id}.flac")

    @router.post("/takes/{take_id}/analysis", status_code=202, operation_id="analyseTake")
    def analyse_take(take_id: str, db: Db) -> TakeOut:
        take = get_take(db, take_id)
        if not take.jobs or take.jobs[-1].status in (JobStatus.DONE, JobStatus.FAILED):
            take.jobs.append(AnalysisJob(status=JobStatus.PENDING))
            db.commit()
        return take_out(get_take(db, take_id))

    @router.get("/takes/{take_id}/series/{key}", operation_id="takeSeries")
    def take_series(take_id: str, key: str, db: Db) -> Series:
        take = get_take(db, take_id)
        done = next((j for j in reversed(take.jobs) if j.status == JobStatus.DONE), None)
        stored = next((s for s in done.series if s.key == key), None) if done else None
        if stored is None:
            raise HTTPException(404, "no such series for this take")
        values = np.frombuffer(stored.data, dtype="<f4")
        return Series(
            start_s=stored.start_s,
            step_s=stored.step_s,
            values=[None if np.isnan(v) else round(float(v), 2) for v in values],
        )

    @router.post("/analysis/requeue", operation_id="requeueAnalysis")
    def requeue(db: Db, pipeline_version: str | None = None) -> Requeued:
        """Queue takes for analysis again.

        With `pipeline_version`, only takes whose newest finished analysis ran another
        version (or that have none) are queued; without it, every take is. A take with
        a job already waiting or running is left alone.
        """
        queued = 0
        for take in db.scalars(select(Take).options(selectinload(Take.jobs))):
            latest = take.jobs[-1] if take.jobs else None
            if latest is not None and latest.status in (JobStatus.PENDING, JobStatus.CLAIMED):
                continue
            done = next((j for j in reversed(take.jobs) if j.status == JobStatus.DONE), None)
            current = done is not None and done.pipeline_version == pipeline_version
            if pipeline_version is not None and current:
                continue
            take.jobs.append(AnalysisJob(status=JobStatus.PENDING))
            queued += 1
        db.commit()
        return Requeued(queued=queued)

    # --- the worker's queue ---

    @router.post(
        "/worker/jobs/claim",
        operation_id="claimJob",
        response_model=JobClaim,
        responses={204: {"description": "The queue is empty"}},
    )
    def claim_job(db: Db, hello: WorkerHello | None = None) -> JobClaim | Response:
        app.state.worker_seen = time.monotonic()
        if hello is not None:
            app.state.pipeline_version = hello.pipeline_version
        stale = datetime.now(UTC) - timedelta(seconds=settings.job_timeout_s)
        for job in db.scalars(
            select(AnalysisJob).where(
                AnalysisJob.status == JobStatus.CLAIMED, AnalysisJob.claimed_at < stale
            )
        ):
            job.status, job.claimed_at = JobStatus.PENDING, None
        job = db.scalar(
            select(AnalysisJob)
            .where(AnalysisJob.status == JobStatus.PENDING)
            .order_by(AnalysisJob.id)
            .limit(1)
        )
        if job is None:
            db.commit()
            return Response(status_code=204)
        job.status, job.claimed_at = JobStatus.CLAIMED, now()
        db.commit()
        return JobClaim(
            job_id=job.id,
            take_id=job.take_id,
            item=Item(job.take.item),
            audio_path=f"/api/v1/takes/{job.take_id}/audio",
        )

    def claimed_job(db: Session, job_id: int) -> AnalysisJob:
        job = db.get(AnalysisJob, job_id)
        if job is None:
            raise HTTPException(404, "no such job")
        if job.status != JobStatus.CLAIMED:
            raise HTTPException(409, f"the job is {job.status}, not claimed")
        return job

    @router.post("/worker/jobs/{job_id}/complete", status_code=204, operation_id="completeJob")
    def complete_job(job_id: int, body: JobResult, db: Db) -> Response:
        job = claimed_job(db, job_id)
        unknown = sorted(set(body.metrics) - KEYS)
        if unknown:
            raise HTTPException(422, f"metrics not in the registry: {', '.join(unknown)}")
        if not all(math.isfinite(v) for v in body.metrics.values()):
            raise HTTPException(422, "metric values must be finite numbers")
        job.status, job.finished_at = JobStatus.DONE, now()
        job.pipeline_version, job.error = body.pipeline_version, None
        job.metrics = [MetricValue(key=k, value=v) for k, v in body.metrics.items()]
        job.details = body.details.model_dump_json()
        job.series = [
            AnalysisSeries(
                key=key,
                start_s=series.start_s,
                step_s=series.step_s,
                data=np.array(
                    [np.nan if v is None else v for v in series.values], dtype="<f4"
                ).tobytes(),
            )
            for key, series in body.series.items()
        ]
        db.commit()
        return Response(status_code=204)

    @router.post("/worker/jobs/{job_id}/fail", status_code=204, operation_id="failJob")
    def fail_job(job_id: int, body: JobFailure, db: Db) -> Response:
        job = claimed_job(db, job_id)
        job.status, job.finished_at = JobStatus.FAILED, now()
        job.pipeline_version, job.error = body.pipeline_version, body.error
        db.commit()
        return Response(status_code=204)

    app.include_router(public)
    app.include_router(router)

    @app.api_route(
        "/api/{path:path}",
        methods=["GET", "POST", "PUT", "PATCH", "DELETE"],
        include_in_schema=False,
    )
    def _no_such_endpoint(path: str) -> None:
        raise HTTPException(404, f"no such endpoint: /api/{path}")

    if settings.web_dir is not None:
        app.mount("/", SpaFiles(directory=settings.web_dir, html=True), name="web")

    return app


def as_utc(moment: datetime) -> datetime:
    """A datetime in UTC; one without an offset is taken as UTC."""
    return moment.replace(tzinfo=UTC) if moment.tzinfo is None else moment.astimezone(UTC)


def describe(errors: Sequence[Any]) -> str:
    """One line for a list of pydantic validation errors."""
    parts = []
    for error in errors:
        where = ".".join(str(p) for p in error.get("loc", ()) if p not in ("body", "query"))
        parts.append(f"{where}: {error.get('msg', 'invalid')}" if where else error.get("msg", ""))
    return "; ".join(parts) or "invalid request"
