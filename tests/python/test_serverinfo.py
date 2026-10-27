import unittest

import support
from support import FakeHost

from lib.gamestreaminfo import get_server_info


class ServerInfoTest(unittest.IsolatedAsyncioTestCase):
    async def info(self, host: FakeHost):
        async with host:
            return await get_server_info("127.0.0.1", host.port, 2)

    async def test_reads_pyroshine_extensions(self):
        info = await self.info(FakeHost(current_game=1943979320, game_state="updating"))
        assert info is not None
        self.assertEqual((info["uniqueId"], info["appSources"], info["conditionalCancel"]), (support.HOST_ID, 1, 1))
        self.assertEqual((info["currentGame"], info["gameState"]), (1943979320, "updating"))

    async def test_other_hosts_report_no_extensions(self):
        info = await self.info(FakeHost(app_sources=None, conditional_cancel=None))
        assert info is not None
        self.assertEqual((info["appSources"], info["conditionalCancel"], info["currentGame"], info["gameState"]), (0, 0, 0, None))

    async def test_unknown_game_states_are_ignored(self):
        info = await self.info(FakeHost(current_game=5, game_state="exploded"))
        assert info is not None
        self.assertIsNone(info["gameState"])


if __name__ == "__main__":
    unittest.main()
