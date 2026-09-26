"""Public HTTP regression check for the Elastic native-only entry configuration.

No credentials, share grants, or media capabilities are required. A fake share
path checks that guest routes still reach the frontend; it grants no access.
"""

import urllib.error
import urllib.request


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, *args):
        return None


def check_native_entry():
    opener = urllib.request.build_opener(NoRedirect)
    origin = "https://reviews.elasticlabs.site"
    destination = "https://app.elasticlabs.site/apps/reviews"
    for path in (
        "/", "/login", "/setup", "/studio", "/projects",
        "/projects/legacy-bookmark",
        "/studio?from=https%3A%2F%2Fexample.invalid%2F&ticket=ignored",
    ):
        try:
            response = opener.open(origin + path, timeout=20)
        except urllib.error.HTTPError as error:
            response = error
        with response:
            assert response.status == 302, (path, response.status)
            assert response.headers.get("Location") == destination, path
        print(f"PASS native entry: {path.split('?')[0]}")

    for path, status, content_type in (
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


if __name__ == "__main__":
    check_native_entry()
