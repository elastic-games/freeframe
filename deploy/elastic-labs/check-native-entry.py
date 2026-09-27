"""Public HTTP regression check for the Elastic dual-dashboard configuration.

No credentials, share grants, or media capabilities are required. A fake share
path checks that guest routes still reach the frontend; it grants no access.
"""

import urllib.error
import urllib.request
import json


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, *args):
        return None


def check_native_entry():
    opener = urllib.request.build_opener(NoRedirect)
    origin = "https://reviews.elasticlabs.site"
    for path in (
        "/", "/login", "/setup", "/projects", "/projects/legacy-bookmark",
    ):
        try:
            response = opener.open(origin + path, timeout=20)
        except urllib.error.HTTPError as error:
            response = error
        with response:
            assert response.status == 307, (path, response.status)
            location = response.headers.get("Location", "")
            assert location.startswith("/studio") or location.startswith(origin + "/studio"), path
            assert "app.elasticlabs.site" not in location, path
        print(f"PASS original dashboard entry: {path}")

    for path, status, content_type in (
        ("/studio", 200, "text/html"),
        ("/share/login-routing-check", 200, "text/html"),
        ("/api/health", 200, "application/json"),
        # Invalid UUID/missing capability must reach API validation, not login.
        ("/stream/hls/login-routing-check/master.m3u8", 422, "application/json"),
    ):
        try:
            response = opener.open(origin + path, timeout=20)
        except urllib.error.HTTPError as error:
            response = error
        with response:
            assert response.status == status, (path, response.status)
            assert response.headers.get("Content-Type", "").startswith(content_type), path
            assert not response.headers.get("Location"), path
        print(f"PASS preserved route: {path}")

    for url, body, headers, expected in (
        (origin + "/api/auth/studio-sso", {"ticket": "invalid"}, {}, 401),
        ("https://app.elasticlabs.site/api/reviews/sso-ticket", {},
         {"Origin": origin}, 401),
        ("https://app.elasticlabs.site/api/reviews/sso-ticket", {},
         # Studio's outer authentication guard may reject the guest before
         # the route's origin guard executes. Both deny ticket issuance.
         {"Origin": "https://example.invalid"}, (401, 403)),
    ):
        request = urllib.request.Request(url, data=json.dumps(body).encode(),
                                         headers={"Content-Type": "application/json", **headers})
        try:
            response = opener.open(request, timeout=20)
        except urllib.error.HTTPError as error:
            response = error
        with response:
            allowed = expected if isinstance(expected, tuple) else (expected,)
            assert response.status in allowed, (url, response.status)
        print(f"PASS authentication boundary: {response.status}")


if __name__ == "__main__":
    check_native_entry()
