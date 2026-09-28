import importlib.util
import json
from pathlib import Path
from types import SimpleNamespace

import pytest


MODULE = Path(__file__).with_name("elastic_reviews.py")
SPEC = importlib.util.spec_from_file_location("elastic_reviews", MODULE)
cli = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(cli)


def test_probe_rejects_wrong_native_fps_and_frame_count(monkeypatch, tmp_path):
    movie = tmp_path / "comparison.mp4"
    movie.write_bytes(b"test")
    monkeypatch.setattr(cli.subprocess, "run", lambda *a, **k: SimpleNamespace(
        stdout=json.dumps({"streams": [{"avg_frame_rate": "30/1", "nb_read_frames": "150"}]})))
    with pytest.raises(ValueError, match="reference"):
        cli.probe(movie, "24", 120)
    assert cli.probe(movie, "30", 150) == (30, 150)


def test_upload_resumes_held_part_without_resending(monkeypatch, tmp_path):
    movie = tmp_path / "comparison.mp4"
    movie.write_bytes(b"a" * (5 * 1024 * 1024 + 7))
    monkeypatch.setattr(cli, "probe", lambda *a: (24, 121))
    calls = []
    def gateway(api, key, method, path, body=None):
        calls.append((method, path, body))
        if path.startswith("/assets?"):
            return []
        if path == "/upload/initiate":
            return {"project_id": "project", "asset_id": "asset", "version_id": "version",
                    "upload_id": "upload", "s3_key": "raw/key", "chunk_size_bytes": 5 * 1024 * 1024,
                    "status": "uploading", "replayed": True}
        if path == "/upload/version/parts":
            return {"state": "resumable", "held_part_numbers": [1],
                    "chunk_size_bytes": 5 * 1024 * 1024}
        if path == "/upload/version/presign-part":
            return {"presigned_url": "https://storage.example/part2"}
        if path == "/upload/complete":
            return {"status": "processing"}
        raise AssertionError(path)
    monkeypatch.setattr(cli, "request", gateway)
    class Response:
        headers = {"ETag": '"etag2"'}
        def __enter__(self): return self
        def __exit__(self, *_): pass
    puts = []
    monkeypatch.setattr(cli.urllib.request, "urlopen", lambda request, timeout: (
        puts.append((request.full_url, request.data)) or Response()))
    args = SimpleNamespace(file=str(movie), clip="010_Idle_01", candidate="v02",
                           svn_revision=78, asset_id=None, reference_fps="24", reference_frames=121)
    result = cli.upload_file("https://reviews.elasticlabs.site/api", "test", args)
    assert result["status"] == "processing"
    assert len(puts) == 1 and len(puts[0][1]) == 7
    assert [call[2]["part_number"] for call in calls if call[1].endswith("presign-part")] == [2]


def test_key_file_must_be_owner_only(tmp_path):
    key_file = tmp_path / "key"
    key_file.write_text("rw_" + "a" * 43)
    key_file.chmod(0o644)
    config = tmp_path / "config.json"
    config.write_text(json.dumps({"api_url": "https://reviews.elasticlabs.site/api",
                                  "key_file": str(key_file)}))
    with pytest.raises(ValueError, match="owner"):
        cli.config(config)


def test_node_generates_local_key_and_reports_only_hash(tmp_path):
    config = tmp_path / "protected" / "config.json"
    digest = cli.initialize_key(config, "elastic-5090")
    api, key = cli.config(config)
    assert api == "https://reviews.elasticlabs.site/api"
    assert len(digest) == 64 and digest == cli.hashlib.sha256(key.encode()).hexdigest()
    assert key not in config.read_text()
    assert config.stat().st_mode & 0o077 == 0
