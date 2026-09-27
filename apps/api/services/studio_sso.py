"""Exchange a short-lived Studio identity assertion for a FreeFrame session."""

import base64
import binascii
import hashlib
import hmac
import json
import time
import uuid

from fastapi import HTTPException
from sqlalchemy.orm import Session

from ..config import settings
from ..models.user import User, UserStatus
from .auth_service import create_access_token
from .redis_service import get_redis


def _decode_ticket(ticket: str) -> dict:
    secret = settings.studio_sso_secret
    if not settings.studio_sso_enabled or not secret or len(secret) < 32:
        raise HTTPException(status_code=503, detail="Studio SSO is unavailable")
    try:
        body, supplied = ticket.split(".")
        if len(ticket) > 4096:
            raise ValueError("oversized ticket")
        expected = hmac.new(secret.encode(), body.encode(), hashlib.sha256).digest()
        actual = base64.urlsafe_b64decode(supplied + "=" * (-len(supplied) % 4))
        if not hmac.compare_digest(actual, expected):
            raise ValueError("bad signature")
        payload = json.loads(base64.urlsafe_b64decode(body + "=" * (-len(body) % 4)))
        now = int(time.time())
        if (
            not isinstance(payload, dict)
            or payload.get("iss") != "elastic-labs-studio"
            or payload.get("aud") != "elastic-freeframe"
            or not isinstance(payload.get("iat"), int)
            or not isinstance(payload.get("exp"), int)
            or payload["iat"] > now + 5
            or payload["exp"] <= now
            or payload["exp"] - payload["iat"] > 60
            or not isinstance(payload.get("jti"), str)
            or not isinstance(payload.get("sub"), str)
        ):
            raise ValueError("invalid claims")
        uuid.UUID(payload["jti"])
        uuid.UUID(payload["sub"])
        if not isinstance(payload.get("email"), str) or not payload["email"].strip():
            raise ValueError("missing email")
        if not isinstance(payload.get("name"), str):
            raise ValueError("missing name")
        if not isinstance(payload.get("admin"), bool):
            raise ValueError("missing role")
        return payload
    except (ValueError, TypeError, KeyError, UnicodeError, binascii.Error):
        raise HTTPException(status_code=401, detail="Invalid Studio sign-in ticket") from None


def exchange_studio_ticket(ticket: str, db: Session) -> str:
    payload = _decode_ticket(ticket)
    # Redis must be available. SET NX makes a captured ticket useless on replay.
    try:
        claimed = get_redis().set(f"studio_sso:{payload['jti']}", "1", nx=True, ex=90)
    except Exception:
        raise HTTPException(status_code=503, detail="Studio SSO replay protection unavailable") from None
    if not claimed:
        raise HTTPException(status_code=401, detail="Studio sign-in ticket already used")

    user_id = uuid.UUID(payload["sub"])
    email = payload["email"].strip().lower()
    if len(email) > 255 or "@" not in email:
        raise HTTPException(status_code=401, detail="Invalid Studio identity")
    name = payload["name"].strip()[:255] or "Studio member"
    user = db.query(User).filter(User.id == user_id).first()
    if user:
        if user.deleted_at is not None:
            raise HTTPException(status_code=403, detail="FreeFrame account is disabled")
        if not (user.preferences or {}).get("studio_sso"):
            raise HTTPException(status_code=409, detail="FreeFrame identity collision")
        if user.status == UserStatus.deactivated:
            raise HTTPException(status_code=403, detail="FreeFrame account is deactivated")
    else:
        collision = db.query(User).filter(User.email == email, User.deleted_at.is_(None)).first()
        if collision:
            raise HTTPException(status_code=409, detail="FreeFrame email collision")
        if not payload["admin"] and not db.query(User).filter(User.is_superadmin == True, User.deleted_at.is_(None)).first():
            raise HTTPException(status_code=403, detail="A Studio admin must open FreeFrame first")
        user = User(id=user_id, email=email, name=name, password_hash=None,
                    status=UserStatus.active, is_superadmin=payload["admin"],
                    email_verified=True, preferences={"studio_sso": True})
        db.add(user)

    if user.email != email:
        collision = db.query(User).filter(User.email == email, User.deleted_at.is_(None)).first()
        if collision and collision.id != user_id:
            raise HTTPException(status_code=409, detail="FreeFrame email collision")
        user.email = email
    user.name = name
    user.is_superadmin = payload["admin"]
    user.email_verified = True
    db.commit()
    return create_access_token(str(user_id), token_version=user.token_version)
