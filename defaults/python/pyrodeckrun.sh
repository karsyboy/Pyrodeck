#!/bin/sh
# exec preserves Steam's process ancestry and game/display environment.
CURRENT_DIR=$(dirname "$(readlink -f "$0")")
cd "$CURRENT_DIR" || exit 1
exec "${PYRODECK_PYTHON:-/usr/bin/python}" ./pyrodeckrun.py
