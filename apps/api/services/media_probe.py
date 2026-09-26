"""Bounded subprocess output for native media timing probes."""
import subprocess
import tempfile
import time

from fastapi import HTTPException


def bounded_probe(args, limit, timeout):
    """Return bytes without accumulating unchecked child output in memory."""
    deadline = time.monotonic() + timeout
    with tempfile.TemporaryFile() as output:
        process = subprocess.Popen(args, stdin=subprocess.DEVNULL, stdout=output, stderr=subprocess.DEVNULL)
        try:
            while process.poll() is None:
                if output.tell() > limit:
                    raise HTTPException(413, 'Native timing evidence exceeds the output limit')
                remaining = deadline - time.monotonic()
                if remaining <= 0:
                    raise subprocess.TimeoutExpired(args, timeout)
                time.sleep(min(0.025, remaining))
            if output.tell() > limit:
                raise HTTPException(413, 'Native timing evidence exceeds the output limit')
            if process.returncode != 0:
                raise subprocess.CalledProcessError(process.returncode, args)
            output.seek(0)
            return output.read(limit + 1)
        finally:
            if process.poll() is None:
                process.kill()
                process.wait(timeout=5)
