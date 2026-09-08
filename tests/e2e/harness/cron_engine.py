"""
Cron expression parsing engine and SQLite routine persistence store.
Implements Requirement R3 scheduled & event-driven agent routines.
"""

from typing import List, Optional, Tuple, Set
from datetime import datetime, timezone, timedelta
import sqlite3
import re
from .contracts import RoutineJob


class CronParser:
    """Parses standard 5-field cron expressions and computes next execution timestamps."""

    @staticmethod
    def parse_field(field_str: str, min_val: int, max_val: int) -> Set[int]:
        """Parses a single cron field (*, */step, a-b, a,b,c)."""
        field_str = field_str.strip()
        allowed: Set[int] = set()

        # Step */N
        if field_str.startswith("*/"):
            step = int(field_str[2:])
            if step <= 0:
                raise ValueError(f"Step must be > 0, got {step}")
            for v in range(min_val, max_val + 1, step):
                allowed.add(v)
            return allowed

        # Wildcard *
        if field_str == "*":
            return set(range(min_val, max_val + 1))

        # List separated by commas
        parts = field_str.split(",")
        for part in parts:
            part = part.strip()
            if "-" in part:
                # Range
                low_s, high_s = part.split("-", 1)
                low, high = int(low_s), int(high_s)
                if low < min_val or high > max_val or low > high:
                    raise ValueError(f"Invalid range {part} for bounds [{min_val}, {max_val}]")
                for v in range(low, high + 1):
                    allowed.add(v)
            else:
                val = int(part)
                if val < min_val or val > max_val:
                    raise ValueError(f"Value {val} out of bounds [{min_val}, {max_val}]")
                allowed.add(val)

        return allowed

    @classmethod
    def validate_expression(cls, expr: str) -> None:
        fields = expr.strip().split()
        if len(fields) != 5:
            raise ValueError(f"Standard cron requires 5 fields, got {len(fields)}: '{expr}'")

        cls.parse_field(fields[0], 0, 59)   # minute
        cls.parse_field(fields[1], 0, 23)   # hour
        cls.parse_field(fields[2], 1, 31)   # day of month
        cls.parse_field(fields[3], 1, 12)   # month
        cls.parse_field(fields[4], 0, 7)    # day of week (0 and 7 are Sunday)

    @classmethod
    def compute_next_run(cls, expr: str, after_timestamp_sec: int) -> int:
        cls.validate_expression(expr)
        fields = expr.strip().split()
        minutes = cls.parse_field(fields[0], 0, 59)
        hours = cls.parse_field(fields[1], 0, 23)
        months = cls.parse_field(fields[3], 1, 12)
        dows = cls.parse_field(fields[4], 0, 7)
        if 7 in dows:
            dows.add(0)

        dt = datetime.fromtimestamp(after_timestamp_sec, tz=timezone.utc)
        # Advance by 1 minute to ensure next run is strictly after
        dt = dt.replace(second=0, microsecond=0) + timedelta(minutes=1)

        # Search forward up to 366 days (527040 minutes)
        for _ in range(527040):
            if dt.month in months:
                dow = (dt.weekday() + 1) % 7  # Python weekday Monday=0..Sunday=6 -> Cron Sun=0..Sat=6
                if dow in dows:
                    doms = cls.parse_field(fields[2], 1, 31)
                    if dt.day in doms:
                        if dt.hour in hours:
                            if dt.minute in minutes:
                                return int(dt.timestamp())
            dt += timedelta(minutes=1)

        raise RuntimeError(f"Could not compute next run within 1 year for cron: {expr}")


class RoutineStore:
    """SQLite persistence store for scheduled agent routines."""

    def __init__(self, db_path: str = ":memory:"):
        self.db_path = db_path
        self.conn = sqlite3.connect(db_path)
        self.conn.row_factory = sqlite3.Row
        self._init_db()

    def _init_db(self) -> None:
        with self.conn:
            self.conn.execute("""
                CREATE TABLE IF NOT EXISTS routines (
                    id TEXT PRIMARY KEY,
                    name TEXT NOT NULL,
                    cron_expr TEXT NOT NULL,
                    action_payload TEXT NOT NULL,
                    last_run_at INTEGER,
                    next_run_at INTEGER,
                    enabled INTEGER NOT NULL DEFAULT 1
                )
            """)

    def add_routine(self, job: RoutineJob) -> None:
        job.validate()
        CronParser.validate_expression(job.cron_expr)
        with self.conn:
            self.conn.execute("""
                INSERT INTO routines (id, name, cron_expr, action_payload, last_run_at, next_run_at, enabled)
                VALUES (?, ?, ?, ?, ?, ?, ?)
            """, (
                job.id,
                job.name,
                job.cron_expr,
                job.action_payload,
                job.last_run_at,
                job.next_run_at,
                1 if job.enabled else 0
            ))

    def get_routine(self, routine_id: str) -> Optional[RoutineJob]:
        cur = self.conn.cursor()
        cur.execute("SELECT * FROM routines WHERE id = ?", (routine_id,))
        row = cur.fetchone()
        if not row:
            return None
        return RoutineJob(
            id=row["id"],
            name=row["name"],
            cron_expr=row["cron_expr"],
            action_payload=row["action_payload"],
            last_run_at=row["last_run_at"],
            next_run_at=row["next_run_at"],
            enabled=bool(row["enabled"])
        )

    def list_routines(self) -> List[RoutineJob]:
        cur = self.conn.cursor()
        cur.execute("SELECT * FROM routines ORDER BY id")
        rows = cur.fetchall()
        return [
            RoutineJob(
                id=r["id"],
                name=r["name"],
                cron_expr=r["cron_expr"],
                action_payload=r["action_payload"],
                last_run_at=r["last_run_at"],
                next_run_at=r["next_run_at"],
                enabled=bool(r["enabled"])
            )
            for r in rows
        ]

    def list_due_routines(self, current_timestamp: int) -> List[RoutineJob]:
        cur = self.conn.cursor()
        cur.execute("""
            SELECT * FROM routines
            WHERE enabled = 1 AND next_run_at IS NOT NULL AND next_run_at <= ?
        """, (current_timestamp,))
        rows = cur.fetchall()
        return [
            RoutineJob(
                id=r["id"],
                name=r["name"],
                cron_expr=r["cron_expr"],
                action_payload=r["action_payload"],
                last_run_at=r["last_run_at"],
                next_run_at=r["next_run_at"],
                enabled=bool(r["enabled"])
            )
            for r in rows
        ]

    def record_run(self, routine_id: str, run_time: int, next_run: int) -> None:
        with self.conn:
            self.conn.execute("""
                UPDATE routines
                SET last_run_at = ?, next_run_at = ?
                WHERE id = ?
            """, (run_time, next_run, routine_id))

    def toggle_enabled(self, routine_id: str, enabled: bool) -> None:
        with self.conn:
            self.conn.execute("""
                UPDATE routines SET enabled = ? WHERE id = ?
            """, (1 if enabled else 0, routine_id))

    def delete_routine(self, routine_id: str) -> None:
        with self.conn:
            self.conn.execute("DELETE FROM routines WHERE id = ?", (routine_id,))

    def close(self) -> None:
        self.conn.close()
