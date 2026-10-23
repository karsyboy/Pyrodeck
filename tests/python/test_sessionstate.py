import unittest
from unittest.mock import patch
from support import isolate_state
from lib import sessionstate


class SessionStateTest(unittest.TestCase):
    def setUp(self):
        isolate_state(self)

    def test_duplicate_observations_do_not_replace_the_status_file(self):
        generation = sessionstate.begin({"host_id": "host", "hostname": "PC"})
        sessionstate.update(generation, state="streaming", quality="good", window={"shown": True})
        before = sessionstate.read()
        with patch.object(sessionstate, "_write", wraps=sessionstate._write) as write:
            for _ in range(100):
                sessionstate.update(generation, quality="good", window={"shown": True})
            write.assert_not_called()
            self.assertEqual(sessionstate.read(), before)
            sessionstate.update(generation, quality="poor")
            write.assert_called_once()
        self.assertEqual(sessionstate.read()["quality"], "poor")

    def test_missing_null_fields_and_new_generations_are_not_conflated(self):
        generation = sessionstate.begin({"host_id": "host", "hostname": "PC"})
        sessionstate.update(generation, error=None)
        self.assertIn("error", sessionstate.read())
        replacement = sessionstate.begin({"host_id": "other", "hostname": "Other"})
        sessionstate.update(generation, state="failed")
        self.assertEqual(sessionstate.read()["generation"], replacement)
