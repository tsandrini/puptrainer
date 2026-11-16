"""Configuration from `PUPTRAINER_*` environment variables."""

from pathlib import Path

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    """Runtime configuration of the API and the worker.

    Attributes:
        data_dir: Where the database and the recordings live.
        content_dir: Passages, protocols and metric texts (`content/` of the repository).
        web_dir: The built web app to serve at `/`; unset in development (Vite serves it).
        bind: `host:port` the API listens on.
        api_url: Where the worker reaches the API.
        job_timeout_s: A claimed job not finished within this time returns to the queue.
        poll_interval_s: How long the worker sleeps when the queue is empty.
    """

    model_config = SettingsConfigDict(env_prefix="PUPTRAINER_")

    data_dir: Path = Path("data")
    content_dir: Path = Path("content")
    web_dir: Path | None = None
    bind: str = "127.0.0.1:8437"
    api_url: str = "http://127.0.0.1:8437"
    job_timeout_s: float = 600.0
    poll_interval_s: float = 2.0

    @property
    def database_path(self) -> Path:
        """The SQLite file."""
        return self.data_dir / "puptrainer.sqlite3"

    @property
    def audio_dir(self) -> Path:
        """The content-addressed recordings."""
        return self.data_dir / "audio"

    @property
    def host(self) -> str:
        """Host part of `bind`."""
        return self.bind.rsplit(":", 1)[0]

    @property
    def port(self) -> int:
        """Port part of `bind`."""
        return int(self.bind.rsplit(":", 1)[1])
