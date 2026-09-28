"""Recheck Studio's current Giant & Ghosts provider binding on every worker call."""
import hashlib
import hmac
import time
import urllib.error
import urllib.parse
import urllib.request

from fastapi import HTTPException

from ..config import settings

_URL = "https://app.elasticlabs.site/api/studio/review-worker-binding"


def require_studio_binding(organization_id, project_id):
    secret = settings.studio_native_secret
    if not secret or len(secret) < 32:
        raise HTTPException(status_code=503, detail="Review binding unavailable")
    timestamp = str(int(time.time()))
    organization = str(organization_id).lower()
    project = str(project_id).lower()
    signature = hmac.new(secret.encode(),
        f"review-worker-binding:v1\n{organization}\n{project}\n{timestamp}".encode(),
        hashlib.sha256).hexdigest()
    url = _URL + "?" + urllib.parse.urlencode({"organization": organization, "project": project})
    request = urllib.request.Request(url, headers={
        "X-Review-Binding-Time": timestamp,
        "X-Review-Binding-Signature": signature,
    })
    try:
        with urllib.request.urlopen(request, timeout=5) as response:
            if response.status == 204 and response.url == url:
                return
    except urllib.error.HTTPError as error:
        if error.code == 403:
            raise HTTPException(status_code=403, detail="Review binding revoked") from None
    except (urllib.error.URLError, TimeoutError):
        pass
    raise HTTPException(status_code=503, detail="Review binding unavailable")
