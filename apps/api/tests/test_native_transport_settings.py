"""Actual library URL/pool construction; no database/Redis listener is contacted."""
import json
import os
import subprocess
import sys

import pytest
from pydantic import ValidationError

from apps.api.config import Settings


def settings(**overrides):
    return Settings(_env_file=None, database_url="postgresql://fixture@localhost/fixture",
                    redis_url="redis://localhost:6379/0", jwt_secret="synthetic-only", **overrides)


def test_existing_transport_pool_defaults_are_preserved():
    value = settings()
    assert (value.database_pool_size, value.database_max_overflow, value.database_pool_timeout) == (5, 10, 30)
    assert value.celery_broker_url is None and value.celery_result_backend_url is None


@pytest.mark.parametrize("values", [{"database_pool_size": 0}, {"database_max_overflow": -1}, {"database_pool_timeout": 0}])
def test_invalid_pool_capacity_is_rejected(values):
    with pytest.raises(ValidationError):
        settings(**values)


def test_socket_overrides_construct_actual_pool_and_celery_clients():
    environment = dict(os.environ, DATABASE_URL="postgresql://fixture@/fixture?host=/run/freeframe-pg", REDIS_URL="unix:///run/freeframe-redis.sock?db=0",
                       CELERY_BROKER_URL="redis+socket:///run/freeframe-redis.sock?virtual_host=0", CELERY_RESULT_BACKEND_URL="redis+socket:///run/freeframe-redis.sock?virtual_host=1",
                       DATABASE_POOL_SIZE="1", DATABASE_MAX_OVERFLOW="0", DATABASE_POOL_TIMEOUT="5", JWT_SECRET="synthetic-only")
    code = '''import json
from apps.api.database import engine
from apps.api.tasks.celery_app import celery_app
from redis import Redis
from apps.api.config import settings
cache = Redis.from_url(settings.redis_url)
print(json.dumps({"pool": engine.pool.size(), "overflow": engine.pool._max_overflow, "timeout": engine.pool.timeout(), "socket": engine.url.query["host"], "cache": cache.connection_pool.connection_class.__name__, "broker": celery_app.conf.broker_url, "result": celery_app.backend.url, "result_class": celery_app.backend.client.connection_pool.connection_class.__name__, "result_db": celery_app.backend.connparams["db"]}))
'''
    result = subprocess.run([sys.executable, "-c", code], env=environment, check=True, capture_output=True, text=True)
    value = json.loads(result.stdout)
    assert (value["pool"], value["overflow"], value["timeout"]) == (1, 0, 5)
    assert value["socket"] == "/run/freeframe-pg"
    assert value["cache"] == "UnixDomainSocketConnection"
    assert value["broker"] == environment["CELERY_BROKER_URL"]
    assert value["result"] == "socket:///run/freeframe-redis.sock?virtual_host=1"
    assert value["result_class"] == "UnixDomainSocketConnection"
    assert value["result_db"] == 1
