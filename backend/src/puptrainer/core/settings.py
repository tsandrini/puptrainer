"""Configuration from `PUPTRAINER_*` environment variables."""

import os
from pathlib import Path

from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict


def default_data_dir() -> Path:
    """The user's data directory: `$XDG_DATA_HOME/puptrainer`, else `~/.local/share/puptrainer`.

    An absolute path outside any checkout, so the recordings do not depend on where the
    app is started from and survive a `git clean`.
    """
    base = os.environ.get("XDG_DATA_HOME")
    return (Path(base) if base else Path.home() / ".local" / "share") / "puptrainer"


class Settings(BaseSettings):
    """Runtime configuration of the API and the worker.

    Attributes:
        data_dir: Where the database, its snapshots and the recordings live; by default
            the user's data directory (see `default_data_dir`).
        content_dir: Passages, protocols and metric texts (`content/` of the repository).
        web_dir: The built web app to serve at `/`; unset in development (Vite serves it).
        bind: `host:port` the API listens on.
        api_url: Where the worker reaches the API.
        job_timeout_s: A claimed job not finished within this time returns to the queue.
        poll_interval_s: How long the worker sleeps when the queue is empty.
        token: The access token. With one set, the API asks for it (the web app signs in,
            the worker sends it); without, the API is open and must stay on localhost.
        token_file: A file holding the token; preferred over `token` in a deployment.
    """

    model_config = SettingsConfigDict(env_prefix="PUPTRAINER_")

    data_dir: Path = Field(default_factory=default_data_dir)
    content_dir: Path = Path("content")
    web_dir: Path | None = None
    bind: str = "127.0.0.1:8437"
    api_url: str = "http://127.0.0.1:8437"
    job_timeout_s: float = 600.0
    poll_interval_s: float = 2.0
    token: str | None = None
    token_file: Path | None = None

    @property
    def access_token(self) -> str | None:
        """The token in effect: the file's content if a file is set, else `token`.

        Raises:
            OSError: The token file cannot be read.
            ValueError: The token file is empty.
        """
        if self.token_file is not None:
            value = self.token_file.read_text(encoding="utf-8").strip()
            if not value:
                raise ValueError(f"the token file is empty: {self.token_file}")
            return value
        return self.token or None

    @property
    def database_path(self) -> Path:
        """The SQLite file."""
        return self.data_dir / "puptrainer.sqlite3"

    @property
    def backup_dir(self) -> Path:
        """Snapshots of the database."""
        return self.data_dir / "backups"

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
