"""Run a dedicated debug application twice against disposable test data."""
import argparse
import json
import os
import pathlib
import subprocess
import tempfile

parser = argparse.ArgumentParser()
parser.add_argument("application")
parser.add_argument("--portable", action="store_true")
args = parser.parse_args()
application = pathlib.Path(args.application).resolve()
if not application.is_file():
    raise SystemExit("Application executable missing")
with tempfile.TemporaryDirectory(prefix="nexonic-smoke-") as directory:
    work = pathlib.Path(directory)
    if args.portable and not (application.parent / "portable.txt").is_file():
        raise SystemExit("Portable marker missing")
    for stage in ("write", "verify"):
        result = work / f"{stage}.json"
        env = dict(os.environ, NEXONIC_SMOKE_TEST="1", NEXONIC_SMOKE_STAGE=stage,
                   NEXONIC_SMOKE_RESULT=str(result), NEXONIC_SMOKE_DATA=str(work / "data"))
        process = subprocess.Popen([str(application)], env=env)
        try:
            code = process.wait(timeout=60)
        except subprocess.TimeoutExpired:
            process.terminate()
            raise SystemExit("Native GUI smoke test timed out")
        if code != 0 or not result.is_file() or not json.loads(result.read_text()).get("passed"):
            raise SystemExit(f"Native GUI smoke test failed: {result.read_text() if result.exists() else 'no result'}")
    if args.portable and not (application.parent / "NexonicTraceData" / "trace.db").is_file():
        raise SystemExit("Portable mode did not place ordinary data beside the executable")
print("Native launch, real IPC, restart persistence, navigation, and deletion passed.")
