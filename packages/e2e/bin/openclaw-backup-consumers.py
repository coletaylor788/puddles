#!/usr/bin/env python3
"""Read-only macOS consumer checks for exact backup retirement paths."""
import argparse
import json
import os
from pathlib import Path
import re
import subprocess
import sys


def run(args):
    result = subprocess.run(args, capture_output=True, text=True, timeout=40)
    if result.returncode or result.stderr.strip():
        raise RuntimeError(f"Consumer inspection failed: {Path(args[0]).name}")
    return result.stdout


def matching_paths(text, paths):
    # Require a complete path component. A similarly prefixed generation is
    # not a consumer of the selected generation.
    return {p for p in paths if re.search(re.escape(p) + r'(?=$|[/\s\"\x27,}\]])', text)}


def json_file(path):
    if path.is_symlink() or not path.is_file() or path.stat().st_size > 16 * 1024 * 1024:
        raise RuntimeError("Consumer reference is missing, linked, or too large")
    return json.loads(path.read_text())


def registry_paths(pool_root, paths):
    active = set()
    if pool_root.is_symlink() or not pool_root.is_dir():
        raise RuntimeError("Artifact registry root is unavailable")
    for pool in pool_root.iterdir():
        if not pool.is_dir() or pool.is_symlink():
            raise RuntimeError("Unexpected artifact pool entry")
        refs = pool / "references"
        if not refs.is_dir() or refs.is_symlink():
            raise RuntimeError("Artifact reference directory is unavailable")
        for reference in refs.iterdir():
            data = json_file(reference)
            active.update(matching_paths(json.dumps(data), paths))
            ids = data.get("objectIds")
            if not isinstance(ids, list):
                raise RuntimeError("Artifact reference lacks object identities")
            for identity in ids:
                if not isinstance(identity, str) or not re.fullmatch(r"[a-zA-Z0-9_-]+", identity):
                    raise RuntimeError("Invalid referenced artifact identity")
                obj = pool / "objects" / identity
                if obj.is_symlink() or not obj.is_dir():
                    raise RuntimeError("Referenced artifact is unavailable")
                # Only artifact metadata, not runtime files or personal state.
                metadata = list(obj.glob("*.json"))
                proof_root = obj / "proofs"
                if proof_root.exists():
                    if proof_root.is_symlink() or not proof_root.is_dir():
                        raise RuntimeError("Artifact proof directory is invalid")
                    metadata += list(proof_root.rglob("*.json"))
                for path in metadata:
                    active.update(matching_paths(json.dumps(json_file(path)), paths))
    return active


def inspect(paths, pool_root, slots, docker, execute=run):
    if not paths or len(paths) != len(set(paths)) or any(not os.path.isabs(p) for p in paths):
        raise RuntimeError("Expected unique absolute candidate paths")
    active = set()
    opened = execute(["/usr/sbin/lsof", "-nP", "-Fpn"])
    # Includes cwd and mapped files; all visible host processes are inspected.
    if not any(line.startswith("p") for line in opened.splitlines()):
        raise RuntimeError("Open-file inventory is empty")
    for line in opened.splitlines():
        if line.startswith("n"):
            active.update(matching_paths(line[1:], paths))
    processes = execute(["/bin/ps", "-axo", "pid=,ppid=,command="])
    rows = [line.strip().split(None, 2) for line in processes.splitlines()]
    parents = {int(row[0]): int(row[1]) for row in rows if len(row) == 3}
    own = {os.getpid()}
    cursor = os.getpid()
    while parents.get(cursor, 0) > 1 and parents[cursor] not in own:
        cursor = parents[cursor]
        own.add(cursor)
    for row in rows:
        if len(row) != 3:
            raise RuntimeError("Incomplete process inventory")
        if int(row[0]) not in own:
            active.update(matching_paths(row[2], paths))
    ids = execute([docker, "ps", "-aq"]).split()
    if ids:
        # Docker emits one JSON value per container, including stopped ones.
        for line in execute([docker, "inspect", *ids, "--format", "{{json .Mounts}}"] ).splitlines():
            mounts = json.loads(line)
            if not isinstance(mounts, list):
                raise RuntimeError("Docker mount inventory is invalid")
            for mount in mounts:
                source = mount.get("Source", "")
                if mount.get("Type") == "bind":
                    active.update(p for p in paths if source == p or source.startswith(p + "/") or p.startswith(source.rstrip("/") + "/"))
    coordination = json_file(slots)
    environments = coordination.get("environments")
    if not isinstance(environments, dict) or set(environments) != {"DEV", "TEST", "PROD"}:
        raise RuntimeError("Deployment coordination is unavailable")
    for slot in environments.values():
        # Historical previous owners are evidence, not live reservations.
        active.update(matching_paths(json.dumps({"owner": slot.get("owner"), "queue": slot["queue"]}), paths))
    active.update(registry_paths(pool_root, paths))
    return {"schemaVersion": 1, "checkedPaths": paths, "activePaths": [p for p in paths if p in active]}


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--artifact-pools", required=True, type=Path)
    parser.add_argument("--coordination", required=True, type=Path)
    parser.add_argument("--docker", required=True)
    parser.add_argument("paths")
    args = parser.parse_args()
    print(json.dumps(inspect(json.loads(args.paths), args.artifact_pools, args.coordination, args.docker)))


if __name__ == "__main__":
    try:
        main()
    except Exception as error:
        print(str(error), file=sys.stderr)
        sys.exit(1)
