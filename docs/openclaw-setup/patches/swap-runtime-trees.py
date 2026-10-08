#!/usr/bin/env python3
"""Atomically exchange two existing directories on the same macOS filesystem."""
import ctypes
import os
import sys

if len(sys.argv) != 3:
    raise SystemExit("usage: swap-runtime-trees.py CURRENT REPLACEMENT")
current, replacement = map(os.fsencode, sys.argv[1:])
libc = ctypes.CDLL("/usr/lib/libSystem.B.dylib", use_errno=True)
swap = libc.renamex_np
swap.argtypes = [ctypes.c_char_p, ctypes.c_char_p, ctypes.c_uint]
swap.restype = ctypes.c_int
if swap(current, replacement, 2) != 0:
    error = ctypes.get_errno()
    raise OSError(error, os.strerror(error))
