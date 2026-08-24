#!/usr/bin/env python3
"""Write ~/.local/state/omarchy/devlinkspad.json owner-only, without following symlinks.

Creates the private directory at 0700 (refusing a symlink), writes a temp file
with mode 0600 in that directory, then atomically replaces the destination.
The payload is read from stdin so the bearer token never appears in argv.
"""
from __future__ import annotations

import os
import stat
import sys
import tempfile

MAX_BYTES = 8192
DIR_MODE = 0o700
FILE_MODE = 0o600


def fail(msg: str) -> None:
    sys.stderr.write("devlinkspad: " + msg + "\n")
    sys.exit(1)


def ensure_private_dir(dir_path: str) -> None:
    os.umask(0o077)
    parent = os.path.dirname(dir_path)
    if parent:
        try:
            os.makedirs(parent, mode=DIR_MODE, exist_ok=True)
        except OSError as exc:
            fail("cannot create state parent: %s" % exc)
    try:
        os.mkdir(dir_path, DIR_MODE)
    except FileExistsError:
        pass
    except OSError as exc:
        fail("cannot create state dir: %s" % exc)

    try:
        st = os.lstat(dir_path)
    except OSError as exc:
        fail("cannot stat state dir: %s" % exc)
    if stat.S_ISLNK(st.st_mode):
        fail("state dir is a symlink")
    if not stat.S_ISDIR(st.st_mode):
        fail("state dir is not a directory")
    if st.st_uid != os.getuid():
        fail("state dir not owned by current user")
    os.chmod(dir_path, DIR_MODE)


def unlink_if_symlink(path: str) -> None:
    try:
        st = os.lstat(path)
    except FileNotFoundError:
        return
    if stat.S_ISLNK(st.st_mode):
        os.unlink(path)
        return
    if not stat.S_ISREG(st.st_mode):
        fail("state path exists and is not a regular file")
    if st.st_uid != os.getuid():
        fail("state file not owned by current user")


def write_atomic(dir_path: str, file_path: str, data: bytes) -> None:
    ensure_private_dir(dir_path)
    unlink_if_symlink(file_path)

    fd = None
    tmp = None
    try:
        fd, tmp = tempfile.mkstemp(prefix=".devlinkspad.", dir=dir_path)
        os.fchmod(fd, FILE_MODE)
        offset = 0
        while offset < len(data):
            wrote = os.write(fd, data[offset:])
            if wrote <= 0:
                fail("short write")
            offset += wrote
        os.fsync(fd)
        os.close(fd)
        fd = None
        os.replace(tmp, file_path)
        tmp = None
    finally:
        if fd is not None:
            try:
                os.close(fd)
            except OSError:
                pass
        if tmp is not None:
            try:
                os.unlink(tmp)
            except OSError:
                pass

    # Verify through the inode we just installed — O_NOFOLLOW so a raced
    # symlink is not chmod'd/followed.
    try:
        chk = os.open(file_path, os.O_RDONLY | os.O_NOFOLLOW)
    except OSError as exc:
        fail("cannot reopen state file: %s" % exc)
    try:
        st = os.fstat(chk)
        if not stat.S_ISREG(st.st_mode):
            fail("state file is not a regular file")
        if st.st_uid != os.getuid():
            fail("state file not owned by current user")
        os.fchmod(chk, FILE_MODE)
    finally:
        os.close(chk)


def main() -> None:
    if len(sys.argv) == 3 and sys.argv[1] == "--prepare-dir":
        ensure_private_dir(sys.argv[2])
        return
    if len(sys.argv) != 3:
        fail("usage: save-state.py DIR FILE")

    data = sys.stdin.buffer.read(MAX_BYTES + 1)
    if len(data) > MAX_BYTES:
        fail("payload exceeds byte ceiling")

    write_atomic(sys.argv[1], sys.argv[2], data)


if __name__ == "__main__":
    main()
