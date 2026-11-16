"""Structured details of a job and stored series (pitch contour).

Revision ID: 0002
Revises: 0001
Create Date: 2026-11-16
"""

import sqlalchemy as sa
from alembic import op

revision = "0002"
down_revision = "0001"
branch_labels = None
depends_on = None


def upgrade() -> None:
    with op.batch_alter_table("analysis_job") as batch:
        batch.add_column(sa.Column("details", sa.Text(), nullable=True))
    op.create_table(
        "analysis_series",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column(
            "job_id",
            sa.Integer(),
            sa.ForeignKey("analysis_job.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("key", sa.String(60), nullable=False),
        sa.Column("start_s", sa.Float(), nullable=False),
        sa.Column("step_s", sa.Float(), nullable=False),
        sa.Column("data", sa.LargeBinary(), nullable=False),
        sa.UniqueConstraint("job_id", "key"),
    )


def downgrade() -> None:
    op.drop_table("analysis_series")
    with op.batch_alter_table("analysis_job") as batch:
        batch.drop_column("details")
