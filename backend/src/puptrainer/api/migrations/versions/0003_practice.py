"""Practice: sessions, the target band, and a take's exercise, target and comfort.

Revision ID: 0003
Revises: 0002
Create Date: 2026-11-17
"""

import sqlalchemy as sa
from alembic import op

revision = "0003"
down_revision = "0002"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "practice_session",
        sa.Column("id", sa.String(64), primary_key=True),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("routine_ref", sa.String(120), nullable=True),
        sa.Column("language", sa.String(8), nullable=True),
        sa.Column("started_at", sa.DateTime(), nullable=False),
        sa.Column("ended_at", sa.DateTime(), nullable=True),
        sa.Column("feel_start", sa.String(10), nullable=True),
        sa.Column("comfort_end", sa.Integer(), nullable=True),
        sa.Column("lasting_tension", sa.Boolean(), nullable=True),
        sa.Column("note", sa.String(2000), nullable=False),
    )
    op.create_index("ix_practice_session_started_at", "practice_session", ["started_at"])
    op.create_table(
        "target_band",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("low_hz", sa.Float(), nullable=False),
        sa.Column("high_hz", sa.Float(), nullable=False),
    )
    # NOTE: plain ADD COLUMN, never a batch rebuild of `take`: with foreign keys on,
    # dropping the old table would cascade into every analysis job and its metrics
    op.execute(
        "ALTER TABLE take ADD COLUMN session_id VARCHAR(64) REFERENCES practice_session (id)"
    )
    op.execute("ALTER TABLE take ADD COLUMN exercise_ref VARCHAR(120)")
    op.execute("ALTER TABLE take ADD COLUMN target TEXT")
    op.execute("ALTER TABLE take ADD COLUMN comfort INTEGER")
    op.create_index("ix_take_session_id", "take", ["session_id"])


def downgrade() -> None:
    op.drop_index("ix_take_session_id", "take")
    for column in ("comfort", "target", "exercise_ref", "session_id"):
        op.execute(f"ALTER TABLE take DROP COLUMN {column}")
    op.drop_table("target_band")
    op.drop_index("ix_practice_session_started_at", "practice_session")
    op.drop_table("practice_session")
