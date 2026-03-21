#!/usr/bin/env python3
"""扫描 MongoDB 中包含时区信息的时间值（只读，不修改）。"""

from __future__ import annotations

import argparse
import re
import sys
from collections import Counter, defaultdict
from datetime import datetime
from pathlib import Path
from typing import Any, Iterable


ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from webapp.tools.mongo import DATABASE  # noqa: E402


TZ_OFFSET_RE = re.compile(r"(?:[+-]\d{2}:\d{2}|[+-]\d{4})$")


def _parse_tz_datetime_string(value: str) -> datetime | None:
    """若字符串是带时区 ISO 时间则返回 datetime，否则返回 None。"""
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


def _iter_collections(target_collections: list[str] | None) -> Iterable[str]:
    if target_collections:
        for name in target_collections:
            yield name
        return
    for name in DATABASE.list_collection_names():
        if not name.startswith("system."):
            yield name


def _walk(
    value: Any,
    path: str,
    collection_name: str,
    doc_id: Any,
    field_counter: Counter[str],
    doc_counter: Counter[str],
    examples: dict[str, list[dict[str, Any]]],
    max_examples: int,
) -> int:
    hits = 0
    if isinstance(value, dict):
        for k, v in value.items():
            child_path = f"{path}.{k}" if path else str(k)
            hits += _walk(
                v, child_path, collection_name, doc_id, field_counter, doc_counter, examples, max_examples
            )
        return hits

    if isinstance(value, list):
        for idx, item in enumerate(value):
            child_path = f"{path}.{idx}" if path else str(idx)
            hits += _walk(
                item, child_path, collection_name, doc_id, field_counter, doc_counter, examples, max_examples
            )
        return hits

    is_hit = False
    sample_before = None
    sample_after = None

    if isinstance(value, str):
        dt = _parse_tz_datetime_string(value)
        if dt is not None:
            local_naive = dt.astimezone().replace(tzinfo=None)
            is_hit = True
            sample_before = value
            sample_after = local_naive.isoformat()
    elif isinstance(value, datetime) and value.tzinfo is not None:
        local_naive = value.astimezone().replace(tzinfo=None)
        is_hit = True
        sample_before = value.isoformat()
        sample_after = local_naive.isoformat()

    if not is_hit:
        return 0

    field_counter[path] += 1
    doc_counter[str(doc_id)] += 1
    if len(examples[collection_name]) < max_examples:
        examples[collection_name].append(
            {
                "id": str(doc_id),
                "path": path,
                "before": sample_before,
                "after": sample_after,
            }
        )
    return 1


def main() -> int:
    parser = argparse.ArgumentParser(description="扫描含时区信息的历史时间字段")
    parser.add_argument(
        "--collections",
        default="",
        help="逗号分隔的集合名，不传则扫描全部业务集合",
    )
    parser.add_argument(
        "--limit-per-collection",
        type=int,
        default=0,
        help="每个集合最多扫描文档数，0 表示不限制",
    )
    parser.add_argument(
        "--max-examples",
        type=int,
        default=5,
        help="每个集合输出示例数量",
    )
    args = parser.parse_args()

    target_collections = [x.strip() for x in args.collections.split(",") if x.strip()] or None
    limit = max(0, args.limit_per_collection)

    collection_hit_count: Counter[str] = Counter()
    collection_doc_hit_count: Counter[str] = Counter()
    field_hit_count_by_collection: dict[str, Counter[str]] = defaultdict(Counter)
    examples: dict[str, list[dict[str, Any]]] = defaultdict(list)

    scanned_docs_total = 0
    hit_values_total = 0

    for coll_name in _iter_collections(target_collections):
        cursor = DATABASE[coll_name].find({}, {"_id": 1})
        if limit > 0:
            cursor = cursor.limit(limit)

        # 为减少内存，仅逐条取文档并二次读取完整内容
        scanned_coll_docs = 0
        hit_coll_values = 0
        hit_coll_docs: Counter[str] = Counter()
        for id_doc in cursor:
            scanned_coll_docs += 1
            scanned_docs_total += 1
            doc = DATABASE[coll_name].find_one({"_id": id_doc["_id"]})
            if not doc:
                continue
            hits = _walk(
                doc,
                "",
                coll_name,
                id_doc["_id"],
                field_hit_count_by_collection[coll_name],
                hit_coll_docs,
                examples,
                args.max_examples,
            )
            if hits > 0:
                hit_coll_values += hits
                hit_values_total += hits

        if hit_coll_values > 0:
            collection_hit_count[coll_name] = hit_coll_values
            collection_doc_hit_count[coll_name] = len(hit_coll_docs)

    print("=== 扫描结果 ===")
    print(f"扫描文档总数: {scanned_docs_total}")
    print(f"命中值总数: {hit_values_total}")
    print(f"命中集合数: {len(collection_hit_count)}")

    if not collection_hit_count:
        print("未发现带时区信息的时间值。")
        return 0

    for coll_name, value_hits in collection_hit_count.most_common():
        print(f"\n[集合] {coll_name}")
        print(f"  命中文档数: {collection_doc_hit_count[coll_name]}")
        print(f"  命中值数量: {value_hits}")
        field_counter = field_hit_count_by_collection[coll_name]
        top_fields = field_counter.most_common(10)
        print("  高频字段:")
        for path, cnt in top_fields:
            print(f"    - {path}: {cnt}")
        if examples[coll_name]:
            print("  示例:")
            for ex in examples[coll_name]:
                print(f"    - id={ex['id']} path={ex['path']}")
                print(f"      before={ex['before']}")
                print(f"      after ={ex['after']}")

    return 0


if __name__ == "__main__":
    raise SystemExit(main())

