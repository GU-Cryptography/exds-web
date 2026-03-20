#!/usr/bin/env python3
"""检查 Git 暂存区中的文本文件是否存在乱码或非 UTF-8 内容。"""

from __future__ import annotations

import subprocess
import sys
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
# 通过 unicode 转义保存高风险乱码 token，避免脚本自身被误判。
SUSPICIOUS_TOKENS = (
    "\u951f\u65a4\u62f7",
    "\u70eb\u70eb\u70eb",
    "\u00ef\u00bf\u00bd",
    "\ufffd",
)
SUSPICIOUS_CHARS = set(
    "ÃÂÄÅÆÇÐÑÕÖØÜÝÞß"
    "àáâãäåæçèéêëìíîï"
    "ðñòóôõöøùúûüýþÿ"
)


def _configure_stdio() -> None:
    for stream_name in ("stdout", "stderr"):
        stream = getattr(sys, stream_name, None)
        reconfigure = getattr(stream, "reconfigure", None)
        if callable(reconfigure):
            reconfigure(encoding="utf-8", errors="backslashreplace")


def _git_output(*args: str) -> bytes:
    result = subprocess.run(
        ["git", *args],
        cwd=ROOT,
        capture_output=True,
        check=False,
    )
    if result.returncode != 0:
        message = result.stderr.decode("utf-8", errors="replace").strip()
        raise RuntimeError(message or f"git {' '.join(args)} 执行失败")
    return result.stdout


def _iter_staged_paths() -> list[str]:
    raw = _git_output("diff", "--cached", "--name-only", "--diff-filter=ACMR", "-z")
    if not raw:
        return []
    return [item.decode("utf-8", errors="surrogateescape") for item in raw.split(b"\x00") if item]


def _read_staged_blob(path: str) -> bytes:
    return _git_output("show", f":{path}")


def _is_binary(data: bytes) -> bool:
    return b"\x00" in data


def _count_cjk(text: str) -> int:
    total = 0
    for char in text:
        code = ord(char)
        if 0x4E00 <= code <= 0x9FFF:
            total += 1
    return total


def _count_suspicious(text: str) -> int:
    token_hits = sum(text.count(token) * 3 for token in SUSPICIOUS_TOKENS)
    char_hits = sum(1 for char in text if char in SUSPICIOUS_CHARS)
    return token_hits + char_hits


def _repair_candidate(text: str) -> str | None:
    if _count_suspicious(text) < 2:
        return None
    for codec in ("latin1", "cp1252"):
        try:
            repaired = text.encode(codec).decode("utf-8")
        except (UnicodeEncodeError, UnicodeDecodeError):
            continue
        if repaired == text:
            continue
        if _count_cjk(repaired) > _count_cjk(text) and _count_suspicious(repaired) < _count_suspicious(text):
            return repaired
    return None


def _format_excerpt(text: str, limit: int = 80) -> str:
    normalized = text.strip().replace("\t", " ")
    if len(normalized) <= limit:
        return normalized
    return normalized[: limit - 3] + "..."


def _scan_text(path: str, text: str) -> list[str]:
    issues: list[str] = []
    for line_no, line in enumerate(text.splitlines(), start=1):
        if "\ufffd" in line:
            issues.append(f"{path}:{line_no} 包含替换字符 U+FFFD，疑似已发生编码损坏")
            continue
        hit_token = next((token for token in SUSPICIOUS_TOKENS if token != "\ufffd" and token in line), None)
        if hit_token is not None:
            issues.append(f"{path}:{line_no} 包含高风险乱码片段 `{hit_token}`")
            continue
        repaired = _repair_candidate(line)
        if repaired is not None:
            issues.append(
                f"{path}:{line_no} 疑似乱码：`{_format_excerpt(line)}` -> `{_format_excerpt(repaired)}`"
            )
    return issues


def main() -> int:
    _configure_stdio()
    try:
        staged_paths = _iter_staged_paths()
    except RuntimeError as exc:
        print(f"[garbled-check] 无法读取暂存区：{exc}")
        return 1

    if not staged_paths:
        print("[garbled-check] 未检测到已暂存文件，跳过乱码检查。")
        return 0

    issues: list[str] = []
    for path in staged_paths:
        try:
            data = _read_staged_blob(path)
        except RuntimeError as exc:
            issues.append(f"{path}: 无法读取暂存内容：{exc}")
            continue

        if _is_binary(data):
            continue

        try:
            text = data.decode("utf-8")
        except UnicodeDecodeError as exc:
            issues.append(
                f"{path}: 暂存内容不是有效 UTF-8（位置 {exc.start}-{exc.end}），提交已阻止"
            )
            continue

        issues.extend(_scan_text(path, text))

    if issues:
        print("[garbled-check] 检测到疑似乱码或编码问题：")
        for item in issues:
            print(f"  - {item}")
        print("[garbled-check] 请修复后重新 `git add`，再执行提交。")
        return 1

    print("[garbled-check] 暂存区文本文件未发现明显乱码。")
    return 0


if __name__ == "__main__":
    sys.exit(main())
