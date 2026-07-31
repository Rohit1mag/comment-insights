#!/usr/bin/env python3
"""
Postgres (Neon) persistence for Disstill analysis history.

Import-safe: nothing here touches the network or requires DATABASE_URL at import
time, because main.py is imported during Vercel builds and cold starts.
"""

import os
import uuid
from datetime import datetime
from pathlib import Path
from typing import Dict, List, Optional

import psycopg
from psycopg.rows import dict_row
from psycopg.types.json import Jsonb

_REPO_ROOT = Path(__file__).resolve().parent.parent

# The Neon vars were pulled into the root .env.local, but main.py's load_dotenv()
# only picks up .env — so look in both here rather than changing main.py.
_ENV_FILES = (_REPO_ROOT / ".env.local", _REPO_ROOT / ".env")

# Fluid Compute reuses instances between requests, so one cached connection is
# worth keeping; Neon's pooler sits in front of it already.
_conn = None
_env_loaded = False

# Columns returned by list_analyses — summary is deliberately excluded to keep
# history payloads small.
_LIST_COLUMNS = (
    "id, video_id, video_title, video_url, total_comments, sentiment, created_at"
)
_FULL_COLUMNS = (
    "id, user_email, video_id, video_title, video_url, total_comments, "
    "summary, sentiment, action_items, created_at"
)

DEFAULT_LIST_LIMIT = 20
MAX_LIST_LIMIT = 100


def _load_env_files() -> None:
    """Load the root dotenv files once. Real env vars always win."""
    global _env_loaded
    if _env_loaded:
        return
    _env_loaded = True
    try:
        from dotenv import load_dotenv
    except ImportError:
        return
    for path in _ENV_FILES:
        if path.exists():
            load_dotenv(path, override=False)


def database_url() -> Optional[str]:
    """Resolve DATABASE_URL lazily: platform env first, then root dotenv files."""
    url = os.getenv("DATABASE_URL")
    if url:
        return url
    _load_env_files()
    return os.getenv("DATABASE_URL") or None


def configured() -> bool:
    """Whether a database is available at all (callers can skip history if not)."""
    return database_url() is not None


def _connect():
    """Open a new autocommit connection to the pooled DATABASE_URL."""
    url = database_url()
    if not url:
        raise RuntimeError("DATABASE_URL is not set")
    return psycopg.connect(url, autocommit=True)


def _get_conn():
    global _conn
    if _conn is None or _conn.closed or _conn.broken:
        _conn = _connect()
    return _conn


def _reset_conn() -> None:
    global _conn
    if _conn is not None:
        try:
            _conn.close()
        except Exception:
            pass
    _conn = None


def _run(operation):
    """Run operation(conn) on the cached connection, reconnecting once if it died.

    Neon closes idle connections (scale-to-zero, pooler recycling), so the first
    query after an idle gap can fail on an otherwise healthy handle.
    """
    try:
        return operation(_get_conn())
    except (psycopg.OperationalError, psycopg.InterfaceError):
        _reset_conn()
        return operation(_get_conn())


def _jsonable(value):
    """Coerce pydantic models into plain dicts/lists so jsonb can take them."""
    if isinstance(value, list):
        return [_jsonable(v) for v in value]
    if isinstance(value, dict):
        return {k: _jsonable(v) for k, v in value.items()}
    if hasattr(value, "model_dump"):
        return value.model_dump()
    if hasattr(value, "dict"):
        return value.dict()
    return value


def _serialize_row(row: Dict) -> Dict:
    """Make a row JSON-serializable: uuid -> str, datetime -> ISO 8601."""
    out = {}
    for key, value in row.items():
        if isinstance(value, uuid.UUID):
            out[key] = str(value)
        elif isinstance(value, datetime):
            out[key] = value.isoformat()
        else:
            out[key] = value
    return out


def _parse_cursor(before) -> Optional[datetime]:
    """Accept a datetime or ISO 8601 string cursor; ignore anything unparseable."""
    if not before:
        return None
    if isinstance(before, datetime):
        return before
    try:
        return datetime.fromisoformat(str(before).replace("Z", "+00:00"))
    except ValueError:
        return None


def save_analysis(
    user_email: str,
    video_id: str,
    video_title: Optional[str],
    video_url: Optional[str],
    total_comments: Optional[int],
    summary: Optional[str],
    sentiment: Optional[Dict[str, int]],
    action_items: Optional[List[Dict]],
) -> Optional[str]:
    """Persist one analysis and return its id, or None if it could not be saved.

    Never raises: this runs after a successful analysis, and a database problem
    must not cost the user their result.
    """
    if not user_email or not video_id:
        return None

    def operation(conn):
        with conn.cursor() as cur:
            cur.execute(
                """
                insert into analyses (
                    user_email, video_id, video_title, video_url,
                    total_comments, summary, sentiment, action_items
                )
                values (%s, %s, %s, %s, %s, %s, %s, %s)
                returning id
                """,
                (
                    user_email,
                    video_id,
                    video_title,
                    video_url,
                    total_comments,
                    summary,
                    Jsonb(_jsonable(sentiment) if sentiment is not None else {}),
                    Jsonb(_jsonable(action_items) if action_items is not None else []),
                ),
            )
            row = cur.fetchone()
            return str(row[0]) if row else None

    try:
        return _run(operation)
    except Exception as exc:
        print(f"save_analysis failed: {type(exc).__name__}")
        return None


def list_analyses(
    user_email: str,
    limit: int = DEFAULT_LIST_LIMIT,
    before=None,
) -> List[Dict]:
    """Return a user's analyses, newest first, without the summary field.

    `before` is a keyset cursor — pass the created_at of the last row already
    shown (datetime or ISO 8601 string) to get the next page. An unparseable
    cursor is ignored and the first page is returned.
    """
    if not user_email:
        return []

    try:
        limit = int(limit)
    except (TypeError, ValueError):
        limit = DEFAULT_LIST_LIMIT
    limit = max(1, min(limit, MAX_LIST_LIMIT))
    cursor_ts = _parse_cursor(before)

    def operation(conn):
        with conn.cursor(row_factory=dict_row) as cur:
            if cursor_ts is None:
                cur.execute(
                    f"""
                    select {_LIST_COLUMNS}
                    from analyses
                    where user_email = %s
                    order by created_at desc
                    limit %s
                    """,
                    (user_email, limit),
                )
            else:
                cur.execute(
                    f"""
                    select {_LIST_COLUMNS}
                    from analyses
                    where user_email = %s and created_at < %s
                    order by created_at desc
                    limit %s
                    """,
                    (user_email, cursor_ts, limit),
                )
            return [_serialize_row(row) for row in cur.fetchall()]

    return _run(operation)


def get_analysis(analysis_id: str, user_email: str) -> Optional[Dict]:
    """Return one full analysis owned by user_email, or None.

    user_email is always part of the WHERE clause so an id leaked from one
    account cannot read another account's row.
    """
    if not analysis_id or not user_email:
        return None
    try:
        row_id = uuid.UUID(str(analysis_id))
    except (ValueError, AttributeError, TypeError):
        return None

    def operation(conn):
        with conn.cursor(row_factory=dict_row) as cur:
            cur.execute(
                f"""
                select {_FULL_COLUMNS}
                from analyses
                where id = %s and user_email = %s
                """,
                (row_id, user_email),
            )
            row = cur.fetchone()
            return _serialize_row(row) if row else None

    return _run(operation)
