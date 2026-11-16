"""Alembic environment: runs on the connection `db.migrate` hands over, or, from the
`alembic` command line, on the database of the configured data directory."""

from alembic import context

from puptrainer.api.db import Base, make_engine
from puptrainer.core.settings import Settings

target_metadata = Base.metadata


def run(connection) -> None:
    # NOTE: batch mode, SQLite cannot ALTER most things in place
    context.configure(connection=connection, target_metadata=target_metadata, render_as_batch=True)
    with context.begin_transaction():
        context.run_migrations()


connection = context.config.attributes.get("connection")
if connection is not None:
    run(connection)
else:
    settings = Settings()
    settings.data_dir.mkdir(parents=True, exist_ok=True)
    with make_engine(settings.database_path).begin() as conn:
        run(conn)
