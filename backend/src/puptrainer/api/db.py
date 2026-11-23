"""The database: tables, engine and migrations."""

import sqlite3
import uuid
from contextlib import closing
from datetime import UTC, datetime, timedelta
from pathlib import Path

from alembic import command
from alembic.config import Config
from alembic.migration import MigrationContext
from alembic.script import ScriptDirectory
from sqlalchemy import (
    Boolean,
    DateTime,
    Dialect,
    Engine,
    ForeignKey,
    Index,
    LargeBinary,
    String,
    Text,
    TypeDecorator,
    UniqueConstraint,
    create_engine,
    event,
    text,
)
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column, relationship

MIGRATIONS = Path(__file__).parent / "migrations"
KEEP_SNAPSHOTS = 14
SNAPSHOT_EVERY = timedelta(hours=20)


def now() -> datetime:
    """The current time, timezone-aware, in UTC."""
    return datetime.now(UTC)


class UTCDateTime(TypeDecorator[datetime]):
    """Timezone-aware datetimes, stored as naive UTC (SQLite keeps no offset)."""

    impl = DateTime
    cache_ok = True

    def process_bind_param(self, value: datetime | None, dialect: Dialect) -> datetime | None:
        """Convert to naive UTC; a naive value is taken as UTC."""
        if value is None:
            return None
        if value.tzinfo is None:
            return value
        return value.astimezone(UTC).replace(tzinfo=None)

    def process_result_value(self, value: datetime | None, dialect: Dialect) -> datetime | None:
        """Attach UTC to the stored value."""
        return None if value is None else value.replace(tzinfo=UTC)


class Base(DeclarativeBase):
    """Base of all tables."""


class Device(Base):
    """A microphone setup."""

    __tablename__ = "device"

    id: Mapped[int] = mapped_column(primary_key=True)
    name: Mapped[str] = mapped_column(String(80), unique=True)
    kind: Mapped[str] = mapped_column(String(20))
    note: Mapped[str] = mapped_column(String(2000), default="")
    created_at: Mapped[datetime] = mapped_column(UTCDateTime, default=now)


class Person(Base):
    """Someone whose voice is recorded.

    Exactly one person is the default one: the learner, whose everyday voice every take
    is read against. A partial unique index keeps it to one.
    """

    __tablename__ = "person"
    __table_args__ = (
        Index("ix_person_one_default", "is_default", unique=True, sqlite_where=text("is_default")),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    name: Mapped[str] = mapped_column(String(80), unique=True)
    note: Mapped[str] = mapped_column(String(2000), default="")
    is_default: Mapped[bool] = mapped_column(Boolean, default=False)
    created_at: Mapped[datetime] = mapped_column(UTCDateTime, default=now)


class PracticeSession(Base):
    """A guided practice session; its takes point to it.

    The id is made by the browser, so writing a session twice (a retry from the upload
    queue) changes nothing.
    """

    __tablename__ = "practice_session"

    id: Mapped[str] = mapped_column(String(64), primary_key=True)
    created_at: Mapped[datetime] = mapped_column(UTCDateTime, default=now)
    routine_ref: Mapped[str | None] = mapped_column(String(120))
    language: Mapped[str | None] = mapped_column(String(8))
    started_at: Mapped[datetime] = mapped_column(UTCDateTime, index=True)
    ended_at: Mapped[datetime | None] = mapped_column(UTCDateTime)
    feel_start: Mapped[str | None] = mapped_column(String(10))
    comfort_end: Mapped[int | None]
    lasting_tension: Mapped[bool | None] = mapped_column(Boolean)
    note: Mapped[str] = mapped_column(String(2000), default="")


class TargetBand(Base):
    """The pitch band the learner works in; append-only, the newest is current."""

    __tablename__ = "target_band"

    id: Mapped[int] = mapped_column(primary_key=True)
    created_at: Mapped[datetime] = mapped_column(UTCDateTime, default=now)
    low_hz: Mapped[float]
    high_hz: Mapped[float]


class Take(Base):
    """One recording with its labels."""

    __tablename__ = "take"

    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=lambda: uuid.uuid4().hex)
    created_at: Mapped[datetime] = mapped_column(UTCDateTime, default=now)
    recorded_at: Mapped[datetime] = mapped_column(UTCDateTime, index=True)
    device_id: Mapped[int] = mapped_column(ForeignKey("device.id"))
    # NOTE: nullable in the table only: SQLite cannot add a NOT NULL reference to a table
    # with rows. The migration fills it and the API always sets it
    person_id: Mapped[int] = mapped_column(ForeignKey("person.id"), index=True, nullable=True)
    item: Mapped[str] = mapped_column(String(20))
    intent: Mapped[str] = mapped_column(String(20))
    language: Mapped[str | None] = mapped_column(String(8))
    content_ref: Mapped[str | None] = mapped_column(String(120))
    note: Mapped[str] = mapped_column(String(2000), default="")
    original_name: Mapped[str] = mapped_column(String(255), default="")
    client_id: Mapped[str | None] = mapped_column(String(64), unique=True)
    sha256: Mapped[str] = mapped_column(String(64), index=True)
    sample_rate: Mapped[int]
    channels: Mapped[int]
    duration_s: Mapped[float]
    # NOTE: no ON DELETE action: SQLite cannot reflect one added by ALTER TABLE, so the
    # API unlinks a session's takes before it deletes the session
    session_id: Mapped[str | None] = mapped_column(ForeignKey("practice_session.id"), index=True)
    exercise_ref: Mapped[str | None] = mapped_column(String(120))
    target: Mapped[str | None] = mapped_column(Text)
    comfort: Mapped[int | None]

    device: Mapped[Device] = relationship()
    jobs: Mapped[list["AnalysisJob"]] = relationship(
        back_populates="take", cascade="all, delete-orphan", order_by="AnalysisJob.id"
    )


class AnalysisJob(Base):
    """One run of the analysis pipeline over a take."""

    __tablename__ = "analysis_job"

    id: Mapped[int] = mapped_column(primary_key=True)
    take_id: Mapped[str] = mapped_column(ForeignKey("take.id", ondelete="CASCADE"), index=True)
    status: Mapped[str] = mapped_column(String(10), index=True)
    created_at: Mapped[datetime] = mapped_column(UTCDateTime, default=now)
    claimed_at: Mapped[datetime | None] = mapped_column(UTCDateTime)
    finished_at: Mapped[datetime | None] = mapped_column(UTCDateTime)
    pipeline_version: Mapped[str | None] = mapped_column(String(20))
    error: Mapped[str | None] = mapped_column(String(4000))
    details: Mapped[str | None] = mapped_column(Text)

    take: Mapped[Take] = relationship(back_populates="jobs")
    metrics: Mapped[list["MetricValue"]] = relationship(
        back_populates="job", cascade="all, delete-orphan"
    )
    series: Mapped[list["AnalysisSeries"]] = relationship(
        back_populates="job", cascade="all, delete-orphan"
    )


class MetricValue(Base):
    """One number a job measured."""

    __tablename__ = "metric_value"
    __table_args__ = (UniqueConstraint("job_id", "key"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    job_id: Mapped[int] = mapped_column(ForeignKey("analysis_job.id", ondelete="CASCADE"))
    key: Mapped[str] = mapped_column(String(60))
    value: Mapped[float]

    job: Mapped[AnalysisJob] = relationship(back_populates="metrics")


class AnalysisSeries(Base):
    """Evenly spaced values a job measured over a take, e.g. the pitch contour.

    `data` holds little-endian 32-bit floats; NaN marks a step with nothing to measure.
    """

    __tablename__ = "analysis_series"
    __table_args__ = (UniqueConstraint("job_id", "key"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    job_id: Mapped[int] = mapped_column(ForeignKey("analysis_job.id", ondelete="CASCADE"))
    key: Mapped[str] = mapped_column(String(60))
    start_s: Mapped[float]
    step_s: Mapped[float]
    data: Mapped[bytes] = mapped_column(LargeBinary, deferred=True)

    job: Mapped[AnalysisJob] = relationship(back_populates="series")


def make_engine(path: Path) -> Engine:
    """Open the SQLite database at `path` with foreign keys and write-ahead logging on."""
    engine = create_engine(f"sqlite:///{path}", connect_args={"check_same_thread": False})

    @event.listens_for(engine, "connect")
    def _pragmas(connection, _record) -> None:  # noqa: ANN001
        cursor = connection.cursor()
        cursor.execute("PRAGMA foreign_keys=ON")
        cursor.execute("PRAGMA journal_mode=WAL")
        cursor.execute("PRAGMA busy_timeout=5000")
        cursor.close()

    return engine


def snapshot(database: Path, folder: Path, reason: str) -> Path | None:
    """Copy the database into `folder`, consistently even while it is in use.

    Uses SQLite's online backup, so a write-ahead log is included. Only the newest
    `KEEP_SNAPSHOTS` files are kept.

    Args:
        database: The SQLite file.
        folder: Where snapshots go; created when missing.
        reason: Why it was taken, part of the file name (`start`, `before-0003`).

    Returns:
        The snapshot's path, or `None` when there is no database yet.
    """
    if not database.exists():
        return None
    folder.mkdir(parents=True, exist_ok=True)
    stamp = datetime.now(UTC).strftime("%Y%m%dT%H%M%SZ")
    target = folder / f"{database.stem}-{stamp}-{reason}.sqlite3"
    with closing(sqlite3.connect(database)) as source, closing(sqlite3.connect(target)) as copy:
        source.backup(copy)
    for old in sorted(folder.glob(f"{database.stem}-*.sqlite3"))[:-KEEP_SNAPSHOTS]:
        old.unlink()
    return target


def snapshot_if_stale(database: Path, folder: Path) -> Path | None:
    """Take a `start` snapshot unless one was taken within the last `SNAPSHOT_EVERY`.

    Returns:
        The new snapshot, or `None` when the last one is recent or there is no database.
    """
    recent = sorted(folder.glob(f"{database.stem}-*-start.sqlite3"))
    if recent:
        age = datetime.now(UTC).timestamp() - recent[-1].stat().st_mtime
        if age < SNAPSHOT_EVERY.total_seconds():
            return None
    return snapshot(database, folder, "start")


def migrate(engine: Engine, backups: Path | None = None) -> None:
    """Bring the database to the newest schema.

    Args:
        engine: The database.
        backups: Where to put a snapshot before an existing database is changed; without
            it no snapshot is taken.
    """
    config = Config()
    config.set_main_option("script_location", str(MIGRATIONS))
    head = ScriptDirectory.from_config(config).get_current_head()
    with engine.connect() as connection:
        current = MigrationContext.configure(connection).get_current_revision()
    if backups is not None and current is not None and current != head and engine.url.database:
        # NOTE: an existing database is about to change shape: keep it as it was
        snapshot(Path(engine.url.database), backups, f"before-{head}")
    with engine.begin() as connection:
        config.attributes["connection"] = connection
        command.upgrade(config, "head")
