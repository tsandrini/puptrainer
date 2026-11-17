import os
import sqlite3
import time
from contextlib import closing
from pathlib import Path

from alembic import command
from alembic.config import Config
from fastapi.testclient import TestClient

from puptrainer.api.app import create_app
from puptrainer.api.db import KEEP_SNAPSHOTS, MIGRATIONS, make_engine, migrate, snapshot
from puptrainer.core.settings import Settings, default_data_dir

from .conftest import upload


def revision(database: Path) -> str:
    with closing(sqlite3.connect(database)) as connection:
        return connection.execute("select version_num from alembic_version").fetchone()[0]


def test_default_data_directory_is_absolute_and_outside_the_checkout(monkeypatch) -> None:
    monkeypatch.setenv("XDG_DATA_HOME", "/somewhere/data")
    assert default_data_dir() == Path("/somewhere/data/puptrainer")
    monkeypatch.delenv("XDG_DATA_HOME")
    assert default_data_dir() == Path.home() / ".local" / "share" / "puptrainer"
    assert Settings().data_dir.is_absolute()
    monkeypatch.setenv("PUPTRAINER_DATA_DIR", "/elsewhere")
    assert Settings().data_dir == Path("/elsewhere")


def test_new_database_needs_no_snapshot(settings: Settings) -> None:
    create_app(settings)
    assert not list(settings.backup_dir.glob("*"))


def test_database_is_copied_before_its_schema_changes(tmp_path: Path) -> None:
    database, backups = tmp_path / "puptrainer.sqlite3", tmp_path / "backups"
    engine = make_engine(database)
    config = Config()
    config.set_main_option("script_location", str(MIGRATIONS))
    with engine.begin() as connection:
        config.attributes["connection"] = connection
        command.upgrade(config, "0001")
        connection.exec_driver_sql(
            "insert into device (name, kind, note, created_at) "
            "values ('lavalier', 'lavalier', '', '2026-11-16 20:00:00')"
        )
    engine.dispose()
    assert revision(database) == "0001"

    engine = make_engine(database)
    migrate(engine, backups)
    engine.dispose()
    assert revision(database) != "0001"
    [kept] = list(backups.glob("puptrainer-*-before-*.sqlite3"))
    assert revision(kept) == "0001"
    with closing(sqlite3.connect(kept)) as connection:
        assert connection.execute("select name from device").fetchall() == [("lavalier",)]

    # an up-to-date database is left alone
    engine = make_engine(database)
    migrate(engine, backups)
    engine.dispose()
    assert len(list(backups.glob("*"))) == 1


def test_a_snapshot_is_kept_from_each_day_the_app_starts(
    settings: Settings, client: TestClient, device_id: int
) -> None:
    take = upload(client, device_id).json()
    client.close()

    create_app(settings)
    [first] = list(settings.backup_dir.glob("puptrainer-*-start.sqlite3"))
    with closing(sqlite3.connect(first)) as connection:
        assert connection.execute("select id from take").fetchall() == [(take["id"],)]

    # started again the same day: nothing new
    create_app(settings)
    assert len(list(settings.backup_dir.glob("*-start.sqlite3"))) == 1

    # started a day later: one more
    yesterday = time.time() - 26 * 3600
    os.utime(first, (yesterday, yesterday))
    time.sleep(1.1)  # NOTE: snapshot names carry the second they were taken
    create_app(settings)
    assert len(list(settings.backup_dir.glob("*-start.sqlite3"))) == 2


def test_only_the_newest_snapshots_are_kept(tmp_path: Path) -> None:
    database, backups = tmp_path / "puptrainer.sqlite3", tmp_path / "backups"
    with closing(sqlite3.connect(database)) as connection:
        connection.execute("create table t (x)")
    backups.mkdir()
    for day in range(1, KEEP_SNAPSHOTS + 6):
        (backups / f"puptrainer-202610{day:02d}T000000Z-start.sqlite3").write_bytes(b"old")
    newest = snapshot(database, backups, "start")
    kept = sorted(backups.glob("*.sqlite3"))
    assert len(kept) == KEEP_SNAPSHOTS
    assert kept[-1] == newest
    assert kept[0].name == "puptrainer-20261007T000000Z-start.sqlite3"
    assert snapshot(tmp_path / "missing.sqlite3", backups, "start") is None
