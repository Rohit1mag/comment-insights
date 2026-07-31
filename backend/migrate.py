#!/usr/bin/env python3
"""
Apply backend/migrations/*.sql in filename order.

Idempotent: each applied filename is recorded in schema_migrations and skipped on
later runs, so this is safe to re-run locally or as a one-off against production.

Usage:
    python backend/migrate.py
"""

import sys
from pathlib import Path

import psycopg

# Works whether invoked as `python backend/migrate.py` or from inside backend/.
sys.path.insert(0, str(Path(__file__).resolve().parent))
from db import database_url  # noqa: E402

MIGRATIONS_DIR = Path(__file__).resolve().parent / "migrations"


def _ensure_ledger(conn) -> None:
    """Create the table that tracks which migration files have been applied."""
    with conn.cursor() as cur:
        cur.execute(
            """
            create table if not exists schema_migrations (
                filename   text primary key,
                applied_at timestamptz not null default now()
            )
            """
        )


def _applied(conn) -> set:
    with conn.cursor() as cur:
        cur.execute("select filename from schema_migrations")
        return {row[0] for row in cur.fetchall()}


def main() -> int:
    url = database_url()
    if not url:
        print("DATABASE_URL is not set; nothing to do.")
        return 1

    files = sorted(MIGRATIONS_DIR.glob("*.sql"))
    if not files:
        print(f"No .sql files found in {MIGRATIONS_DIR}")
        return 0

    with psycopg.connect(url, autocommit=True) as conn:
        _ensure_ledger(conn)
        done = _applied(conn)
        for path in files:
            if path.name in done:
                print(f"skip     {path.name}")
                continue
            # One transaction per file: a failure leaves that file unrecorded.
            with conn.transaction():
                with conn.cursor() as cur:
                    cur.execute(path.read_text())
                    cur.execute(
                        "insert into schema_migrations (filename) values (%s)",
                        (path.name,),
                    )
            print(f"applied  {path.name}")

    print("Migrations up to date.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
