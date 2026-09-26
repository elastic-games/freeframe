"""Keep URL capabilities out of HTTP access records while retaining status logs."""
import logging
import re
from urllib.parse import urlsplit


def safe_access_path(path: str) -> str:
    # Query strings contain HLS/MinIO capabilities; share grants are in the path.
    try:
        clean = urlsplit(path).path
    except ValueError:
        clean = path.split("?", 1)[0].split("#", 1)[0]
    return re.sub(r"(/share/)[^/]+", r"\1[link]", clean)


class SafeAccessFilter(logging.Filter):
    def filter(self, record: logging.LogRecord) -> bool:
        # Uvicorn: (client, method, full_path, HTTP version, status).
        if isinstance(record.args, tuple) and len(record.args) == 5:
            values = list(record.args)
            if isinstance(values[2], str):
                values[2] = safe_access_path(values[2])
                record.args = tuple(values)
        return True
