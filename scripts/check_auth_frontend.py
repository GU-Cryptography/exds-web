#!/usr/bin/env python3
"""前端鉴权检查：所有写请求必须被 permissionPrecheck 的规则覆盖。"""

from __future__ import annotations

import re
import sys
from dataclasses import dataclass
from pathlib import Path
from typing import Iterable


@dataclass
class Rule:
    methods: set[str]
    pattern: re.Pattern[str]
    raw_pattern: str


@dataclass
class RequestCall:
    file: Path
    line: int
    method: str
    path: str


METHODS_RE = re.compile(r"methods:\s*\[(?P<methods>[^\]]+)\]", re.S)

REQUEST_RE = re.compile(
    r"apiClient\.(?P<method>post|put|patch|delete)\(\s*(?P<arg>`(?:\\`|[^`])*`|'(?:\\'|[^'])*'|\"(?:\\\"|[^\"])*\")",
    re.S,
)


def _strip_quotes(s: str) -> str:
    if len(s) >= 2 and s[0] == s[-1] and s[0] in {"'", '"', "`"}:
        return s[1:-1]
    return s


def _normalize_path(path: str) -> str:
    path = path.replace("\\`", "`")
    path = re.sub(r"\$\{[^}]+\}", "x", path)
    q = path.find("?")
    h = path.find("#")
    cut = min([idx for idx in (q, h) if idx != -1], default=-1)
    if cut != -1:
        path = path[:cut]
    return path


def _load_rules(permission_file: Path) -> tuple[list[Rule], list[re.Pattern[str]]]:
    text = permission_file.read_text(encoding="utf-8")
    rules: list[Rule] = []
    arr_match = re.search(r"const MUTATION_PERMISSION_RULES:\s*MutationPermissionRule\[\]\s*=\s*\[(?P<body>.*?)\];", text, re.S)
    if not arr_match:
        raise RuntimeError("未找到 MUTATION_PERMISSION_RULES")
    body = arr_match.group("body")

    blocks: list[str] = []
    depth = 0
    start = -1
    for idx, ch in enumerate(body):
        if ch == "{":
            if depth == 0:
                start = idx
            depth += 1
        elif ch == "}":
            depth -= 1
            if depth == 0 and start != -1:
                blocks.append(body[start : idx + 1])
                start = -1

    for block in blocks:
        m_methods = METHODS_RE.search(block)
        pattern_raw = _extract_pattern_literal(block)
        if not m_methods or not pattern_raw:
            continue
        methods = set(re.findall(r"'(post|put|patch|delete)'", m_methods.group("methods")))
        try:
            compiled = re.compile(pattern_raw)
        except re.error as exc:
            raise RuntimeError(f"无法编译 MUTATION 规则正则: /{pattern_raw}/ ({exc})") from exc
        rules.append(Rule(methods=methods, pattern=compiled, raw_pattern=pattern_raw))

    excluded: list[re.Pattern[str]] = []
    excluded_arr = re.search(r"const EXCLUDED_PATH_PATTERNS:\s*RegExp\[\]\s*=\s*\[(?P<body>.*?)\];", text, re.S)
    if excluded_arr:
        body = excluded_arr.group("body")
        idx = 0
        while idx < len(body):
            slash = body.find("/", idx)
            if slash == -1:
                break
            extracted = _scan_regex_literal(body, slash)
            if extracted is None:
                idx = slash + 1
                continue
            pattern_raw, end_idx = extracted
            excluded.append(re.compile(pattern_raw))
            idx = end_idx

    return rules, excluded


def _scan_regex_literal(text: str, slash_index: int) -> tuple[str, int] | None:
    if slash_index < 0 or slash_index >= len(text) or text[slash_index] != "/":
        return None
    i = slash_index + 1
    escaped = False
    in_class = False
    out_chars: list[str] = []
    while i < len(text):
        ch = text[i]
        if escaped:
            out_chars.append(ch)
            escaped = False
        elif ch == "\\":
            out_chars.append(ch)
            escaped = True
        elif ch == "[":
            out_chars.append(ch)
            in_class = True
        elif ch == "]":
            out_chars.append(ch)
            in_class = False
        elif ch == "/" and not in_class:
            j = i + 1
            while j < len(text) and text[j].isalpha():
                j += 1
            return "".join(out_chars), j
        else:
            out_chars.append(ch)
        i += 1
    return None


def _extract_pattern_literal(block: str) -> str | None:
    key = "pattern:"
    pos = block.find(key)
    if pos == -1:
        return None
    slash = block.find("/", pos + len(key))
    if slash == -1:
        return None
    extracted = _scan_regex_literal(block, slash)
    if extracted is None:
        return None
    return extracted[0]


def _scan_requests(frontend_src: Path) -> Iterable[RequestCall]:
    for path in frontend_src.rglob("*.[tj]s*"):
        if "node_modules" in path.parts:
            continue
        text = path.read_text(encoding="utf-8")
        for m in REQUEST_RE.finditer(text):
            method = m.group("method")
            arg = _strip_quotes(m.group("arg"))
            normalized = _normalize_path(arg)
            line = text.count("\n", 0, m.start()) + 1
            yield RequestCall(file=path, line=line, method=method, path=normalized)


def main() -> int:
    root = Path(__file__).resolve().parents[1]
    permission_file = root / "frontend" / "src" / "auth" / "permissionPrecheck.ts"
    frontend_src = root / "frontend" / "src"

    rules, excluded = _load_rules(permission_file)
    violations: list[str] = []

    for req in _scan_requests(frontend_src):
        if not req.path.startswith("/"):
            continue
        if any(pat.search(req.path) for pat in excluded):
            continue

        matched = False
        for rule in rules:
            if req.method in rule.methods and rule.pattern.search(req.path):
                matched = True
                break
        if not matched:
            rel = req.file.relative_to(root)
            violations.append(f"{rel}:{req.line} [{req.method.upper()} {req.path}] 未匹配 MUTATION_PERMISSION_RULES")

    if violations:
        print("前端鉴权检查失败：")
        for v in violations:
            print(f"- {v}")
        return 1

    print("前端鉴权检查通过：所有写请求均已被 Q 层规则覆盖。")
    return 0


if __name__ == "__main__":
    sys.exit(main())
