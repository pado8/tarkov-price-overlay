"""
PyInstaller runtime hook: add bundled torch/lib to the DLL search path.
Diagnostics on stderr so we can see what the frozen app sees.
"""

import os
import sys


def _register_torch_dll_dir() -> None:
    base = getattr(sys, "_MEIPASS", None) or os.path.dirname(
        os.path.abspath(sys.argv[0])
    )
    torch_lib = os.path.join(base, "torch", "lib")
    sys.stderr.write(f"[runtime-hook-torch] base={base}\n")
    sys.stderr.write(
        f"[runtime-hook-torch] torch_lib={torch_lib} exists={os.path.isdir(torch_lib)}\n"
    )
    if not os.path.isdir(torch_lib):
        return
    try:
        files = sorted(os.listdir(torch_lib))
    except OSError:
        files = []
    sys.stderr.write(
        f"[runtime-hook-torch] {len(files)} files in torch_lib (first 5: {files[:5]})\n"
    )

    os.environ["PATH"] = torch_lib + os.pathsep + os.environ.get("PATH", "")
    if hasattr(os, "add_dll_directory"):
        try:
            os.add_dll_directory(torch_lib)
            sys.stderr.write("[runtime-hook-torch] add_dll_directory OK\n")
        except OSError as e:
            sys.stderr.write(f"[runtime-hook-torch] add_dll_directory FAILED: {e}\n")
    sys.stderr.flush()


_register_torch_dll_dir()
