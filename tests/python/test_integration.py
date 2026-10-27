import unittest
from unittest.mock import AsyncMock, patch
from support import isolate_state, HOST_ID
from lib import sessionstate
from lib.integration import Integration, failure


class IntegrationTest(unittest.IsolatedAsyncioTestCase):
    def setUp(self):
        self.directory = isolate_state(self)
        self.service = Integration()
        self.service.known_catalog_path = self.directory / "known-catalogs.json"
        self.settings = {"hostSettings": {HOST_ID: {"hostName": "Deck Host", "address": "127.0.0.1", "hostInfoPort": 47989}}, "currentHostId": HOST_ID}
        self.request = {"schema": 1, "operation": "patch", "revision": "old", "values": {"fps": 90}}
        self.saved = {"schema": 1, "ok": True, "revision": "new", "values": {"fps": 90}}

    async def test_save_does_not_implicitly_reconnect(self):
        self.service.preferences = AsyncMock(return_value=self.saved)
        self.service.reconnect = AsyncMock()
        result = await self.service.apply(self.settings, self.request, False)
        self.assertTrue(result["ok"])
        self.assertFalse(result["applied"])
        self.service.reconnect.assert_not_awaited()
        self.assertEqual([call.args[1]["operation"] for call in self.service.preferences.await_args_list], ["validate", "patch"])

    async def test_conflict_never_interrupts_or_persists(self):
        self.service.preferences = AsyncMock(return_value=failure("conflict", "changed"))
        self.service.reconnect = AsyncMock()
        with patch("lib.integration.runnercontrol.is_runner_active", return_value=True):
            result = await self.service.apply(self.settings, self.request, True)
        self.assertFalse(result["ok"])
        self.assertEqual(self.service.preferences.await_count, 1)
        self.service.reconnect.assert_not_awaited()

    async def test_failed_reconnect_reports_persisted_but_unapplied(self):
        self.service.preferences = AsyncMock(return_value=self.saved)
        self.service.reconnect = AsyncMock(return_value=failure("reconnect_failed", "network lost"))
        with patch("lib.integration.runnercontrol.is_runner_active", return_value=True):
            result = await self.service.apply(self.settings, self.request, True)
        self.assertFalse(result["ok"])
        self.assertFalse(result["applied"])
        self.assertTrue(result["persisted"])
        self.assertEqual(result["preferences"], self.saved)
        self.service.reconnect.assert_awaited_once()

    async def test_duplicate_reconnect_or_apply_is_rejected(self):
        async with self.service.lock:
            result = await self.service.apply(self.settings, self.request, True)
        self.assertEqual(result["error"]["code"], "busy")

    async def test_apply_reconnect_without_runner_does_not_modify_preferences(self):
        self.service.preferences = AsyncMock()
        with patch("lib.integration.runnercontrol.is_runner_active", return_value=False):
            result = await self.service.apply(self.settings, self.request, True)
        self.assertFalse(result["ok"])
        self.service.preferences.assert_not_awaited()

    async def test_success_requires_confirmed_stream(self):
        self.service.preferences = AsyncMock(return_value=self.saved)
        self.service.reconnect = AsyncMock(return_value={"ok": True, "session": {"state": "streaming"}})
        with patch("lib.integration.runnercontrol.is_runner_active", return_value=True):
            result = await self.service.apply(self.settings, self.request, True)
        self.assertTrue(result["applied"])

    async def test_reconnect_requires_a_new_confirmed_attempt_and_matching_revision(self):
        from unittest.mock import Mock
        generation = sessionstate.begin({"host_id": HOST_ID, "hostname": "Host"})
        sessionstate.update(generation, state="streaming", attempt=1, effectivePreferences={"revision": "old"})
        runner = Mock()
        runner.send_usr1.side_effect = lambda: sessionstate.update(generation, state="disconnected")
        runner.send_usr2.side_effect = lambda: sessionstate.update(generation, state="streaming", attempt=2, effectivePreferences={"revision": "new"})
        with patch("lib.integration.runnercontrol.is_runner_active", return_value=True), patch("lib.integration.runnercontrol.get_active_runner", return_value=runner), patch("lib.integration.utils.wait_runner_suspended_state", new=AsyncMock()):
            result = await self.service.reconnect("new")
        self.assertTrue(result["ok"])
        runner.send_usr1.assert_called_once()
        runner.send_usr2.assert_called_once()

    async def test_reconnect_does_not_claim_a_changed_profile_was_applied(self):
        from unittest.mock import Mock
        generation = sessionstate.begin({"host_id": HOST_ID, "hostname": "Host"})
        sessionstate.update(generation, state="streaming", attempt=1)
        runner = Mock()
        runner.send_usr2.side_effect = lambda: sessionstate.update(generation, state="streaming", attempt=2, effectivePreferences={"revision": "another-profile"})
        with patch("lib.integration.runnercontrol.is_runner_active", return_value=True), patch("lib.integration.runnercontrol.get_active_runner", return_value=runner), patch("lib.integration.utils.wait_runner_suspended_state", new=AsyncMock()):
            result = await self.service.reconnect("expected")
        self.assertFalse(result["ok"])
        self.assertEqual(result["error"]["code"], "conflict")

    def test_stale_runner_events_cannot_replace_current_session(self):
        settings = {"host_id": HOST_ID, "hostname": "Host", "app_name": "One"}
        old = sessionstate.begin(settings)
        new = sessionstate.begin({**settings, "app_name": "Two"})
        sessionstate.update(old, state="failed", error="stale")
        self.assertEqual(sessionstate.read()["generation"], new)
        self.assertEqual(sessionstate.read()["appName"], "Two")

    def test_crashed_runner_is_not_reported_as_streaming(self):
        generation = sessionstate.begin({"host_id": HOST_ID, "hostname": "Host"})
        sessionstate.update(generation, state="streaming")
        with patch("lib.integration.runnercontrol.is_runner_active", return_value=False):
            self.assertEqual(self.service.status()["state"], "failed")

    def test_status_observations_are_ordered_without_the_wall_clock(self):
        with patch("lib.integration.runnercontrol.is_runner_active", return_value=False):
            first = self.service.status()
            with patch("lib.sessionstate.time.time", return_value=0):
                sessionstate.begin({"host_id": HOST_ID, "hostname": "Host"})
            second = self.service.status()
        self.assertNotIn("updatedAt", first, "an absent record is still an observation")
        self.assertGreater(second["observedAt"], first["observedAt"])

    async def test_catalog_rejects_changed_host_identity_and_caches(self):
        from lib.pyrolightproxy import HostAppList, HostApp
        proxy = AsyncMock()
        proxy.list_apps.return_value = HostAppList("Host", "WRONG", [HostApp("Game", 77)])
        proxy.__aenter__.return_value = proxy
        with patch.object(self.service, "executable", return_value="pyrolight"), patch("lib.integration.PyrolightProxy", return_value=proxy):
            result = await self.service.catalogs(self.settings)
            repeated = await self.service.catalogs(self.settings)
        self.assertEqual(result["hosts"][0]["status"], "wrong_host")
        self.assertEqual(result["hosts"][0]["apps"], [])
        self.assertEqual(result, repeated)
        self.assertEqual(proxy.list_apps.await_count, 1)

    async def test_catalog_exposes_all_advertised_launcher_types(self):
        from lib.pyrolightproxy import HostAppList, HostApp
        apps = [HostApp(kind, i + 1, sources=[] if kind == "manual" else [kind + ":1"]) for i, kind in enumerate(["steam", "heroic", "lutris", "desktop", "manual"])]
        proxy = AsyncMock()
        proxy.list_apps.return_value = HostAppList("Host", HOST_ID, apps)
        proxy.__aenter__.return_value = proxy
        with patch.object(self.service, "executable", return_value="pyrolight"), patch("lib.integration.PyrolightProxy", return_value=proxy):
            result = await self.service.catalogs(self.settings)
        self.assertEqual(len(result["hosts"][0]["apps"]), 5)
        self.assertEqual(result["defaultHostId"], HOST_ID)

    async def test_offline_catalog_survives_reload_but_not_unpairing_or_changed_endpoint(self):
        from lib.pyrolightproxy import HostAppList, HostApp, PyrolightListError
        proxy = AsyncMock()
        proxy.__aenter__.return_value = proxy
        proxy.list_apps.return_value = HostAppList("Host", HOST_ID, [HostApp("Valheim", 42, sources=["steam:892970"])])
        self.settings["hostSettings"][HOST_ID]["mac"] = "01:02:03:04:05:06"
        with patch.object(self.service, "executable", return_value="pyrolight"), patch("lib.integration.PyrolightProxy", return_value=proxy):
            first = await self.service.catalogs(self.settings, True)
            reloaded = Integration()
            reloaded.known_catalog_path = self.service.known_catalog_path
            proxy.list_apps.side_effect = PyrolightListError("unreachable", "offline")
            with patch.object(reloaded, "executable", return_value="pyrolight"):
                offline = (await reloaded.catalogs(self.settings, True))["hosts"][0]
                self.assertEqual(offline["apps"], first["hosts"][0]["apps"])
                self.assertTrue(offline["cached"])
                self.assertTrue(offline["validated"])
                self.settings["hostSettings"][HOST_ID]["address"] = "192.0.2.20"
                self.assertEqual((await reloaded.catalogs(self.settings, True))["hosts"][0]["apps"], [])
                self.settings["hostSettings"][HOST_ID]["address"] = "127.0.0.1"
                proxy.list_apps.side_effect = PyrolightListError("not_paired", "unpaired")
                self.assertEqual((await reloaded.catalogs(self.settings, True))["hosts"][0]["apps"], [])
                proxy.list_apps.side_effect = PyrolightListError("unreachable", "offline")
                self.assertEqual((await reloaded.catalogs(self.settings, True))["hosts"][0]["apps"], [])

    async def test_successful_empty_catalog_invalidates_previous_availability(self):
        from lib.pyrolightproxy import HostAppList, HostApp, PyrolightListError
        proxy = AsyncMock()
        proxy.__aenter__.return_value = proxy
        proxy.list_apps.return_value = HostAppList("Host", HOST_ID, [HostApp("Game", 42, sources=["steam:892970"])])
        with patch.object(self.service, "executable", return_value="pyrolight"), patch("lib.integration.PyrolightProxy", return_value=proxy):
            await self.service.catalogs(self.settings, True)
            proxy.list_apps.return_value = HostAppList("Host", HOST_ID, [])
            await self.service.catalogs(self.settings, True)
            proxy.list_apps.side_effect = PyrolightListError("unreachable", "offline")
            self.assertEqual((await self.service.catalogs(self.settings, True))["hosts"][0]["apps"], [])

    async def test_expired_catalog_does_not_create_offline_matches(self):
        import json
        from lib.pyrolightproxy import HostAppList, HostApp, PyrolightListError
        proxy = AsyncMock(); proxy.__aenter__.return_value = proxy
        proxy.list_apps.return_value = HostAppList("Host", HOST_ID, [HostApp("Game", 42, sources=["steam:892970"])])
        with patch.object(self.service, "executable", return_value="pyrolight"), patch("lib.integration.PyrolightProxy", return_value=proxy):
            await self.service.catalogs(self.settings, True)
            known = json.loads(self.service.known_catalog_path.read_text())
            known[HOST_ID]["result"]["validatedAt"] = 1
            self.service.known_catalog_path.write_text(json.dumps(known))
            proxy.list_apps.side_effect = PyrolightListError("unreachable", "offline")
            self.assertEqual((await self.service.catalogs(self.settings, True))["hosts"][0]["apps"], [])

    async def test_malformed_offline_cache_cannot_supply_a_match(self):
        import json
        from lib.pyrolightproxy import PyrolightListError
        self.service.known_catalog_path.write_text(json.dumps({HOST_ID: "broken", "other": {"result": {"apps": []}}}))
        proxy = AsyncMock(); proxy.__aenter__.return_value = proxy
        proxy.list_apps.side_effect = PyrolightListError("unreachable", "offline")
        with patch.object(self.service, "executable", return_value="pyrolight"), patch("lib.integration.PyrolightProxy", return_value=proxy):
            self.assertEqual((await self.service.catalogs(self.settings, True))["hosts"][0]["apps"], [])
