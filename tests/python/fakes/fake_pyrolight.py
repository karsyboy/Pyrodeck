#!/usr/bin/env python3
"""A deterministic stand-in for the Pyrolight executable.

Behavior comes from `$FAKE_PYROLIGHT_DIR/config.json`; every invocation is
appended to `$FAKE_PYROLIGHT_DIR/invocations.jsonl` as {"argv", "pid"}.

config.json keys (all optional):
  list:   {"exit": int, "stdout": str, "stderr": str}
  stream: {"exit": int, "sleep": float}   sleep < 0 means until SIGTERM
  help:   str printed for `stream --help`
  ignore_sigterm: bool (stream keeps running after SIGTERM)
"""

import json
import os
import signal
import sys
import time

directory = os.environ["FAKE_PYROLIGHT_DIR"]
with open(os.path.join(directory, "config.json")) as file:
    config = json.load(file)

with open(os.path.join(directory, "invocations.jsonl"), "a") as file:
    file.write(json.dumps({"argv": sys.argv[1:], "pid": os.getpid()}) + "\n")

args = sys.argv[1:]
if "--help" in args:
    print(config.get("help", ""))
    sys.exit(0)

action = next((arg for arg in args if arg in ("list", "stream", "quit", "pair")), None)

if action == "list":
    behavior = config.get("list", {})
    sys.stdout.write(behavior.get("stdout", ""))
    sys.stderr.write(behavior.get("stderr", ""))
    sys.exit(behavior.get("exit", 0))

behavior = config.get(action or "stream", {})
if config.get("ignore_sigterm"):
    signal.signal(signal.SIGTERM, signal.SIG_IGN)
else:
    signal.signal(signal.SIGTERM, lambda *_: sys.exit(0))

sleep = behavior.get("sleep", 0)
if sleep < 0:
    while True:
        time.sleep(0.05)
time.sleep(sleep)
sys.exit(behavior.get("exit", 0))
