#!/usr/bin/env python3
"""
Clerk session-token verification.

Works with zero extra config: the Clerk frontend API host (and therefore the
JWKS URL and issuer) is decoded from the publishable key. CLERK_JWKS_URL /
CLERK_ISSUER override the derivation when needed.
"""

import base64
import os
import threading
import time
from typing import Dict, Optional, Tuple

import jwt
import requests
from jwt import PyJWKClient

JWKS_CACHE_SECS = 3600
# sub -> email needs a Clerk Backend API round trip, so cache it too
USER_EMAIL_CACHE_SECS = 900
CLERK_HTTP_TIMEOUT_SECS = 5

# Set by a Clerk session token template, e.g. {"email": "{{user.primary_email_address}}"}
_EMAIL_CLAIMS = ("email", "email_address", "primary_email_address", "user_email")

_jwks_client: Optional[PyJWKClient] = None
_jwks_lock = threading.Lock()
_email_cache: Dict[str, Tuple[str, float]] = {}
_email_lock = threading.Lock()


class ClerkAuthError(Exception):
    """Token is missing, malformed, expired, or otherwise not verifiable."""


def _publishable_key() -> str:
    return (
        os.getenv("CLERK_PUBLISHABLE_KEY")
        or os.getenv("NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY")
        or ""
    ).strip()


def _frontend_api_host() -> Optional[str]:
    """Decode pk_test_/pk_live_ into the Clerk frontend API host."""
    pk = _publishable_key()
    encoded = ""
    for prefix in ("pk_test_", "pk_live_"):
        if pk.startswith(prefix):
            encoded = pk[len(prefix):]
            break
    if not encoded:
        return None
    try:
        # Clerk drops base64 padding
        decoded = base64.b64decode(encoded + "=" * (-len(encoded) % 4)).decode("utf-8")
    except (ValueError, UnicodeDecodeError):
        return None
    host = decoded.strip().rstrip("$")
    return host or None


def _issuer() -> Optional[str]:
    explicit = (os.getenv("CLERK_ISSUER") or "").strip().rstrip("/")
    if explicit:
        return explicit
    host = _frontend_api_host()
    return f"https://{host}" if host else None


def _jwks_url() -> str:
    explicit = (os.getenv("CLERK_JWKS_URL") or "").strip()
    if explicit:
        return explicit
    issuer = _issuer()
    if not issuer:
        raise ClerkAuthError("Clerk instance not configured")
    return f"{issuer}/.well-known/jwks.json"


def clerk_configured() -> bool:
    try:
        return bool(_jwks_url())
    except ClerkAuthError:
        return False


def _get_jwks_client() -> PyJWKClient:
    """Cached JWKS client. Unknown kid triggers a refetch, so rotation just works."""
    global _jwks_client
    url = _jwks_url()
    with _jwks_lock:
        if _jwks_client is None or _jwks_client.uri != url:
            _jwks_client = PyJWKClient(
                url,
                cache_keys=True,
                lifespan=JWKS_CACHE_SECS,
                timeout=CLERK_HTTP_TIMEOUT_SECS,
            )
        return _jwks_client


def verify_session_token(token: str) -> Dict:
    """Verify a Clerk session JWT (RS256 against Clerk's JWKS) and return its claims."""
    if not token:
        raise ClerkAuthError("Missing token")

    try:
        signing_key = _get_jwks_client().get_signing_key_from_jwt(token)
    except ClerkAuthError:
        raise
    except Exception as exc:
        raise ClerkAuthError(f"Could not resolve signing key: {exc}") from exc

    try:
        return jwt.decode(
            token,
            signing_key.key,
            algorithms=["RS256"],
            issuer=_issuer(),
            # Clerk session tokens have no fixed aud by default
            options={"verify_aud": False, "require": ["exp", "sub"]},
            leeway=5,
        )
    except jwt.PyJWTError as exc:
        raise ClerkAuthError(str(exc)) from exc


def _email_from_claims(claims: Dict) -> Optional[str]:
    for name in _EMAIL_CLAIMS:
        value = claims.get(name)
        if isinstance(value, str) and "@" in value:
            return value.strip()
    return None


def _cached_email(user_id: str) -> Optional[str]:
    with _email_lock:
        hit = _email_cache.get(user_id)
        if hit and hit[1] > time.monotonic():
            return hit[0]
        _email_cache.pop(user_id, None)
    return None


def _fetch_primary_email(user_id: str) -> Optional[str]:
    secret = (os.getenv("CLERK_SECRET_KEY") or "").strip()
    if not secret:
        return None
    try:
        resp = requests.get(
            f"https://api.clerk.com/v1/users/{user_id}",
            headers={"Authorization": f"Bearer {secret}"},
            timeout=CLERK_HTTP_TIMEOUT_SECS,
        )
        resp.raise_for_status()
        data = resp.json()
    except (requests.RequestException, ValueError):
        return None

    addresses = [a for a in (data.get("email_addresses") or []) if isinstance(a, dict)]
    primary_id = data.get("primary_email_address_id")
    ordered = [a for a in addresses if primary_id and a.get("id") == primary_id] + addresses
    for entry in ordered:
        email = (entry.get("email_address") or "").strip()
        if email:
            return email
    return None


def email_from_session_token(token: str) -> str:
    """Verify a session token and resolve the signed-in user's primary email."""
    claims = verify_session_token(token)

    email = _email_from_claims(claims)
    if email:
        return email

    user_id = claims.get("sub")
    cached = _cached_email(user_id)
    if cached:
        return cached

    email = _fetch_primary_email(user_id)
    if not email:
        raise ClerkAuthError("Could not resolve an email address for this user")
    with _email_lock:
        _email_cache[user_id] = (email, time.monotonic() + USER_EMAIL_CACHE_SECS)
    return email
