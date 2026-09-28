"""The provider must consult Studio for the current project binding."""
import hashlib
import hmac
import uuid
from types import SimpleNamespace
from unittest.mock import patch

import pytest
from fastapi import HTTPException

from apps.api.services import review_worker_binding as binding


def test_signed_check_uses_live_studio_binding_and_exact_response(monkeypatch):
    project = uuid.uuid4()
    organization = uuid.uuid4()
    monkeypatch.setattr(binding.settings, "studio_native_secret", "x" * 40)
    monkeypatch.setattr(binding.time, "time", lambda: 1_800_000_000)
    captured = {}
    class Response:
        status = 204
        def __init__(self, url): self.url = url
        def __enter__(self): return self
        def __exit__(self, *_): pass
    def open_request(request, timeout):
        captured["request"] = request
        assert timeout == 5
        return Response(request.full_url)
    monkeypatch.setattr(binding.urllib.request, "urlopen", open_request)
    binding.require_studio_binding(organization, project)
    request = captured["request"]
    assert request.full_url.startswith("https://app.elasticlabs.site/api/studio/review-worker-binding?")
    expected = hmac.new(b"x" * 40,
        f"review-worker-binding:v1\n{organization}\n{project}\n1800000000".encode(), hashlib.sha256).hexdigest()
    assert request.headers["X-review-binding-signature"] == expected


def test_studio_unavailability_fails_closed(monkeypatch):
    monkeypatch.setattr(binding.settings, "studio_native_secret", "x" * 40)
    monkeypatch.setattr(binding.urllib.request, "urlopen", lambda *_a, **_k: (_ for _ in ()).throw(TimeoutError()))
    with pytest.raises(HTTPException) as denied:
        binding.require_studio_binding(uuid.uuid4(), uuid.uuid4())
    assert denied.value.status_code == 503
