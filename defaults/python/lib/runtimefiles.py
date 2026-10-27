"""Safe access to PyroDeck's runtime files.

Runtime files (process records, state flags, session status, logs) live in
`constants.RUNTIME_DIR`, a directory owned by the user and closed to everyone
else. Files are opened without following symlinks and are used only when they
are regular files owned by the user, so a pre-created link, FIFO or foreign
file is never written through, blocked on or trusted. Records are replaced
atomically, so a reader never sees a partial one.
"""

import contextlib
import os
import stat
from typing import Optional

# Process records and flags are a few bytes; the session status carries the
# settings registry and stays far below this.
MAX_READ_BYTES = 1 << 20


class UnsafeRuntimeFile(OSError):
    """A runtime path that is not a directory or regular file owned by this user."""


def ensure_dir(directory: str) -> None:
    """Create `directory` (mode 0700) or verify that the existing one is private."""
    try:
        os.mkdir(directory, 0o700)
    except FileExistsError:
        pass
    info = os.lstat(directory)
    if not stat.S_ISDIR(info.st_mode) or info.st_uid != os.getuid():
        raise UnsafeRuntimeFile(f"{directory} is not a directory owned by this user")
    if info.st_mode & 0o077:
        os.chmod(directory, 0o700)


def _verify(fd: int, path: str) -> None:
    info = os.fstat(fd)
    if not stat.S_ISREG(info.st_mode) or info.st_uid != os.getuid():
        raise UnsafeRuntimeFile(f"{path} is not a regular file owned by this user")


def open_fd(path: str, flags: int, mode: int = 0o600) -> int:
    """os.open() for a runtime file: no symlinks, no FIFOs or devices, only own files."""
    ensure_dir(os.path.dirname(path))
    # O_NONBLOCK keeps opening a FIFO from waiting for a peer; regular files
    # ignore it.
    fd = os.open(path, flags | os.O_NOFOLLOW | os.O_CLOEXEC | os.O_NONBLOCK, mode)
    try:
        _verify(fd, path)
        os.set_blocking(fd, True)
    except BaseException:
        os.close(fd)
        raise
    return fd


_MODES = {
    "r": os.O_RDONLY,
    "r+": os.O_RDWR | os.O_CREAT,
    "w": os.O_WRONLY | os.O_CREAT | os.O_TRUNC,
    "a": os.O_WRONLY | os.O_CREAT | os.O_APPEND,
}


def open_file(path: str, mode: str = "r", buffering: int = -1, **kwargs):
    """open() for a runtime file; `mode` is r, r+ (created if missing), w or a, optionally with b."""
    return os.fdopen(open_fd(path, _MODES[mode.replace("b", "")]), mode, buffering, **kwargs)


def read_text(path: str, limit: int = MAX_READ_BYTES) -> Optional[str]:
    """The file's text, or None when it does not exist."""
    try:
        with open_file(path, "r", errors="replace") as file:
            return file.read(limit)
    except FileNotFoundError:
        return None


def write_atomic(path: str, text: str) -> None:
    """Replace `path` with `text` in one step."""
    import uuid

    temporary = f"{path}.{uuid.uuid4().hex}"
    fd = open_fd(temporary, os.O_WRONLY | os.O_CREAT | os.O_EXCL)
    try:
        with os.fdopen(fd, "w") as output:
            output.write(text)
        os.replace(temporary, path)
    finally:
        with contextlib.suppress(FileNotFoundError):
            os.unlink(temporary)


def touch(path: str) -> None:
    os.close(open_fd(path, os.O_WRONLY | os.O_CREAT))


def is_file(path: str) -> bool:
    """Whether `path` is a regular file owned by this user (a link or foreign file is not)."""
    try:
        info = os.lstat(path)
    except FileNotFoundError:
        return False
    return stat.S_ISREG(info.st_mode) and info.st_uid == os.getuid()


def remove(path: str) -> None:
    with contextlib.suppress(FileNotFoundError):
        os.unlink(path)
