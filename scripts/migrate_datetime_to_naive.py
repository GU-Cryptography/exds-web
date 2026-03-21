#!/usr/bin/env python3
"""将 MongoDB 历史带时区时间值迁移为 naive 时间（本地时区）。"""

from __future__ import annotations

import argparse
import re
import sys
from collections import Counter
from datetime import datetime
from pathlib import Path
from typing import Any


ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from webapp.tools.mongo import DATABASE  # noqa: E402


TZ_OFFSET_RE = re.compile(r"(?:[+-]\d{2}:\d{2}|[+-]\d{4})$")


def _parse_tz_datetime_string(value: str) -> datetime | None:
    s = value.strip()
    if not s:
        return None
    if not (s.endswith("Z") or TZ_OFFSET_RE.search(s)):
        return None
    try:
        if s.endswith("Z"):
            s = s[:-1] + "+00:00"
        dt = datetime.fromisoformat(s)
        if dt.tzinfo is None:
            return None
        return dt
    except Exception:
        return None


def _walk_collect_updates(value: Any, path: str, updates: dict[str, Any]) -> int:
    hits = 0
    if isinstance(value, dict):
        for k, v in value.items():
            child = f"{path}.{k}" if path else str(k)
            hits += _walk_collect_updates(v, child, updates)
        return hits

    if isinstance(value, list):
        for idx, item in enumerate(value):
            child = f"{path}.{idx}" if path else str(idx)
            hits += _walk_collect_updates(item, child, updates)
        return hits

    if isinstance(value, str):
        dt = _parse_tz_datetime_string(value)
        if dt is None:
            return 0
        updates[path] = dt.astimezone().replace(tzinfo=None).isoformat()
        return 1

    if isinstance(value, datetime) and value.tzinfo is not None:
        updates[path] = value.astimezone().replace(tzinfo=None)
        return 1

    return 0


def _iter_collections(target_collections: list[str] | None):
    if target_collections:
        for name in target_collections:
            yield name
        return
    for name in DATABASE.list_collection_names():
        if not name.startswith("system."):
            yield name


def main() -> int:
    parser = argparse.ArgumentParser(description="迁移历史带时区时间值为 naive")
    parser.add_argument(
        "--collections",
        default="",
        help="逗号分隔集合名，不传则扫描全部业务集合",
    )
    parser.add_argument(
        "--limit-per-collection",
        type=int,
        default=0,
        help="每个集合最多处理文档数，0 表示不限制",
    )
    parser.add_argument(
        "--apply",
        action="store_true",
        help="执行写库；不传则为 dry-run",
    )
    args = parser.parse_args()

    target_collections = [x.strip() for x in args.collections.split(",") if x.strip()] or None
    limit = max(0, args.limit_per_collection)
    dry_run = not args.apply

    scanned_docs = 0
    changed_docs = 0
    changed_values = 0
    changed_by_collection: Counter[str] = Counter()

    print("=== 迁移模式 ===")
    print(f"dry-run: {dry_run}")
    print(f"limit-per-collection: {limit}")
    if target_collections:
        print(f"collections: {', '.join(target_collections)}")
    else:
        print("collections: ALL")

    for coll_name in _iter_collections(target_collections):
        cursor = DATABASE[coll_name].find({})
        if limit > 0:
            cursor = cursor.limit(limit)

        for doc in cursor:
            scanned_docs += 1
            updates: dict[str, Any] = {}
            hit_count = _walk_collect_updates(doc, "", updates)
            if hit_count <= 0:
                continue

            changed_docs += 1
            changed_values += hit_count
            changed_by_collection[coll_name] += hit_count

            if dry_run:
                continue

            DATABASE[coll_name].update_one({"_id": doc["_id"]}, {"$set": updates})

    print("\n=== 迁移结果 ===")
    print(f"扫描文档数: {scanned_docs}")
    print(f"变更文档数: {changed_docs}")
    print(f"变更值数量: {changed_values}")
    if changed_by_collection:
        print("按集合统计:")
        for coll_name, cnt in changed_by_collection.most_common():
            print(f"  - {coll_name}: {cnt}")

    if dry_run:
        print("\n提示：当前为 dry-run。确认后加 --apply 执行写库。")

    return 0


if __name__ == "__main__":
    raise SystemExit(main())

