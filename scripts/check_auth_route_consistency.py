#!/usr/bin/env python3
"""鉴权一致性检查：auth_modules、前端路由守卫规则、菜单路径必须一致。"""

from __future__ import annotations

import re
import sys
from pathlib import Path


def _read(path: Path) -> str:
    return path.read_text(encoding="utf-8-sig")


def _extract_module_codes_from_seed(seed_file: Path) -> set[str]:
    text = _read(seed_file)
    return set(re.findall(r'"module_code":\s*"([^"]+)"', text))


def _extract_route_rules(permission_file: Path) -> list[tuple[re.Pattern[str], str]]:
    text = _read(permission_file)
    matches = re.findall(
        r"pattern:\s*/((?:\\/|[^/])*)/[a-z]*\s*,\s*viewPermission:\s*modulePermission\('([^']+)'\s*,\s*'view'\)",
        text,
    )
    rules: list[tuple[re.Pattern[str], str]] = []
    for pattern_raw, module_code in matches:
        py_pat = pattern_raw.replace(r"\/", "/")
        rules.append((re.compile(py_pat), module_code))
    return rules


def _extract_paths_from_routes(route_file: Path) -> list[str]:
    text = _read(route_file)
    return re.findall(r"path:\s*'([^']+)'", text)


def _extract_paths_from_sidebar(sidebar_file: Path) -> list[str]:
    text = _read(sidebar_file)
    return re.findall(r"path:\s*'(/[^']+)'", text)


def _normalize_path(path: str) -> str:
    return re.sub(r":[A-Za-z_][A-Za-z0-9_]*", "x", path)


def _is_check_target(path: str) -> bool:
    # 仅检查业务菜单与业务路由，排除登录和非菜单内部页。
    prefixes = (
        "/dashboard",
        "/customer/",
        "/load-forecast/",
        "/price-analysis/",
        "/price-forecast/",
        "/trading-strategy/",
        "/trade-review/",
        "/settlement/",
        "/basic-data/",
        "/system-settings/",
    )
    return path.startswith(prefixes)


def main() -> int:
    root = Path(__file__).resolve().parents[1]
    seed_file = root / "webapp" / "scripts" / "init_auth_data.py"
    permission_file = root / "frontend" / "src" / "auth" / "permissionPrecheck.ts"
    route_file = root / "frontend" / "src" / "config" / "routes.tsx"
    sidebar_file = root / "frontend" / "src" / "components" / "Sidebar.tsx"

    seed_modules = _extract_module_codes_from_seed(seed_file)
    route_rules = _extract_route_rules(permission_file)
    rule_modules = {module for _, module in route_rules}

    missing_in_rules = sorted(seed_modules - rule_modules)
    unknown_in_rules = sorted(rule_modules - seed_modules)

    violations: list[str] = []

    if missing_in_rules:
        violations.append("以下 module_code 存在于 init_auth_data.py，但未出现在 ROUTE_PERMISSION_RULES：")
        violations.extend([f"  - {m}" for m in missing_in_rules])

    if unknown_in_rules:
        violations.append("以下 module_code 存在于 ROUTE_PERMISSION_RULES，但不在 init_auth_data.py：")
        violations.extend([f"  - {m}" for m in unknown_in_rules])

    route_paths = [_normalize_path(p) for p in _extract_paths_from_routes(route_file) if _is_check_target(p)]
    sidebar_paths = [_normalize_path(p) for p in _extract_paths_from_sidebar(sidebar_file) if _is_check_target(p)]
    all_paths = sorted(set(route_paths + sidebar_paths))

    for path in all_paths:
        matched = [module for pat, module in route_rules if pat.search(path)]
        if not matched:
            violations.append(f"路径未匹配 ROUTE_PERMISSION_RULES：{path}")

    if violations:
        print("鉴权路由一致性检查失败：")
        for item in violations:
            print(item)
        return 1

    print("鉴权路由一致性检查通过：auth_modules、路由守卫规则、菜单路径一致。")
    return 0


if __name__ == "__main__":
    sys.exit(main())
