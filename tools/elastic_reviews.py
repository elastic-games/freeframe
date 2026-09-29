#!/usr/bin/env python3
"""Project-bound FreeFrame review CLI for Redchain animation workers.

Configuration: ~/.config/elastic-reviews/config.json contains api_url and
key_file. The key itself lives only in the mode-0600 file. No browser session
or FreeFrame user JWT is required.
"""
import argparse
import ctypes
import hashlib
import json
import math
import os
import secrets
import subprocess
import sys
import urllib.error
import urllib.parse
import urllib.request
from fractions import Fraction
from pathlib import Path


def _windows_dpapi(data: bytes, *, protect: bool) -> bytes:
    """Encrypt or decrypt a key for the current Windows user without a passphrase."""
    from ctypes import wintypes

    class Blob(ctypes.Structure):
        _fields_ = [("cbData", wintypes.DWORD), ("pbData", ctypes.POINTER(ctypes.c_byte))]

    source = ctypes.create_string_buffer(data)
    source_blob = Blob(len(data), ctypes.cast(source, ctypes.POINTER(ctypes.c_byte)))
    output_blob = Blob()
    crypt32 = ctypes.windll.crypt32
    operation = crypt32.CryptProtectData if protect else crypt32.CryptUnprotectData
    operation.argtypes = [ctypes.POINTER(Blob), ctypes.c_void_p, ctypes.POINTER(Blob),
                          ctypes.c_void_p, ctypes.c_void_p, wintypes.DWORD, ctypes.POINTER(Blob)]
    operation.restype = wintypes.BOOL
    if not operation(ctypes.byref(source_blob), None, None, None, None, 1,
                     ctypes.byref(output_blob)):
        raise ctypes.WinError()
    try:
        return ctypes.string_at(output_blob.pbData, output_blob.cbData)
    finally:
        local_free = ctypes.windll.kernel32.LocalFree
        local_free.argtypes = [ctypes.c_void_p]
        local_free.restype = ctypes.c_void_p
        local_free(ctypes.cast(output_blob.pbData, ctypes.c_void_p))


def config(path: Path):
    value = json.loads(path.read_text())
    api = value["api_url"].rstrip("/")
    parsed = urllib.parse.urlsplit(api)
    if (parsed.scheme != "https" or parsed.netloc != "reviews.elasticlabs.site" or
            parsed.path != "/api" or parsed.query or parsed.fragment):
        if not (os.getenv("ELASTIC_REVIEWS_LOCAL_TEST") == "1" and
                parsed.scheme == "http" and parsed.hostname in ("127.0.0.1", "localhost")):
            raise ValueError("api_url must be https://reviews.elasticlabs.site/api")
    key_file = Path(value["key_file"]).expanduser()
    if os.name == "nt":
        if key_file.suffix != ".dpapi":
            raise ValueError("Windows review credential must use a DPAPI key file")
        key = _windows_dpapi(key_file.read_bytes(), protect=False).decode().strip()
    else:
        if key_file.stat().st_mode & 0o077:
            raise ValueError("review key file must be readable only by its owner")
        key = key_file.read_text().strip()
    if not key.startswith("rw_"):
        raise ValueError("invalid review credential file")
    return api, key


def initialize_key(config_path: Path, node: str):
    if node not in ("local-mac", "elastic-5090", "elastic-minim4", "elastic-razer-3080", "elastic-2070"):
        raise ValueError("unknown review node")
    if config_path.exists():
        raise ValueError("review config already exists; rotate explicitly")
    directory = config_path.parent
    directory.mkdir(mode=0o700, parents=True, exist_ok=True)
    key_path = directory / (node + (".dpapi" if os.name == "nt" else ".key"))
    key = "rw_" + secrets.token_urlsafe(32)
    fd = os.open(key_path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    with os.fdopen(fd, "wb") as stream:
        stream.write(_windows_dpapi(key.encode(), protect=True) if os.name == "nt"
                     else (key + "\n").encode())
    config_path.write_text(json.dumps({"api_url": "https://reviews.elasticlabs.site/api",
                                       "key_file": str(key_path), "node": node}) + "\n")
    config_path.chmod(0o600)
    return hashlib.sha256(key.encode()).hexdigest()


def request(api: str, key: str, method: str, path: str, body=None):
    encoded = json.dumps(body, separators=(",", ":")).encode() if body is not None else None
    req = urllib.request.Request(api + "/review-workers" + path,
        data=encoded, method=method,
        headers={"X-Review-Key": key, "Accept": "application/json",
                 **({"Content-Type": "application/json"} if encoded is not None else {})})
    try:
        with urllib.request.urlopen(req, timeout=45) as response:
            raw = response.read(4_000_001)
            if len(raw) > 4_000_000:
                raise ValueError("review response too large")
            return json.loads(raw) if raw else None
    except urllib.error.HTTPError as exc:
        try:
            detail = json.loads(exc.read(4096)).get("detail", "Review request failed")
        except (ValueError, AttributeError):
            detail = "Review request failed"
        raise ValueError(f"Review API {exc.code}: {detail}") from None


def probe(path: Path, expected_fps: str, expected_frames: int):
    command = ["ffprobe", "-v", "error", "-count_frames", "-select_streams", "v:0",
               "-show_entries", "stream=avg_frame_rate,nb_read_frames", "-of", "json", str(path)]
    result = subprocess.run(command, check=True, capture_output=True, text=True)
    streams = json.loads(result.stdout)["streams"]
    if len(streams) != 1:
        raise ValueError("expected one video stream")
    actual_fps = Fraction(streams[0]["avg_frame_rate"])
    actual_frames = int(streams[0]["nb_read_frames"])
    if actual_fps != Fraction(expected_fps) or actual_frames != expected_frames:
        raise ValueError(f"comparison is {actual_frames} frames at {actual_fps} fps; "
                         f"reference is {expected_frames} frames at {expected_fps} fps")
    return actual_fps, actual_frames


def sha256_file(path: Path):
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        while chunk := stream.read(8 * 1024 * 1024):
            digest.update(chunk)
    return digest.hexdigest()


def upload_file(api, key, args):
    path = Path(args.file).expanduser().resolve()
    if not path.is_file() or path.suffix.lower() != ".mp4":
        raise ValueError("upload requires an existing MP4 file")
    fps, frames = probe(path, args.reference_fps, args.reference_frames)
    digest = sha256_file(path)
    if not args.asset_id:
        matches = request(api, key, "GET", "/assets?" +
                          urllib.parse.urlencode({"clip": args.clip}))
        if len(matches) > 1:
            raise ValueError("multiple clip assets exist; pass --asset-id explicitly")
        if matches:
            args.asset_id = matches[0]["asset_id"]
    stable = json.dumps([args.clip, args.candidate, digest, args.svn_revision],
                        separators=(",", ":"))
    idempotency = hashlib.sha256(stable.encode()).hexdigest()[:40]
    body = {"clip": args.clip, "candidate": args.candidate, "sha256": digest,
            "svn_revision": args.svn_revision, "idempotency_key": idempotency,
            "original_filename": path.name, "file_size_bytes": path.stat().st_size,
            "asset_id": args.asset_id}
    session = request(api, key, "POST", "/upload/initiate", body)
    version = session["version_id"]
    if session["status"] != "uploading":
        return {"asset_id": session["asset_id"], "version_id": version,
                "status": session["status"], "replayed": True,
                "review_url": review_url(session["project_id"], session["asset_id"], version)}
    chunk_size = session["chunk_size_bytes"]
    if not isinstance(chunk_size, int) or chunk_size < 5 * 1024 * 1024:
        raise ValueError("server returned an invalid upload chunk size")
    held = set()
    assembled = False
    if session["replayed"]:
        parts_state = request(api, key, "GET", f"/upload/{version}/parts")
        if parts_state["state"] == "resumable":
            held = set(parts_state["held_part_numbers"])
        else:
            assembled = True
        if parts_state["chunk_size_bytes"] != chunk_size:
            raise ValueError("upload chunk size changed; stop and inspect")
    total = math.ceil(path.stat().st_size / chunk_size)
    if total > 10_000:
        raise ValueError("MP4 exceeds multipart upload limit")
    uploaded = []
    with path.open("rb") as stream:
        for part in range(1, total + 1):
            block = stream.read(chunk_size)
            if part in held or assembled:
                continue
            signed = request(api, key, "POST", f"/upload/{version}/presign-part",
                             {"s3_key": session["s3_key"], "upload_id": session["upload_id"],
                              "part_number": part})
            with urllib.request.urlopen(urllib.request.Request(signed["presigned_url"],
                    data=block, method="PUT"), timeout=180) as response:
                etag = response.headers.get("ETag")
            if etag:
                uploaded.append({"PartNumber": part, "ETag": etag})
            print(f"part {part}/{total} uploaded", file=sys.stderr)
    finished = request(api, key, "POST", "/upload/complete",
        {"s3_key": session["s3_key"], "upload_id": session["upload_id"],
         "asset_id": session["asset_id"], "version_id": version, "parts": uploaded})
    return {"asset_id": session["asset_id"], "version_id": version,
            "status": finished["status"], "replayed": session["replayed"],
            "sha256": digest, "svn_revision": args.svn_revision,
            "fps": str(fps), "frames": frames,
            "review_url": review_url(session["project_id"], session["asset_id"], version)}


def review_url(project, asset, version):
    return f"https://app.elasticlabs.site/apps/reviews/projects/{project}/assets/{asset}?version={version}"


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--config", type=Path, default=Path("~/.config/elastic-reviews/config.json").expanduser())
    sub = parser.add_subparsers(dest="command", required=True)
    initialize = sub.add_parser("init-key")
    initialize.add_argument("--node", required=True)
    listing = sub.add_parser("list")
    listing.add_argument("--clip")
    status = sub.add_parser("status")
    status.add_argument("--clip", required=True)
    comments = sub.add_parser("comments")
    comments.add_argument("--asset", required=True)
    comments.add_argument("--version", required=True)
    comment = sub.add_parser("comment")
    comment.add_argument("--asset", required=True)
    comment.add_argument("--version", required=True)
    comment.add_argument("--svn-revision", type=int, required=True)
    comment.add_argument("--body", required=True)
    comment.add_argument("--timecode-start", type=float)
    comment.add_argument("--timecode-end", type=float)
    uploading = sub.add_parser("upload")
    uploading.add_argument("--clip", required=True)
    uploading.add_argument("--candidate", required=True)
    uploading.add_argument("--svn-revision", type=int, required=True)
    uploading.add_argument("--file", required=True)
    uploading.add_argument("--reference-fps", required=True)
    uploading.add_argument("--reference-frames", type=int, required=True)
    uploading.add_argument("--asset-id")
    reply = sub.add_parser("reply")
    reply.add_argument("--asset", required=True)
    reply.add_argument("--version", required=True)
    reply.add_argument("--corrected-version", required=True)
    reply.add_argument("--comment", required=True)
    reply.add_argument("--svn-revision", type=int, required=True)
    reply.add_argument("--body", required=True)
    args = parser.parse_args()
    try:
        if args.command == "init-key":
            print(json.dumps({"node": args.node, "key_hash": initialize_key(args.config, args.node)}, indent=2))
            return 0
        api, key = config(args.config)
        if args.command in ("list", "status"):
            query = "?" + urllib.parse.urlencode({"clip": args.clip}) if args.clip else ""
            output = request(api, key, "GET", "/assets" + query)
            if args.command == "status":
                for asset in output:
                    asset["review_url"] = review_url(asset["project_id"], asset["asset_id"],
                                                      asset["versions"][0]["version_id"]) if asset["versions"] else None
                    for version in asset["versions"]:
                        comments = request(api, key, "GET",
                            f"/assets/{asset['asset_id']}/comments?" +
                            urllib.parse.urlencode({"version_id": version["version_id"]}))
                        version["pending_public_comments"] = sum(not comment["resolved"] for comment in comments)
        elif args.command == "comments":
            output = request(api, key, "GET", f"/assets/{args.asset}/comments?" +
                             urllib.parse.urlencode({"version_id": args.version}))
        elif args.command == "upload":
            output = upload_file(api, key, args)
        elif args.command == "comment":
            stable = json.dumps([args.asset, args.version, args.body, args.timecode_start,
                                 args.timecode_end, args.svn_revision], separators=(",", ":"))
            output = request(api, key, "POST", f"/assets/{args.asset}/comments",
                {"version_id": args.version, "body": args.body,
                 "timecode_start": args.timecode_start, "timecode_end": args.timecode_end,
                 "svn_revision": args.svn_revision,
                 "idempotency_key": hashlib.sha256(stable.encode()).hexdigest()[:40]})
        else:
            stable = json.dumps([args.asset, args.version, args.corrected_version, args.comment, args.body,
                                 args.svn_revision], separators=(",", ":"))
            output = request(api, key, "POST", f"/assets/{args.asset}/comments/{args.comment}/replies",
                {"version_id": args.version, "corrected_version_id": args.corrected_version,
                 "body": args.body,
                 "svn_revision": args.svn_revision,
                 "idempotency_key": hashlib.sha256(stable.encode()).hexdigest()[:40]})
        print(json.dumps(output, ensure_ascii=False, indent=2))
    except (OSError, ValueError, subprocess.CalledProcessError, KeyError, ZeroDivisionError) as error:
        print(f"elastic-reviews: {error}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
