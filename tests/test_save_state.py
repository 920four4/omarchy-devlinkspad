#!/usr/bin/env python3
"""Regression tests for credential-file TOCTOU, FIFO stall, and umask leaks."""
from __future__ import annotations

import importlib.util
import os
import stat
import subprocess
import sys
import tempfile
import time
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SCRIPT = ROOT / "save-state.py"
OVERLAY = ROOT / "Overlay.qml"


def load_mod():
    spec = importlib.util.spec_from_file_location("save_state", SCRIPT)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


ss = load_mod()


class SaveStateTests(unittest.TestCase):
    def setUp(self) -> None:
        self.tmp = tempfile.TemporaryDirectory()
        self.home = self.tmp.name
        self.omarchy = Path(self.home) / ".local" / "state" / "omarchy"
        self.state = self.omarchy / "devlinkspad.json"

    def tearDown(self) -> None:
        self.tmp.cleanup()

    def run_cli(self, action: str, payload: bytes | None = None, timeout: float = 2.0):
        return subprocess.run(
            [sys.executable, str(SCRIPT), action, self.home],
            input=payload,
            capture_output=True,
            timeout=timeout,
        )

    def test_write_read_roundtrip(self) -> None:
        payload = b'{"token":"abc","opens":1}'
        wr = self.run_cli("--write", payload)
        self.assertEqual(wr.returncode, 0, wr.stderr.decode())
        rd = self.run_cli("--read")
        self.assertEqual(rd.returncode, 0, rd.stderr.decode())
        self.assertEqual(rd.stdout, payload)

    def test_umask_000_still_0600_and_dir_0700(self) -> None:
        old = os.umask(0)
        try:
            wr = self.run_cli("--write", b"{}")
        finally:
            os.umask(old)
        self.assertEqual(wr.returncode, 0, wr.stderr.decode())
        self.assertEqual(stat.S_IMODE(self.state.stat().st_mode), 0o600)
        self.assertEqual(stat.S_IMODE(self.omarchy.stat().st_mode), 0o700)

    def test_read_refuses_file_symlink_without_following(self) -> None:
        self.run_cli("--prepare")
        evil = Path(self.home) / "evil.json"
        evil.write_bytes(b'{"token":"stolen"}')
        os.symlink(str(evil), self.state)
        rd = self.run_cli("--read")
        self.assertNotEqual(rd.returncode, 0)
        self.assertEqual(rd.stdout, b"")
        self.assertEqual(evil.read_bytes(), b'{"token":"stolen"}')

    def test_replaces_destination_symlink_without_following(self) -> None:
        self.run_cli("--prepare")
        evil = Path(self.home) / "evil.json"
        evil.write_bytes(b"keep-me")
        os.symlink(str(evil), self.state)
        wr = self.run_cli("--write", b'{"token":"secret"}')
        self.assertEqual(wr.returncode, 0, wr.stderr.decode())
        self.assertFalse(self.state.is_symlink())
        self.assertEqual(self.state.read_bytes(), b'{"token":"secret"}')
        self.assertEqual(evil.read_bytes(), b"keep-me")

    def test_refuses_symlink_state_directory_on_write(self) -> None:
        parent = Path(self.home) / ".local" / "state"
        parent.mkdir(parents=True)
        os.symlink(self.home, parent / "omarchy")
        wr = self.run_cli("--write", b"{}")
        self.assertNotEqual(wr.returncode, 0)
        self.assertIn(b"cannot open omarchy", wr.stderr)

    def test_refuses_symlink_state_directory_on_read(self) -> None:
        parent = Path(self.home) / ".local" / "state"
        parent.mkdir(parents=True)
        os.symlink(self.home, parent / "omarchy")
        rd = self.run_cli("--read")
        self.assertNotEqual(rd.returncode, 0)
        self.assertEqual(rd.stdout, b"")

    def test_fifo_read_does_not_block(self) -> None:
        self.run_cli("--prepare")
        os.mkfifo(self.state)
        t0 = time.monotonic()
        rd = self.run_cli("--read", timeout=2)
        elapsed = time.monotonic() - t0
        self.assertLess(elapsed, 1.0)
        self.assertNotEqual(rd.returncode, 0)
        self.assertEqual(rd.stdout, b"")

    def test_oversized_payload_rejected(self) -> None:
        wr = self.run_cli("--write", b"x" * (ss.MAX_BYTES + 1))
        self.assertNotEqual(wr.returncode, 0)
        self.assertFalse(self.state.exists())

    def test_oversized_file_read_rejected(self) -> None:
        self.run_cli("--prepare")
        self.state.write_bytes(b"y" * (ss.MAX_BYTES + 1))
        os.chmod(self.state, 0o600)
        rd = self.run_cli("--read")
        self.assertNotEqual(rd.returncode, 0)
        self.assertEqual(rd.stdout, b"")

    def test_missing_file_is_empty_success(self) -> None:
        rd = self.run_cli("--read")
        self.assertEqual(rd.returncode, 0, rd.stderr.decode())
        self.assertEqual(rd.stdout, b"")

    def test_pin_survives_directory_replacement(self) -> None:
        dirfd = ss.pin_state_dir(self.home, create=True)
        try:
            moved = Path(str(self.omarchy) + ".old")
            os.rename(self.omarchy, moved)
            self.omarchy.mkdir()
            ss.write_state(dirfd, b'{"pinned":true}')
        finally:
            ss._close(dirfd)
        self.assertFalse((self.omarchy / "devlinkspad.json").exists())
        self.assertEqual((moved / "devlinkspad.json").read_bytes(), b'{"pinned":true}')

    def test_overlay_does_not_check_then_open_state_path(self) -> None:
        text = OVERLAY.read_text()
        self.assertNotIn('[ -L "', text)
        self.assertNotIn("head -c \"$1\" -- \"$2\"", text)
        self.assertNotIn("FileView", text)
        self.assertNotIn('timeout", "5", "head"', text)
        self.assertIn('--read', text)
        self.assertIn('--write', text)
        self.assertIn('--read-catalog', text)
        self.assertIn("openssl rand -hex 20 | head -c 41", text)

    def _plugin_root(self) -> Path:
        root = Path(self.home) / "plugin"
        (root / "data").mkdir(parents=True)
        return root

    def test_catalog_roundtrip(self) -> None:
        root = self._plugin_root()
        payload = b'[{"name":"Stripe","links":[{"url":"https://dashboard.stripe.com"}]}]'
        (root / "data" / "services.json").write_bytes(payload)
        rd = subprocess.run(
            [sys.executable, str(SCRIPT), "--read-catalog", str(root)],
            capture_output=True,
            timeout=2,
        )
        self.assertEqual(rd.returncode, 0, rd.stderr.decode())
        self.assertEqual(rd.stdout, payload)

    def test_catalog_fifo_does_not_block(self) -> None:
        root = self._plugin_root()
        os.mkfifo(root / "data" / "services.json")
        t0 = time.monotonic()
        rd = subprocess.run(
            [sys.executable, str(SCRIPT), "--read-catalog", str(root)],
            capture_output=True,
            timeout=2,
        )
        self.assertLess(time.monotonic() - t0, 1.0)
        self.assertNotEqual(rd.returncode, 0)
        self.assertEqual(rd.stdout, b"")

    def test_catalog_symlink_refused(self) -> None:
        root = self._plugin_root()
        evil = Path(self.home) / "evil.json"
        evil.write_bytes(b'[{"name":"x"}]')
        os.symlink(evil, root / "data" / "services.json")
        rd = subprocess.run(
            [sys.executable, str(SCRIPT), "--read-catalog", str(root)],
            capture_output=True,
            timeout=2,
        )
        self.assertNotEqual(rd.returncode, 0)
        self.assertEqual(rd.stdout, b"")

    def test_catalog_oversized_refused(self) -> None:
        root = self._plugin_root()
        (root / "data" / "services.json").write_bytes(b"[" + b"x" * (ss.MAX_CATALOG_BYTES) + b"]")
        rd = subprocess.run(
            [sys.executable, str(SCRIPT), "--read-catalog", str(root)],
            capture_output=True,
            timeout=2,
        )
        self.assertNotEqual(rd.returncode, 0)
        self.assertEqual(rd.stdout, b"")


if __name__ == "__main__":
    unittest.main()
