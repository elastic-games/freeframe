from apps.api.config import settings
from apps.api.routers.share import _public_share_url


def test_studio_share_email_uses_portal(monkeypatch):
    monkeypatch.setattr(settings, "studio_sso_enabled", True)
    monkeypatch.setattr(settings, "studio_native_only", False)
    monkeypatch.setattr(settings, "studio_portal_origin", "https://app.elasticlabs.site")
    monkeypatch.setattr(settings, "frontend_url", "https://reviews.elasticlabs.site")
    assert _public_share_url("review-token-123456") == "https://app.elasticlabs.site/share/review-token-123456"


def test_standalone_share_email_keeps_frontend(monkeypatch):
    monkeypatch.setattr(settings, "studio_sso_enabled", False)
    monkeypatch.setattr(settings, "studio_native_only", False)
    monkeypatch.setattr(settings, "frontend_url", "https://reviews.example.com")
    assert _public_share_url("review-token-123456") == "https://reviews.example.com/share/review-token-123456"
