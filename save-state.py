#!/usr/bin/env python3
"""Owner-only I/O for ~/.local/state/omarchy/devlinkspad.json.

The keep-loaded overlay must not re-resolve a pathname after deciding it is
safe. A check-then-open of a predictable path is a TOCTOU window: the file or
directory can become a symlink or a FIFO between the test and the later open,
which either redirects the bearer token or stalls the reader.

This helper therefore:

1. Physically resolves HOME (a distro may symlink /home; that is not an attack).
2. Walks .local/state/omarchy with openat(O_NOFOLLOW|O_DIRECTORY) at each step
   so a symlink anywhere below HOME is refused, not followed.
3. Pins the omarchy directory with that dirfd for the rest of the process.
4. Reads and writes the credential file only through that dirfd
   (openat / renameat / unlinkat). Replacing the path cannot move the fd.

Reads open with O_NOFOLLOW|O_NONBLOCK, then fstat the same fd: a FIFO cannot
block, a symlink cannot redirect, and a non-regular file is rejected before
any bytes are retained. Writes create an exclusive 0600 temp via the dirfd
and renameat onto the destination name, which replaces a symlink rather than
following it.
"""
from __future__ import annotations

import errno
import fcntl
import os
import stat
import sys

MAX_BYTES = 8192
DIR_MODE = 0o700
FILE_MODE = 0o600
STATE_NAME = "devlinkspad.json"
STATE_PARTS = (".local", "state", "omarchy")
TEMP_PREFIX = ".devlinkspad."
TEMP_TRIES = 8


class Refuse(Exception):
    """The path is present but not a usable credential file or directory."""


class Missing(Exception):
    """A path component does not exist yet (normal on first run)."""


def fail(msg: str) -> None:
    sys.stderr.write("devlinkspad: " + msg + "\n")
    sys.exit(1)


def _close(fd: int | None) -> None:
    if fd is None:
        return
    try:
        os.close(fd)
    except OSError:
        pass


def physical_home(home: str) -> str:
    if not home or home.startswith("-") or "\x00" in home:
        raise Refuse("invalid home")
    try:
        physical = os.path.realpath(home)
    except OSError as exc:
        raise Refuse("cannot resolve home: %s" % exc) from exc
    if not physical or physical == "/":
        raise Refuse("refusing to use / as home")
    return physical


def _open_home(home_phys: str) -> int:
    try:
        fd = os.open(home_phys, os.O_RDONLY | os.O_DIRECTORY | os.O_CLOEXEC)
    except OSError as exc:
        raise Refuse("cannot open home: %s" % exc) from exc
    try:
        st = os.fstat(fd)
        if not stat.S_ISDIR(st.st_mode):
            raise Refuse("home is not a directory")
        if st.st_uid != os.getuid():
            raise Refuse("home not owned by current user")
    except Exception:
        _close(fd)
        raise
    return fd


def _mkdirat(dirfd: int, name: str) -> None:
    try:
        os.mkdir(name, DIR_MODE, dir_fd=dirfd)
    except FileExistsError:
        return
    except OSError as exc:
        raise Refuse("cannot create %s: %s" % (name, exc)) from exc


def _openat_dir(dirfd: int, name: str) -> int:
    try:
        return os.open(
            name,
            os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW | os.O_CLOEXEC,
            dir_fd=dirfd,
        )
    except FileNotFoundError as exc:
        raise Missing("missing %s" % name) from exc
    except OSError as exc:
        if exc.errno == errno.ENOENT:
            raise Missing("missing %s" % name) from exc
        raise Refuse("cannot open %s: %s" % (name, exc)) from exc


def _check_dirfd(fd: int, label: str, tighten: bool) -> None:
    st = os.fstat(fd)
    if not stat.S_ISDIR(st.st_mode):
        raise Refuse("%s is not a directory" % label)
    if st.st_uid != os.getuid():
        raise Refuse("%s not owned by current user" % label)
    if tighten:
        os.fchmod(fd, DIR_MODE)


def _fd_path(fd: int) -> str:
    return os.readlink("/proc/self/fd/%d" % fd)


def pin_state_dir(home: str, create: bool) -> int:
    """Return a dirfd for $HOME/.local/state/omarchy.

    Raises Missing when create is False and a component is absent.
    Raises Refuse when a component is a symlink, not a directory, or not ours.
    The returned fd is owned by the caller.
    """
    home_phys = physical_home(home)
    dirfd = _open_home(home_phys)
    expected = home_phys
    try:
        for part in STATE_PARTS:
            expected = os.path.join(expected, part)
            tighten = part == "omarchy"
            if create:
                _mkdirat(dirfd, part)
            nextfd = _openat_dir(dirfd, part)
            _close(dirfd)
            dirfd = nextfd
            _check_dirfd(dirfd, part, tighten=tighten)
        try:
            got = os.path.normpath(_fd_path(dirfd))
        except OSError as exc:
            raise Refuse("cannot verify state dir fd: %s" % exc) from exc
        if got != os.path.normpath(expected):
            raise Refuse("state dir fd does not match expected path")
        return dirfd
    except Exception:
        _close(dirfd)
        raise


def _drop_nonblock(fd: int) -> None:
    flags = fcntl.fcntl(fd, fcntl.F_GETFL)
    fcntl.fcntl(fd, fcntl.F_SETFL, flags & ~os.O_NONBLOCK)


def read_state(dirfd: int) -> bytes:
    """Read STATE_NAME through dirfd. Missing file returns b''.

    Open is the trust decision: O_NOFOLLOW|O_NONBLOCK, then fstat the same fd.
    """
    try:
        fd = os.open(
            STATE_NAME,
            os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK | os.O_CLOEXEC,
            dir_fd=dirfd,
        )
    except FileNotFoundError:
        return b""
    except OSError as exc:
        if exc.errno == errno.ENOENT:
            return b""
        raise Refuse("cannot open state file: %s" % exc) from exc

    try:
        st = os.fstat(fd)
        if not stat.S_ISREG(st.st_mode):
            raise Refuse("state file is not a regular file")
        if st.st_uid != os.getuid():
            raise Refuse("state file not owned by current user")
        if st.st_size > MAX_BYTES:
            raise Refuse("state file exceeds byte ceiling")
        _drop_nonblock(fd)
        data = bytearray()
        while len(data) <= MAX_BYTES:
            chunk = os.read(fd, min(4096, MAX_BYTES + 1 - len(data)))
            if not chunk:
                break
            data.extend(chunk)
            if len(data) > MAX_BYTES:
                raise Refuse("state file exceeds byte ceiling")
        return bytes(data)
    finally:
        _close(fd)


def _create_temp(dirfd: int) -> tuple[int, str]:
    last_err: OSError | None = None
    for _ in range(TEMP_TRIES):
        name = TEMP_PREFIX + os.urandom(12).hex() + ".tmp"
        try:
            fd = os.open(
                name,
                os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW | os.O_CLOEXEC,
                FILE_MODE,
                dir_fd=dirfd,
            )
        except FileExistsError as exc:
            last_err = exc
            continue
        except OSError as exc:
            raise Refuse("cannot create temp state file: %s" % exc) from exc
        try:
            os.fchmod(fd, FILE_MODE)
        except OSError:
            _close(fd)
            try:
                os.unlink(name, dir_fd=dirfd)
            except OSError:
                pass
            raise
        return fd, name
    raise Refuse("could not create a private temp file" + (": %s" % last_err if last_err else ""))


def write_state(dirfd: int, data: bytes) -> None:
    if len(data) > MAX_BYTES:
        raise Refuse("payload exceeds byte ceiling")

    fd, tmp_name = _create_temp(dirfd)
    try:
        offset = 0
        while offset < len(data):
            wrote = os.write(fd, data[offset:])
            if wrote <= 0:
                raise Refuse("short write")
            offset += wrote
        os.fsync(fd)
        os.close(fd)
        fd = None
        # renameat replaces the destination directory entry. A symlink sitting
        # at STATE_NAME is replaced, not followed.
        os.replace(tmp_name, STATE_NAME, src_dir_fd=dirfd, dst_dir_fd=dirfd)
        tmp_name = None
    finally:
        _close(fd)
        if tmp_name is not None:
            try:
                os.unlink(tmp_name, dir_fd=dirfd)
            except OSError:
                pass

    chk = os.open(
        STATE_NAME,
        os.O_RDONLY | os.O_NOFOLLOW | os.O_CLOEXEC,
        dir_fd=dirfd,
    )
    try:
        st = os.fstat(chk)
        if not stat.S_ISREG(st.st_mode):
            raise Refuse("state file is not a regular file")
        if st.st_uid != os.getuid():
            raise Refuse("state file not owned by current user")
        os.fchmod(chk, FILE_MODE)
    finally:
        _close(chk)


def _cli_prepare(home: str) -> None:
    dirfd = pin_state_dir(home, create=True)
    _close(dirfd)


def _cli_read(home: str) -> None:
    try:
        dirfd = pin_state_dir(home, create=False)
    except Missing:
        return
    try:
        data = read_state(dirfd)
    finally:
        _close(dirfd)
    if data:
        sys.stdout.buffer.write(data)


def _cli_write(home: str) -> None:
    data = sys.stdin.buffer.read(MAX_BYTES + 1)
    if len(data) > MAX_BYTES:
        raise Refuse("payload exceeds byte ceiling")
    dirfd = pin_state_dir(home, create=True)
    try:
        write_state(dirfd, data)
    finally:
        _close(dirfd)


def main() -> None:
    if len(sys.argv) != 3:
        fail("usage: save-state.py --prepare|--read|--write HOME")
    action, home = sys.argv[1], sys.argv[2]
    try:
        if action == "--prepare":
            _cli_prepare(home)
            return
        if action == "--read":
            _cli_read(home)
            return
        if action == "--write":
            _cli_write(home)
            return
    except Missing:
        if action == "--read":
            return
        fail("state path is missing")
    except Refuse as exc:
        fail(str(exc))
    fail("usage: save-state.py --prepare|--read|--write HOME")


if __name__ == "__main__":
    main()
