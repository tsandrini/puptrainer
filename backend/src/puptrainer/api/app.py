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
    Path,
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
    Person,
    PracticeSession,
    Take,
    TargetBand,
    make_engine,
    migrate,
    now,
    snapshot_if_stale,
)
from puptrainer.api.storage import AudioStore, InvalidAudioError
from puptrainer.core.content import load_content, load_measures, load_metrics, parse_ref
from puptrainer.core.evaluation import TakeFacts, evaluate, needs_pitch
from puptrainer.core.metrics import KEYS
from puptrainer.core.reading import Voice, comparable, read, reference
from puptrainer.core.schemas import (
    AnalysisOut,
    BandIn,
    BandOut,
    Content,
    Details,
    DeviceIn,
    DeviceOut,
    ErrorOut,
    Exercise,
    Feel,
    Health,
    Intent,
    Item,
    JobClaim,
    JobFailure,
    JobResult,
    JobStatus,
    Login,
    MeasureDef,
    MetricDef,
    PersonIn,
    PersonOut,
    PracticeIn,
    PracticeOut,
    Reading,
    Reference,
    Requeued,
    Series,
    SessionOut,
    TakeMeta,
    TakeOut,
    TakePatch,
    Target,
    Trace,
    WorkerHello,
)
from puptrainer.core.settings import Settings
from puptrainer.core.trace import trace

ERRORS: dict[int | str, dict[str, object]] = {
    code: {"model": ErrorOut} for code in (400, 401, 404, 409, 422)
}

PRACTICE_ID = r"^[A-Za-z0-9-]{8,64}$"
SESSION_COOKIE = "puptrainer_session"
SESSION_SECONDS = 365 * 24 * 3600


def database(request: Request) -> Iterator[Session]:
    """A database session for one request."""
    with request.app.state.sessions() as db:
        yield db


Db = Annotated[Session, Depends(database)]
PracticeId = Annotated[str, Path(pattern=PRACTICE_ID)]


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


def decode_series(stored: AnalysisSeries) -> list[float | None]:
    """A stored series' values, `None` where nothing was measured."""
    values = np.frombuffer(stored.data, dtype="<f4")
    return [None if np.isnan(v) else round(float(v), 2) for v in values]


def finished(take: Take) -> AnalysisJob | None:
    """The newest finished analysis of a take."""
    return next((j for j in reversed(take.jobs) if j.status == JobStatus.DONE), None)


def details_of(job: AnalysisJob | None) -> Details:
    """The structured findings of an analysis; empty without one."""
    return (
        Details.model_validate_json(job.details) if job is not None and job.details else Details()
    )


def voice_of(take: Take) -> Voice | None:
    """A take as a reading sees it; `None` until it is analysed."""
    done = finished(take)
    if done is None:
        return None
    return Voice(
        id=take.id,
        item=Item(take.item),
        language=take.language,
        content_ref=take.content_ref,
        recorded_at=take.recorded_at,
        metrics={m.key: m.value for m in done.metrics},
        vowels=details_of(done).vowels,
    )


def take_out(
    take: Take,
    exercises: dict[str, Exercise] | None = None,
    reading: Reading | None = None,
) -> TakeOut:
    """A take as the API returns it: labels, the latest job, the newest finished results.

    Args:
        take: The take, with its jobs, their metrics and series loaded.
        exercises: The catalogue by id, to judge a practice take; without it, or for a
            take of no exercise, there is no evaluation.
        reading: The take read against the default person's everyday voice, if it can be.
    """
    latest = take.jobs[-1] if take.jobs else None
    done = finished(take)
    details = details_of(done)
    target = Target.model_validate_json(take.target) if take.target else None
    evaluation = None
    if take.exercise_ref is not None and exercises is not None:
        parsed = parse_ref(take.exercise_ref, "exercise")
        exercise = exercises.get(parsed[0]) if parsed else None
        facts = TakeFacts(
            analysed=done is not None,
            metrics={} if done is None else {m.key: m.value for m in done.metrics},
            segments=details.segments,
            whisper=details.whisper,
            target=target,
            comfort=take.comfort,
        )
        contour = next((s for s in done.series if s.key == "pitch_hz"), None) if done else None
        if contour is not None and needs_pitch(exercise):
            facts.pitch, facts.step_s = decode_series(contour), contour.step_s
        evaluation = evaluate(take.exercise_ref, exercise, facts)
    return TakeOut(
        id=take.id,
        created_at=take.created_at,
        recorded_at=take.recorded_at,
        device_id=take.device_id,
        device_name=take.device.name,
        person_id=take.person_id,
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
        details=details,
        series=[] if done is None else sorted(s.key for s in done.series),
        client_id=take.client_id,
        session_id=take.session_id,
        exercise_ref=take.exercise_ref,
        target=target,
        comfort=take.comfort,
        evaluation=evaluation,
        reading=reading,
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
    measure_defs = load_measures(settings.content_dir)
    content_refs = {f"passage:{p.id}@{p.version}" for p in content.passages}
    exercises = {e.id: e for e in content.exercises}
    routines = {r.id: r for r in content.routines}

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

    def forget(db: Session, hashes: set[str]) -> None:
        """Delete the recordings no take points to any more."""
        for sha256 in hashes:
            left = db.scalar(select(func.count()).select_from(Take).where(Take.sha256 == sha256))
            if left == 0:
                store.delete(sha256)

    def learner(db: Session) -> Person:
        """The default person: the one whose everyday voice every take is read against."""
        return db.scalars(select(Person).where(Person.is_default)).one()

    def everyday(db: Session, device_id: int, cache: dict[int, list[Voice]]) -> list[Voice]:
        """The default person's analysed everyday lab takes on a microphone setup.

        What every take on the setup is read against, whoever's voice it is: the default
        person's takes labelled as the everyday voice and recorded in the lab, not for
        an exercise. Nobody else's take is ever part of it.
        """
        if device_id not in cache:
            query = (
                select(Take)
                .where(
                    Take.device_id == device_id,
                    Take.person_id == learner(db).id,
                    Take.intent == Intent.HABITUAL,
                    Take.exercise_ref.is_(None),
                )
                .options(selectinload(Take.jobs).selectinload(AnalysisJob.metrics))
            )
            voices = (voice_of(lab) for lab in db.scalars(query))
            cache[device_id] = [voice for voice in voices if voice is not None]
        return cache[device_id]

    def out(db: Session, take: Take, cache: dict[int, list[Voice]] | None = None) -> TakeOut:
        voices = everyday(db, take.device_id, {} if cache is None else cache)
        voice = None if take.intent == Intent.DRILL else voice_of(take)
        return take_out(take, exercises, None if voice is None else read(voice, voices))

    def known(ref: str, kind: str, catalogue: dict[str, Any]) -> None:
        # NOTE: the id must exist; an older version is fine (a take queued offline before
        # the catalogue was updated), a newer one is not
        parsed = parse_ref(ref, kind)
        if parsed is None or parsed[0] not in catalogue or parsed[1] > catalogue[parsed[0]].version:
            raise HTTPException(422, f"unknown {kind} reference: {ref}")

    def check_labels(
        db: Session,
        device_id: int | None,
        content_ref: str | None,
        session_id: str | None = None,
        exercise_ref: str | None = None,
        person_id: int | None = None,
    ) -> None:
        if device_id is not None and db.get(Device, device_id) is None:
            raise HTTPException(422, "no such device")
        if person_id is not None and db.get(Person, person_id) is None:
            raise HTTPException(422, "no such person")
        if content_ref is not None and content_ref not in content_refs:
            raise HTTPException(422, f"unknown content reference: {content_ref}")
        if session_id is not None and db.get(PracticeSession, session_id) is None:
            raise HTTPException(422, "no such practice session")
        if exercise_ref is not None:
            known(exercise_ref, "exercise", exercises)

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

    @router.get("/measures", operation_id="measures")
    def get_measures() -> list[MeasureDef]:
        return measure_defs

    # --- the pitch band ---

    @router.get("/bands", operation_id="listBands")
    def list_bands(db: Db) -> list[BandOut]:
        """Every band set so far, newest (the current one) first."""
        query = select(TargetBand).order_by(TargetBand.id.desc())
        return [BandOut.model_validate(b) for b in db.scalars(query)]

    @router.post("/bands", status_code=201, operation_id="createBand")
    def create_band(body: BandIn, db: Db) -> BandOut:
        current = db.scalar(select(TargetBand).order_by(TargetBand.id.desc()).limit(1))
        if current is not None and (current.low_hz, current.high_hz) == (body.low_hz, body.high_hz):
            # NOTE: setting the band it already is adds nothing to the history
            return BandOut.model_validate(current)
        band = TargetBand(low_hz=body.low_hz, high_hz=body.high_hz)
        db.add(band)
        db.commit()
        return BandOut.model_validate(band)

    # --- the everyday voice ---

    @router.get("/reference", operation_id="reference")
    def get_reference(
        db: Db,
        device_id: int,
        item: Item,
        language: str | None = None,
        content_ref: str | None = None,
    ) -> Reference | None:
        """The everyday voice a take of this kind on this setup is read against.

        `null` when there is no everyday take to read it against yet.
        """
        found = comparable(item, language, content_ref, everyday(db, device_id, {}))
        return None if found is None else reference(*found)

    # --- practice sessions ---

    def practice_out(db: Session, practice: PracticeSession) -> PracticeOut:
        count, last = db.execute(
            select(func.count(Take.id), func.max(Take.recorded_at)).where(
                Take.session_id == practice.id
            )
        ).one()
        return PracticeOut(
            id=practice.id,
            routine_ref=practice.routine_ref,
            language=practice.language,
            started_at=practice.started_at,
            ended_at=practice.ended_at,
            feel_start=None if practice.feel_start is None else Feel(practice.feel_start),
            comfort_end=practice.comfort_end,
            lasting_tension=practice.lasting_tension,
            note=practice.note,
            take_count=count,
            last_take_at=None if last is None else as_utc(last),
        )

    def get_practice(db: Session, practice_id: str) -> PracticeSession:
        practice = db.get(PracticeSession, practice_id)
        if practice is None:
            raise HTTPException(404, "no such practice session")
        return practice

    @router.get("/practice", operation_id="listPractice")
    def list_practice(
        db: Db, limit: Annotated[int, Query(ge=1, le=1000)] = 100
    ) -> list[PracticeOut]:
        """Practice sessions, the newest first."""
        query = select(PracticeSession).order_by(PracticeSession.started_at.desc()).limit(limit)
        return [practice_out(db, p) for p in db.scalars(query)]

    @router.get("/practice/{practice_id}", operation_id="getPractice")
    def read_practice(practice_id: PracticeId, db: Db) -> PracticeOut:
        return practice_out(db, get_practice(db, practice_id))

    @router.put("/practice/{practice_id}", operation_id="putPractice")
    def put_practice(practice_id: PracticeId, body: PracticeIn, db: Db) -> PracticeOut:
        """Create or replace a practice session; writing the same one again changes nothing."""
        if body.routine_ref is not None:
            known(body.routine_ref, "routine", routines)
        practice = db.get(PracticeSession, practice_id)
        if practice is None:
            practice = PracticeSession(id=practice_id)
            db.add(practice)
        practice.routine_ref = body.routine_ref
        practice.language = body.language
        practice.started_at = as_utc(body.started_at)
        practice.ended_at = None if body.ended_at is None else as_utc(body.ended_at)
        practice.feel_start = body.feel_start
        practice.comfort_end = body.comfort_end
        practice.lasting_tension = body.lasting_tension
        practice.note = body.note
        db.commit()
        return practice_out(db, practice)

    @router.delete("/practice/{practice_id}", status_code=204, operation_id="deletePractice")
    def delete_practice(practice_id: PracticeId, db: Db) -> Response:
        """Delete a practice session; its takes stay, no longer part of a session."""
        practice = get_practice(db, practice_id)
        for take in db.scalars(select(Take).where(Take.session_id == practice_id)):
            take.session_id = None
        db.flush()
        db.delete(practice)
        db.commit()
        return Response(status_code=204)

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

    # --- people ---

    def person_out(person: Person, takes: int) -> PersonOut:
        return PersonOut(
            id=person.id,
            name=person.name,
            note=person.note,
            is_default=person.is_default,
            created_at=person.created_at,
            take_count=takes,
        )

    def get_person(db: Session, person_id: int) -> Person:
        person = db.get(Person, person_id)
        if person is None:
            raise HTTPException(404, "no such person")
        return person

    def takes_of(db: Session, person_id: int) -> int:
        query = select(func.count()).select_from(Take).where(Take.person_id == person_id)
        return db.scalar(query) or 0

    @router.get("/people", operation_id="listPeople")
    def list_people(db: Db) -> list[PersonOut]:
        """Everyone whose voice is here; the default person first."""
        counts = {
            person_id: count
            for person_id, count in db.execute(
                select(Take.person_id, func.count()).group_by(Take.person_id)
            )
        }
        query = select(Person).order_by(Person.is_default.desc(), Person.id)
        return [person_out(p, counts.get(p.id, 0)) for p in db.scalars(query)]

    @router.post("/people", status_code=201, operation_id="createPerson")
    def create_person(body: PersonIn, db: Db) -> PersonOut:
        person = Person(name=body.name.strip(), note=body.note)
        db.add(person)
        try:
            db.commit()
        except IntegrityError:
            raise HTTPException(409, "a person with this name exists") from None
        return person_out(person, 0)

    @router.put("/people/{person_id}", operation_id="updatePerson")
    def update_person(person_id: int, body: PersonIn, db: Db) -> PersonOut:
        person = get_person(db, person_id)
        person.name, person.note = body.name.strip(), body.note
        try:
            db.commit()
        except IntegrityError:
            raise HTTPException(409, "a person with this name exists") from None
        return person_out(person, takes_of(db, person_id))

    @router.post("/people/{person_id}/default", operation_id="makeDefaultPerson")
    def make_default_person(person_id: int, db: Db) -> list[PersonOut]:
        """Make this person the default one; returns everyone.

        From then on every take is read against this person's everyday voice.
        """
        person = get_person(db, person_id)
        current = learner(db)
        if current.id != person.id:
            current.is_default = False
            # NOTE: the index allows one default person: the old one has to go first
            db.flush()
            person.is_default = True
            db.commit()
        return list_people(db)

    @router.delete("/people/{person_id}", status_code=204, operation_id="deletePerson")
    def delete_person(person_id: int, db: Db, takes: bool = False) -> Response:
        """Delete a person, and with `takes=true` their takes and recordings with them.

        Refused (409) for the default person, and for a person who has takes unless
        `takes=true` says they are to go too.
        """
        person = get_person(db, person_id)
        if person.is_default:
            raise HTTPException(409, "the default person stays: make someone else the default")
        theirs = list(db.scalars(select(Take).where(Take.person_id == person_id)))
        if theirs and not takes:
            raise HTTPException(409, f"this person has takes: {len(theirs)}")
        hashes = {take.sha256 for take in theirs}
        for take in theirs:
            db.delete(take)
        # NOTE: the takes have to be gone before the person they point to
        db.flush()
        db.delete(person)
        db.commit()
        forget(db, hashes)
        return Response(status_code=204)

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
            stored = db.scalar(select(Take.id).where(Take.client_id == labels.client_id))
            if stored is not None:
                response.status_code = 200
                return out(db, get_take(db, stored))
        check_labels(
            db,
            labels.device_id,
            labels.content_ref,
            labels.session_id,
            labels.exercise_ref,
            labels.person_id,
        )
        try:
            info = store.ingest(file.file.read())
        except InvalidAudioError as exc:
            raise HTTPException(400, str(exc)) from None
        take = Take(
            recorded_at=as_utc(labels.recorded_at) if labels.recorded_at else now(),
            device_id=labels.device_id,
            person_id=learner(db).id if labels.person_id is None else labels.person_id,
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
            session_id=labels.session_id,
            exercise_ref=labels.exercise_ref,
            target=None if labels.target is None else labels.target.model_dump_json(),
            comfort=labels.comfort,
        )
        take.jobs.append(AnalysisJob(status=JobStatus.PENDING))
        db.add(take)
        db.commit()
        return out(db, get_take(db, take.id))

    @router.get("/takes", operation_id="listTakes")
    def list_takes(
        db: Db,
        item: Item | None = None,
        intent: Intent | None = None,
        language: str | None = None,
        device_id: int | None = None,
        person_id: int | None = None,
        session_id: str | None = None,
        since: datetime | None = None,
        until: datetime | None = None,
        limit: Annotated[int, Query(ge=1, le=1000)] = 200,
        offset: Annotated[int, Query(ge=0)] = 0,
    ) -> list[TakeOut]:
        """The takes, newest first; `since` and `until` bound when they were recorded."""
        query = select(Take).options(*TAKE_LOAD)
        if item is not None:
            query = query.where(Take.item == item)
        if intent is not None:
            query = query.where(Take.intent == intent)
        if language is not None:
            query = query.where(Take.language == language)
        if device_id is not None:
            query = query.where(Take.device_id == device_id)
        if person_id is not None:
            query = query.where(Take.person_id == person_id)
        if session_id is not None:
            query = query.where(Take.session_id == session_id)
        if since is not None:
            query = query.where(Take.recorded_at >= since)
        if until is not None:
            query = query.where(Take.recorded_at <= until)
        query = query.order_by(Take.recorded_at.desc(), Take.id).limit(limit).offset(offset)
        cache: dict[int, list[Voice]] = {}
        return [out(db, t, cache) for t in db.scalars(query)]

    @router.get("/takes/{take_id}", operation_id="getTake")
    def read_take(take_id: str, db: Db) -> TakeOut:
        return out(db, get_take(db, take_id))

    @router.patch("/takes/{take_id}", operation_id="updateTake")
    def update_take(take_id: str, body: TakePatch, db: Db) -> TakeOut:
        take = get_take(db, take_id)
        changes = body.model_dump(exclude_unset=True)
        check_labels(
            db,
            changes.get("device_id"),
            changes.get("content_ref"),
            person_id=changes.get("person_id"),
        )
        for field in ("device_id", "person_id", "item", "intent", "recorded_at", "note"):
            if field in changes and changes[field] is None:
                raise HTTPException(422, f"{field} cannot be empty")
        if "recorded_at" in changes:
            changes["recorded_at"] = as_utc(changes["recorded_at"])
        for field, value in changes.items():
            setattr(take, field, value)
        db.commit()
        db.expire(take)
        return out(db, get_take(db, take_id))

    @router.delete("/takes/{take_id}", status_code=204, operation_id="deleteTake")
    def delete_take(take_id: str, db: Db) -> Response:
        take = get_take(db, take_id)
        sha256 = take.sha256
        db.delete(take)
        db.commit()
        forget(db, {sha256})
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
        return out(db, get_take(db, take_id))

    @router.get("/takes/{take_id}/series/{key}", operation_id="takeSeries")
    def take_series(take_id: str, key: str, db: Db) -> Series:
        take = get_take(db, take_id)
        done = next((j for j in reversed(take.jobs) if j.status == JobStatus.DONE), None)
        stored = next((s for s in done.series if s.key == key), None) if done else None
        if stored is None:
            raise HTTPException(404, "no such series for this take")
        return Series(start_s=stored.start_s, step_s=stored.step_s, values=decode_series(stored))

    @router.get("/takes/{take_id}/trace", operation_id="takeTrace")
    def take_trace(take_id: str, db: Db) -> Trace:
        """The take moment by moment, from the series of its newest finished analysis."""
        take = get_take(db, take_id)
        done = finished(take)
        if done is None:
            raise HTTPException(404, "the take has not been analysed yet")
        series = {
            s.key: Series(start_s=s.start_s, step_s=s.step_s, values=decode_series(s))
            for s in done.series
        }
        return trace(Item(take.item), series, details_of(done))

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
