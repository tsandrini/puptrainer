"""The database: tables, engine and migrations."""

import uuid
from datetime import UTC, datetime
from pathlib import Path

from alembic import command
from alembic.config import Config
from sqlalchemy import (
    DateTime,
    Dialect,
    Engine,
    ForeignKey,
    String,
    TypeDecorator,
    UniqueConstraint,
    create_engine,
    event,
)
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column, relationship

MIGRATIONS = Path(__file__).parent / "migrations"


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


class Take(Base):
    """One recording with its labels."""

    __tablename__ = "take"

    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=lambda: uuid.uuid4().hex)
    created_at: Mapped[datetime] = mapped_column(UTCDateTime, default=now)
    recorded_at: Mapped[datetime] = mapped_column(UTCDateTime, index=True)
    device_id: Mapped[int] = mapped_column(ForeignKey("device.id"))
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

    take: Mapped[Take] = relationship(back_populates="jobs")
    metrics: Mapped[list["MetricValue"]] = relationship(
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


def migrate(engine: Engine) -> None:
    """Bring the database to the newest schema."""
    config = Config()
    config.set_main_option("script_location", str(MIGRATIONS))
    with engine.begin() as connection:
        config.attributes["connection"] = connection
        command.upgrade(config, "head")
