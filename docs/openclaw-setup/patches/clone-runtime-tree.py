#!/usr/bin/env python3
"""Clone a runtime tree without allowing physical-copy fallback."""

from __future__ import annotations

import ctypes
import os
import stat
import sys
from pathlib import Path

COPYFILE_ACL = 1 << 0
COPYFILE_STAT = 1 << 1
COPYFILE_XATTR = 1 << 2
COPYFILE_METADATA = COPYFILE_ACL | COPYFILE_STAT | COPYFILE_XATTR
COPYFILE_NOFOLLOW_SRC = 1 << 18
COPYFILE_NOFOLLOW_DST = 1 << 19
COPYFILE_NOFOLLOW = COPYFILE_NOFOLLOW_SRC | COPYFILE_NOFOLLOW_DST
COPYFILE_CLONE_FORCE = 1 << 25
COPYFILE_STATE_PRESERVE_SUID = 16

LIBC = ctypes.CDLL("/usr/lib/libSystem.B.dylib", use_errno=True)
COPYFILE_STATE_ALLOC = LIBC.copyfile_state_alloc
COPYFILE_STATE_ALLOC.argtypes = []
COPYFILE_STATE_ALLOC.restype = ctypes.c_void_p
COPYFILE_STATE_FREE = LIBC.copyfile_state_free
COPYFILE_STATE_FREE.argtypes = [ctypes.c_void_p]
COPYFILE_STATE_FREE.restype = ctypes.c_int
COPYFILE_STATE_SET = LIBC.copyfile_state_set
COPYFILE_STATE_SET.argtypes = [ctypes.c_void_p, ctypes.c_uint, ctypes.c_void_p]
COPYFILE_STATE_SET.restype = ctypes.c_int
COPYFILE = LIBC.copyfile
COPYFILE.argtypes = [
    ctypes.c_char_p,
    ctypes.c_char_p,
    ctypes.c_void_p,
    ctypes.c_uint,
]
COPYFILE.restype = ctypes.c_int


def allocate_copy_state() -> ctypes.c_void_p:
    state = COPYFILE_STATE_ALLOC()
    if not state:
        raise OSError("copyfile_state_alloc failed")
    preserve_suid = ctypes.c_uint(1)
    if (
        COPYFILE_STATE_SET(
            state,
            COPYFILE_STATE_PRESERVE_SUID,
            ctypes.byref(preserve_suid),
        )
        != 0
    ):
        error = ctypes.get_errno()
        COPYFILE_STATE_FREE(state)
        raise OSError(error, os.strerror(error))
    return state


def native_copy(
    source: Path,
    destination: Path,
    flags: int,
    copy_state: ctypes.c_void_p,
) -> None:
    if COPYFILE(
        os.fsencode(source),
        os.fsencode(destination),
        copy_state,
        flags,
    ) != 0:
        error = ctypes.get_errno()
        raise OSError(error, os.strerror(error), destination)


def clone_file(
    source: Path,
    destination: Path,
    copy_state: ctypes.c_void_p,
) -> None:
    native_copy(
        source,
        destination,
        COPYFILE_CLONE_FORCE | COPYFILE_ACL | COPYFILE_NOFOLLOW_DST,
        copy_state,
    )
    os.chmod(destination, stat.S_IMODE(source.stat().st_mode))


def copy_metadata(
    source: Path,
    destination: Path,
    copy_state: ctypes.c_void_p,
) -> None:
    native_copy(
        source,
        destination,
        COPYFILE_METADATA | COPYFILE_NOFOLLOW,
        copy_state,
    )


def clone_directory(
    source: Path,
    destination: Path,
    hard_links: dict[tuple[int, int], Path],
    copy_state: ctypes.c_void_p,
    excluded_roots: tuple[Path, ...] = (),
    root: Path | None = None,
) -> None:
    destination.mkdir(mode=0o700)
    root = root or source
    with os.scandir(source) as entries:
        for entry in entries:
            source_entry = Path(entry.path)
            if source == root and source_entry in excluded_roots:
                continue
            destination_entry = destination / entry.name
            entry_stat = entry.stat(follow_symlinks=False)
            mode = entry_stat.st_mode

            if stat.S_ISDIR(mode):
                clone_directory(
                    source_entry,
                    destination_entry,
                    hard_links,
                    copy_state,
                    excluded_roots,
                    root,
                )
            elif stat.S_ISLNK(mode):
                resolved = source_entry.resolve(strict=False)
                if any(resolved == excluded or excluded in resolved.parents for excluded in excluded_roots):
                    raise OSError(
                        f"runtime link targets an excluded direct child: {source_entry}"
                    )
                destination_entry.symlink_to(os.readlink(source_entry))
                copy_metadata(source_entry, destination_entry, copy_state)
            elif stat.S_ISREG(mode):
                inode_key = (entry_stat.st_dev, entry_stat.st_ino)
                existing = hard_links.get(inode_key)
                if entry_stat.st_nlink > 1 and existing is not None:
                    os.link(existing, destination_entry)
                else:
                    clone_file(source_entry, destination_entry, copy_state)
                    if entry_stat.st_nlink > 1:
                        hard_links[inode_key] = destination_entry
            else:
                raise OSError(
                    f"unsupported runtime entry type: {source_entry}"
                )

    copy_metadata(source, destination, copy_state)
    os.chmod(destination, stat.S_IMODE(source.stat().st_mode))


def destination_aliases_source(source: Path, destination: Path) -> bool:
    current = destination
    while True:
        if current.exists() or current.is_symlink():
            try:
                if os.path.samefile(source, current):
                    return True
            except OSError:
                pass
        if current.parent == current:
            return False
        current = current.parent


def resolve_clone_paths(
    source_arg: str,
    destination_arg: str,
    excluded_names: tuple[str, ...] = (),
) -> tuple[Path, Path, tuple[Path, ...]]:
    source_input = Path(source_arg)
    if source_input.is_symlink():
        raise OSError(f"runtime source must not be a symlink: {source_input}")
    source = source_input.resolve(strict=True)
    destination = Path(destination_arg).resolve(strict=False)
    if not source.is_dir():
        raise OSError(f"runtime source must be a real directory: {source}")
    if (
        destination == source
        or source in destination.parents
        or destination_aliases_source(source, destination)
    ):
        raise OSError(
            f"runtime clone destination must be outside the source: {destination}"
        )
    if destination.exists() or destination.is_symlink():
        raise FileExistsError(destination)
    excluded_roots: list[Path] = []
    for name in excluded_names:
        if (
            not name
            or name in {".", ".."}
            or "/" in name
            or "\\" in name
            or name != "deploy-snapshots"
        ):
            raise OSError(f"unsupported direct-child exclusion: {name}")
        excluded = source / name
        if excluded.is_symlink() or (excluded.exists() and not excluded.is_dir()):
            raise OSError(f"excluded direct child must be a real directory: {excluded}")
        excluded_roots.append(excluded)
    return source, destination, tuple(excluded_roots)


def main() -> int:
    if len(sys.argv) == 4 and sys.argv[1] == "--validate-destination":
        resolve_clone_paths(sys.argv[2], sys.argv[3])
        return 0
    excluded_names: tuple[str, ...] = ()
    args = sys.argv[1:]
    if args and args[0].startswith("--exclude-direct-child="):
        excluded_names = (args.pop(0).split("=", 1)[1],)
    if len(args) != 2:
        print(
            "usage: clone-runtime-tree.py [--exclude-direct-child=deploy-snapshots] "
            "[--validate-destination] SOURCE DESTINATION",
            file=sys.stderr,
        )
        return 2

    source, destination, excluded_roots = resolve_clone_paths(
        args[0],
        args[1],
        excluded_names,
    )

    copy_state = allocate_copy_state()
    try:
        clone_directory(
            source,
            destination,
            {},
            copy_state,
            excluded_roots,
            source,
        )
    finally:
        COPYFILE_STATE_FREE(copy_state)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
