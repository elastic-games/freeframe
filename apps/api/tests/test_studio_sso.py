"""Studio SSO tickets cannot be forged or replayed; IDs bind to Studio accounts."""

import base64
import hashlib
import hmac
import json
import time
import uuid
from unittest.mock import MagicMock, patch

import pytest
from fastapi import HTTPException

from apps.api.config import settings
from apps.api.services.studio_sso import _decode_ticket, exchange_studio_ticket
from apps.api.routers.auth import _require_native_auth


SECRET = "test-studio-bridge-secret-that-is-long-enough"


def ticket(**changes):
    now = int(time.time())
    claims = {
        "iss": "elastic-labs-studio", "aud": "elastic-freeframe",
        "sub": str(uuid.uuid4()), "email": "owner@auth.elasticlabs.local",
        "name": "Studio Owner", "admin": True,
        "iat": now, "exp": now + 45, "jti": str(uuid.uuid4()),
    }
    claims.update(changes)
    body = base64.urlsafe_b64encode(json.dumps(claims, separators=(",", ":")).encode()).decode().rstrip("=")
    sig = base64.urlsafe_b64encode(hmac.new(SECRET.encode(), body.encode(), hashlib.sha256).digest()).decode().rstrip("=")
    return f"{body}.{sig}", claims


@pytest.fixture(autouse=True)
def configure_sso(monkeypatch):
    monkeypatch.setattr(settings, "studio_sso_enabled", True)
    monkeypatch.setattr(settings, "studio_sso_secret", SECRET)


def test_rejects_tampered_and_expired_tickets():
    valid, _ = ticket()
    with pytest.raises(HTTPException) as tampered:
        _decode_ticket(("A" if valid[0] != "A" else "B") + valid[1:])
    assert tampered.value.status_code == 401
    expired, _ = ticket(exp=int(time.time()) - 1)
    with pytest.raises(HTTPException) as old:
        _decode_ticket(expired)
    assert old.value.status_code == 401


def test_first_studio_admin_provisions_matching_identity_and_replay_fails():
    assertion, claims = ticket()
    db = MagicMock()
    db.query.return_value.filter.return_value.first.return_value = None
    redis = MagicMock()
    redis.set.side_effect = [True, False]
    with patch("apps.api.services.studio_sso.get_redis", return_value=redis), \
         patch("apps.api.services.studio_sso.create_access_token", return_value="access"):
        assert exchange_studio_ticket(assertion, db) == "access"
        with pytest.raises(HTTPException) as replay:
            exchange_studio_ticket(assertion, db)
    assert replay.value.status_code == 401
    created = db.add.call_args.args[0]
    assert created.id == uuid.UUID(claims["sub"])
    assert created.email == claims["email"]
    assert created.is_superadmin is True
    assert created.password_hash is None
    assert created.preferences == {"studio_sso": True}


def test_non_admin_cannot_claim_empty_instance():
    assertion, _ = ticket(admin=False)
    db = MagicMock()
    db.query.return_value.filter.return_value.first.return_value = None
    redis = MagicMock()
    redis.set.return_value = True
    with patch("apps.api.services.studio_sso.get_redis", return_value=redis):
        with pytest.raises(HTTPException) as rejected:
            exchange_studio_ticket(assertion, db)
    assert rejected.value.status_code == 403
    db.add.assert_not_called()


def test_native_auth_is_closed_in_studio_mode():
    with pytest.raises(HTTPException) as rejected:
        _require_native_auth()
    assert rejected.value.status_code == 404
