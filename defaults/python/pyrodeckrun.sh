# Script wrapper is needed so that Steam can focus the Pyrolight window...
# Does not work by calling the python script directly :/

CURRENT_DIR=`dirname "$(readlink -f "$0")"`
cd "$CURRENT_DIR";

exec ${PYRODECK_PYTHON:-/usr/bin/python} ./pyrodeckrun.py
