#!/usr/bin/env python3
"""Publish a restored directory without replacing an existing macOS path."""
import ctypes
import os
import sys

if len(sys.argv) != 3:
    raise SystemExit("usage: publish-runtime-tree.py STAGED DESTINATION")
staged, destination = map(os.fsencode, sys.argv[1:])
libc = ctypes.CDLL("/usr/lib/libSystem.B.dylib", use_errno=True)
publish = libc.renamex_np
publish.argtypes = [ctypes.c_char_p, ctypes.c_char_p, ctypes.c_uint]
publish.restype = ctypes.c_int
# Darwin RENAME_EXCL: fail atomically if the destination appeared meanwhile.
if publish(staged, destination, 4) != 0:
    error = ctypes.get_errno()
    raise OSError(error, os.strerror(error))
fd = os.open(os.path.dirname(destination), os.O_RDONLY)
try:
    os.fsync(fd)
finally:
    os.close(fd)
