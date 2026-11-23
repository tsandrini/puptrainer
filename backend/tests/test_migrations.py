from pathlib import Path

from alembic import command
from alembic.config import Config
from sqlalchemy import text

from puptrainer.api.db import MIGRATIONS, make_engine, migrate


def test_0003_keeps_takes_and_their_analyses(tmp_path: Path) -> None:
    database = tmp_path / "puptrainer.sqlite3"
    engine = make_engine(database)
    config = Config()
    config.set_main_option("script_location", str(MIGRATIONS))
    with engine.begin() as connection:
        config.attributes["connection"] = connection
        command.upgrade(config, "0002")
        connection.execute(
            text(
                "INSERT INTO device (id, name, kind, note, created_at) "
                "VALUES (1, 'lav', 'lavalier', '', '2026-11-16 10:00:00')"
            )
        )
        connection.execute(
            text(
                "INSERT INTO take (id, created_at, recorded_at, device_id, item, intent, note,"
                " original_name, sha256, sample_rate, channels, duration_s) VALUES"
                " ('t1', '2026-11-16 10:00:00', '2026-11-16 10:00:00', 1, 'vowels',"
                " 'habitual', '', 'a.wav', 'abc', 48000, 1, 12.0)"
            )
        )
        connection.execute(
            text(
                "INSERT INTO analysis_job (id, take_id, status, created_at, pipeline_version)"
                " VALUES (1, 't1', 'done', '2026-11-16 10:00:01', '0.2.0')"
            )
        )
        connection.execute(
            text("INSERT INTO metric_value (job_id, key, value) VALUES (1, 'vtl_cm', 16.5)")
        )
        connection.execute(
            text(
                "INSERT INTO analysis_series (job_id, key, start_s, step_s, data)"
                " VALUES (1, 'pitch_hz', 0.0, 0.01, x'0000')"
            )
        )

    migrate(engine, tmp_path / "backups")

    with engine.connect() as connection:
        take = connection.execute(
            text("SELECT intent, session_id, exercise_ref, target, comfort FROM take")
        ).one()
        assert tuple(take) == ("habitual", None, None, None, None)
        assert connection.execute(text("SELECT count(*) FROM analysis_job")).scalar() == 1
        assert connection.execute(text("SELECT value FROM metric_value")).scalar() == 16.5
        assert connection.execute(text("SELECT count(*) FROM analysis_series")).scalar() == 1
        assert connection.execute(text("SELECT count(*) FROM practice_session")).scalar() == 0
    # NOTE: one snapshot, named after the schema the database was brought to
    assert len(list((tmp_path / "backups").glob("*-before-*.sqlite3"))) == 1
    engine.dispose()


def test_0004_gives_every_take_to_the_first_person(tmp_path: Path) -> None:
    database = tmp_path / "puptrainer.sqlite3"
    engine = make_engine(database)
    config = Config()
    config.set_main_option("script_location", str(MIGRATIONS))
    with engine.begin() as connection:
        config.attributes["connection"] = connection
        command.upgrade(config, "0003")
        connection.execute(
            text(
                "INSERT INTO device (id, name, kind, note, created_at) "
                "VALUES (1, 'lav', 'lavalier', '', '2026-11-16 10:00:00')"
            )
        )
        for take in ("t1", "t2"):
            connection.execute(
                text(
                    "INSERT INTO take (id, created_at, recorded_at, device_id, item, intent,"
                    " note, original_name, sha256, sample_rate, channels, duration_s) VALUES"
                    f" ('{take}', '2026-11-16 10:00:00', '2026-11-16 10:00:00', 1, 'vowels',"
                    " 'habitual', '', 'a.wav', 'abc', 48000, 1, 12.0)"
                )
            )
        connection.execute(
            text(
                "INSERT INTO analysis_job (id, take_id, status, created_at, pipeline_version)"
                " VALUES (1, 't1', 'done', '2026-11-16 10:00:01', '0.4.2')"
            )
        )

    migrate(engine, tmp_path / "backups")

    with engine.connect() as connection:
        people = connection.execute(text("SELECT id, name, is_default FROM person")).all()
        assert [tuple(person) for person in people] == [(1, "Me", 1)]
        owners = connection.execute(text("SELECT DISTINCT person_id FROM take")).scalars().all()
        assert owners == [1]
        assert connection.execute(text("SELECT count(*) FROM analysis_job")).scalar() == 1
    assert len(list((tmp_path / "backups").glob("*-before-0004.sqlite3"))) == 1
    engine.dispose()
