import logging
from apps.api.services.safe_access_log import SafeAccessFilter, safe_access_path


def test_hls_and_storage_queries_do_not_reach_access_log():
    assert safe_access_path('/stream/hls/master.m3u8?token=private') == '/stream/hls/master.m3u8'
    assert safe_access_path('/media/file?X-Amz-Signature=private') == '/media/file'


def test_share_capability_path_is_redacted():
    assert safe_access_path('/share/private-grant/comments?password=private') == '/share/[link]/comments'


def test_uvicorn_record_retains_method_status_without_capability():
    record = logging.LogRecord('uvicorn.access', logging.INFO, '', 0, '%s %s %s %s %s',
                               ('127.0.0.1', 'GET', '/stream/hls/master.m3u8?token=private', '1.1', 200), None)
    assert SafeAccessFilter().filter(record)
    assert record.args == ('127.0.0.1', 'GET', '/stream/hls/master.m3u8', '1.1', 200)
    assert 'private' not in record.getMessage()


def test_malformed_url_cannot_break_logging_or_leak_query():
    assert safe_access_path("//[?token=private") == "//["
