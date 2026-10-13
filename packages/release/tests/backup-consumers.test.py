import importlib.util
import json
import os
from pathlib import Path
import tempfile
import unittest

spec = importlib.util.spec_from_file_location("consumers", Path(__file__).resolve().parents[1] / "bin/openclaw-backup-consumers.py")
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


class ConsumersTest(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.pools = self.root / "pools"
        self.pools.mkdir()
        self.slots = self.root / "slots.json"
        self.slots.write_text(json.dumps({"environments": {name: {"owner": None, "queue": [], "previous": {"path": "/backups/activation-1-2"}} for name in ["DEV", "TEST", "PROD"]}}))
        self.paths = ["/backups/activation-1-2", "/backups/.retiring-activation-1-2"]
        self.opened = "p42\nn/other\n"
        self.mounts = []
        self.processes = f"{os.getpid()} 1 checker {json.dumps(self.paths)}\n42 1 ordinary\n"

    def execute(self, args):
        if args[0].endswith("lsof"):
            return self.opened
        if args[0].endswith("ps"):
            return self.processes
        if args[1] == "ps":
            return "abcdef\n"
        return json.dumps(self.mounts) + "\n"

    def inspect(self):
        return module.inspect(self.paths, self.pools, self.slots, "/docker", self.execute)

    def test_clear_ignores_own_invocation_and_historical_slot(self):
        self.assertEqual(self.inspect()["activePaths"], [])

    def test_open_file_and_process_arguments_block_source_and_tombstone(self):
        self.opened = "p42\nn/backups/activation-1-2/state/index.db\n"
        self.processes += "43 1 reader /backups/.retiring-activation-1-2/state\n"
        self.assertEqual(self.inspect()["activePaths"], self.paths)

    def test_stopped_container_mount_and_ancestor_mount_block(self):
        self.mounts = [{"Type": "bind", "Source": "/backups"}]
        self.assertEqual(self.inspect()["activePaths"], self.paths)

    def test_referenced_artifact_metadata_blocks(self):
        pool = self.pools / "pool"
        (pool / "references").mkdir(parents=True)
        (pool / "objects/a").mkdir(parents=True)
        (pool / "references/current.json").write_text(json.dumps({"objectIds": ["a"]}))
        (pool / "objects/a/recovery.json").write_text(json.dumps({"path": self.paths[0]}))
        self.assertEqual(self.inspect()["activePaths"], [self.paths[0]])
        (pool / "objects/a/recovery.json").unlink()
        (pool / "objects/a").rmdir()
        with self.assertRaisesRegex(RuntimeError, "Referenced artifact"):
            self.inspect()

    def test_queued_consumer_blocks(self):
        data = json.loads(self.slots.read_text())
        data["environments"]["TEST"]["queue"] = [{"recovery": self.paths[0]}]
        self.slots.write_text(json.dumps(data))
        self.assertEqual(self.inspect()["activePaths"], [self.paths[0]])

    def test_prefix_is_not_same_generation_and_missing_inventory_fails(self):
        self.opened = "p42\nn/backups/activation-1-22/file\n"
        self.assertEqual(self.inspect()["activePaths"], [])
        self.opened = ""
        with self.assertRaisesRegex(RuntimeError, "empty"):
            self.inspect()


if __name__ == "__main__":
    unittest.main()
