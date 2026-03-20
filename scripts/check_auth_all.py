#!/usr/bin/env python3
"""统一执行鉴权检查（后端、前端、路由一致性）。"""

from __future__ import annotations

import subprocess
import sys
from pathlib import Path


def _run(script: str) -> int:
    root = Path(__file__).resolve().parents[1]
    cmd = [sys.executable, str(root / "scripts" / script)]
    print(f"> {' '.join(cmd)}")
    result = subprocess.run(cmd, cwd=root)
    return result.returncode


def main() -> int:
    steps = [
        "check_auth_backend.py",
        "check_auth_frontend.py",
        "check_auth_route_consistency.py",
    ]
    failed = False
    for step in steps:
        code = _run(step)
        if code != 0:
            failed = True
    if failed:
        print("鉴权总检查失败。")
        return 1
    print("鉴权总检查通过。")
    return 0


if __name__ == "__main__":
    sys.exit(main())
