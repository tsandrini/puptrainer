"""People: whose voice a take is; one of them is the default one (the learner).

Revision ID: 0004
Revises: 0003
Create Date: 2026-11-23
"""

import sqlalchemy as sa
from alembic import op

revision = "0004"
down_revision = "0003"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "person",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("name", sa.String(80), nullable=False, unique=True),
        sa.Column("note", sa.String(2000), nullable=False),
        sa.Column("is_default", sa.Boolean(), nullable=False),
        sa.Column("created_at", sa.DateTime(), nullable=False),
    )
    op.create_index(
        "ix_person_one_default",
        "person",
        ["is_default"],
        unique=True,
        sqlite_where=sa.text("is_default"),
    )
    # NOTE: every take so far is the learner's: the first person, and the default one
    op.execute(
        "INSERT INTO person (id, name, note, is_default, created_at) "
        "VALUES (1, 'Me', '', 1, CURRENT_TIMESTAMP)"
    )
    # NOTE: plain ADD COLUMN, never a batch rebuild of `take` (see 0003); SQLite only adds
    # a reference that may be NULL, so the column is filled right after
    op.execute("ALTER TABLE take ADD COLUMN person_id INTEGER REFERENCES person (id)")
    op.execute("UPDATE take SET person_id = 1")
    op.create_index("ix_take_person_id", "take", ["person_id"])


def downgrade() -> None:
    op.drop_index("ix_take_person_id", "take")
    op.execute("ALTER TABLE take DROP COLUMN person_id")
    op.drop_index("ix_person_one_default", "person")
    op.drop_table("person")
