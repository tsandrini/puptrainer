"""`puptrainer-worker`: take jobs from the API, analyse, report.

The worker talks to the API over HTTP only, so it can run on another machine than the
API and its storage.
"""

import argparse
import logging
import signal
import tempfile
import time
from pathlib import Path
from types import FrameType

import httpx

from puptrainer.analysis.pipeline import PIPELINE_VERSION, analyse
from puptrainer.core.schemas import JobClaim, JobFailure, JobResult, WorkerHello
from puptrainer.core.settings import Settings

log = logging.getLogger("puptrainer.worker")


def run_once(client: httpx.Client) -> bool:
    """Claim and process one job.

    Args:
        client: An HTTP client whose base URL is the API root.

    Returns:
        True when a job was processed (successfully or not), False when the queue was empty.

    Raises:
        httpx.HTTPError: The API could not be reached or answered with an error.
    """
    hello = WorkerHello(pipeline_version=PIPELINE_VERSION)
    response = client.post("/api/v1/worker/jobs/claim", json=hello.model_dump())
    response.raise_for_status()
    if response.status_code == 204:
        return False
    job = JobClaim.model_validate(response.json())
    try:
        audio = client.get(job.audio_path)
        audio.raise_for_status()
        with tempfile.TemporaryDirectory(prefix="puptrainer-") as tmp:
            path = Path(tmp) / "take.flac"
            path.write_bytes(audio.content)
            analysis = analyse(path, job.item)
    except Exception as exc:  # noqa: BLE001  NOTE: any failure is reported, the loop goes on
        log.exception("job %s (take %s) failed", job.job_id, job.take_id)
        failure = JobFailure(
            pipeline_version=PIPELINE_VERSION, error=f"{type(exc).__name__}: {exc}"
        )
        client.post(
            f"/api/v1/worker/jobs/{job.job_id}/fail", json=failure.model_dump()
        ).raise_for_status()
        return True
    result = JobResult(
        pipeline_version=PIPELINE_VERSION,
        metrics=analysis.metrics,
        details=analysis.details,
        series=analysis.series,
    )
    client.post(
        f"/api/v1/worker/jobs/{job.job_id}/complete", json=result.model_dump()
    ).raise_for_status()
    log.info("job %s (take %s) done", job.job_id, job.take_id)
    return True


def main() -> None:
    """Process jobs until interrupted; with `--once`, drain the queue and exit."""
    parser = argparse.ArgumentParser(description="Take jobs from the API, analyse, report.")
    parser.add_argument("--once", action="store_true", help="process what is queued, then exit")
    args = parser.parse_args()
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(name)s %(message)s")
    settings = Settings()
    stopping = False

    def stop(_signum: int, _frame: FrameType | None) -> None:
        nonlocal stopping
        stopping = True

    signal.signal(signal.SIGTERM, stop)
    signal.signal(signal.SIGINT, stop)
    log.info("pipeline %s, API at %s", PIPELINE_VERSION, settings.api_url)
    token = settings.access_token
    headers = {} if token is None else {"Authorization": f"Bearer {token}"}
    with httpx.Client(base_url=settings.api_url, timeout=60.0, headers=headers) as client:
        while not stopping:
            try:
                worked = run_once(client)
            except httpx.HTTPError as exc:
                refused = isinstance(exc, httpx.HTTPStatusError) and exc.response.status_code == 401
                problem = "refused the worker's token" if refused else f"is not reachable: {exc}"
                if args.once:
                    raise SystemExit(f"the API at {settings.api_url} {problem}") from exc
                log.warning("the API at %s %s; retrying", settings.api_url, problem)
                worked = False
            if not worked:
                if args.once:
                    return
                time.sleep(settings.poll_interval_s)


if __name__ == "__main__":
    main()
