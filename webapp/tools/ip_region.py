import ipaddress
import os
from functools import lru_cache
from typing import Optional


def _normalize_ip(ip: Optional[str]) -> Optional[str]:
    value = (ip or "").strip()
    if not value:
        return None
    if value.startswith("::ffff:"):
        value = value.replace("::ffff:", "", 1)
    if value in ("::1", "127.0.0.1", "localhost"):
        return "127.0.0.1"
    return value


def _is_private_or_local(ip: str) -> bool:
    try:
        addr = ipaddress.ip_address(ip)
        return addr.is_private or addr.is_loopback or addr.is_link_local
    except ValueError:
        return False


@lru_cache(maxsize=1)
def _get_ip2region_searcher():
    db_path = os.path.join(os.path.dirname(__file__), "ip2region_v4.xdb")
    if not os.path.exists(db_path):
        return None

    try:
        # 优先适配当前 py-ip2region 包（ip2region.searcher.Searcher）
        from ip2region import searcher, util  # type: ignore
        header = util.load_header_from_file(db_path)
        version = util.version_from_header(header)
        if not version:
            return None
        return searcher.new_with_file_only(version, db_path)
    except Exception:
        # 兼容部分旧版包 API（XdbSearcher）
        try:
            import ip2region  # type: ignore
            return ip2region.XdbSearcher(dbfile=db_path)
        except Exception:
            return None


def resolve_ip_city(ip: Optional[str]) -> str:
    """
    解析登录IP归属城市。
    - 私网/本地回环：返回“内网IP”
    - 可用 IP2Region：返回城市（或地区字符串）
    - 其他异常：返回“未知”
    """
    normalized_ip = _normalize_ip(ip)
    if not normalized_ip:
        return "未知"

    if _is_private_or_local(normalized_ip):
        return "内网IP"

    searcher = _get_ip2region_searcher()
    if not searcher:
        return "未知"

    try:
        region_text = searcher.search(normalized_ip) or ""
        # 常见输出类似：中国|0|江西省|宜春市|电信
        parts = [p for p in str(region_text).split("|") if p and p != "0"]
        if not parts:
            return "未知"
        if len(parts) >= 4:
            return f"{parts[2]}{parts[3]}"
        if len(parts) >= 3:
            return parts[2]
        return parts[-1]
    except Exception:
        return "未知"
