import unittest
from pathlib import Path
from unittest.mock import patch
from support import isolate_state
from lib import diagnostics


class DiagnosticsTest(unittest.TestCase):
    def setUp(self):
        self.directory = isolate_state(self)

    def test_logs_are_allowlisted_bounded_and_redacted(self):
        log = self.directory / "runner.log"
        log.write_text("x" * 40000 + "\nStarting client\npassword=secret\n-----BEGIN PRIVATE KEY-----\nprivate material\n-----END PRIVATE KEY-----\nWindow ready")
        with patch.dict(diagnostics.LOGS, {"runner": str(log)}):
            result = diagnostics.log_tail("runner")
        self.assertLessEqual(len(result["text"]), 32768)
        self.assertIn("Window ready", result["text"])
        self.assertNotIn("private material", result["text"])
        self.assertNotIn("password=secret", result["text"])
        with self.assertRaises(ValueError): diagnostics.log_tail("../../settings")

    def test_no_client_state_does_not_require_settings_or_pairing(self):
        with patch("lib.diagnostics.runnercontrol.is_runner_active", return_value=False):
            self.assertEqual(diagnostics.processes(), {"runnerActive": False, "clientPid": None})
