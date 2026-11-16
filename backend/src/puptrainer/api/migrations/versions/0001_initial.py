"""Devices, takes, analysis jobs, metric values.

Revision ID: 0001
Revises:
Create Date: 2026-11-16
"""

import sqlalchemy as sa
from alembic import op

revision = "0001"
down_revision = None
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "device",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("name", sa.String(80), nullable=False, unique=True),
        sa.Column("kind", sa.String(20), nullable=False),
        sa.Column("note", sa.String(2000), nullable=False),
        sa.Column("created_at", sa.DateTime(), nullable=False),
    )
    op.create_table(
        "take",
        sa.Column("id", sa.String(32), primary_key=True),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("recorded_at", sa.DateTime(), nullable=False),
        sa.Column("device_id", sa.Integer(), sa.ForeignKey("device.id"), nullable=False),
        sa.Column("item", sa.String(20), nullable=False),
        sa.Column("intent", sa.String(20), nullable=False),
        sa.Column("language", sa.String(8), nullable=True),
        sa.Column("content_ref", sa.String(120), nullable=True),
        sa.Column("note", sa.String(2000), nullable=False),
        sa.Column("original_name", sa.String(255), nullable=False),
        sa.Column("client_id", sa.String(64), nullable=True, unique=True),
        sa.Column("sha256", sa.String(64), nullable=False),
        sa.Column("sample_rate", sa.Integer(), nullable=False),
        sa.Column("channels", sa.Integer(), nullable=False),
        sa.Column("duration_s", sa.Float(), nullable=False),
    )
    op.create_index("ix_take_recorded_at", "take", ["recorded_at"])
    op.create_index("ix_take_sha256", "take", ["sha256"])
    op.create_table(
        "analysis_job",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column(
            "take_id", sa.String(32), sa.ForeignKey("take.id", ondelete="CASCADE"), nullable=False
        ),
        sa.Column("status", sa.String(10), nullable=False),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("claimed_at", sa.DateTime(), nullable=True),
        sa.Column("finished_at", sa.DateTime(), nullable=True),
        sa.Column("pipeline_version", sa.String(20), nullable=True),
        sa.Column("error", sa.String(4000), nullable=True),
    )
    op.create_index("ix_analysis_job_take_id", "analysis_job", ["take_id"])
    op.create_index("ix_analysis_job_status", "analysis_job", ["status"])
    op.create_table(
        "metric_value",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column(
            "job_id",
            sa.Integer(),
            sa.ForeignKey("analysis_job.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("key", sa.String(60), nullable=False),
        sa.Column("value", sa.Float(), nullable=False),
        sa.UniqueConstraint("job_id", "key"),
    )


def downgrade() -> None:
    op.drop_table("metric_value")
    op.drop_table("analysis_job")
    op.drop_table("take")
    op.drop_table("device")
