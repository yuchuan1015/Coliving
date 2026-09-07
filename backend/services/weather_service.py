"""住戶當地的真天氣（艙室窗戶用）。她定：艙室按住戶當地，公共場域（公園）共用社區的固定天氣。

來源 Open-Meteo（免費、不用金鑰）。位置：住戶填的城市（geocoding 轉座標）→ 沒填就用時區推大城市。
快取：同一組座標 30 分鐘內不重打。打不通就回 None，前端退回公園的社區天氣。
"""
from __future__ import annotations

import logging
import time

import httpx

from models.user import User
from services import time_service

logger = logging.getLogger(__name__)

CACHE_TTL = 1800
_cache: dict[tuple[float, float], tuple[float, dict]] = {}
_geo_cache: dict[str, tuple[float, float, str] | None] = {}

# 時區 → 代表城市座標（沒填城市時的預設）
TZ_DEFAULT = {
    "Asia/Taipei": (25.03, 121.57, "台北"), "Asia/Tokyo": (35.68, 139.69, "東京"), "Asia/Seoul": (37.57, 126.98, "首爾"),
    "Asia/Shanghai": (31.23, 121.47, "上海"), "Asia/Hong_Kong": (22.32, 114.17, "香港"), "Asia/Singapore": (1.35, 103.82, "新加坡"),
    "Asia/Bangkok": (13.76, 100.50, "曼谷"), "Asia/Kuala_Lumpur": (3.14, 101.69, "吉隆坡"), "Asia/Manila": (14.60, 120.98, "馬尼拉"),
    "Asia/Jakarta": (-6.21, 106.85, "雅加達"), "Asia/Kolkata": (19.08, 72.88, "孟買"), "Asia/Dubai": (25.20, 55.27, "杜拜"),
    "Australia/Sydney": (-33.87, 151.21, "雪梨"), "Australia/Melbourne": (-37.81, 144.96, "墨爾本"), "Pacific/Auckland": (-36.85, 174.76, "奧克蘭"),
    "Europe/London": (51.51, -0.13, "倫敦"), "Europe/Paris": (48.86, 2.35, "巴黎"), "Europe/Berlin": (52.52, 13.41, "柏林"),
    "Europe/Amsterdam": (52.37, 4.90, "阿姆斯特丹"), "Europe/Madrid": (40.42, -3.70, "馬德里"), "Europe/Rome": (41.90, 12.50, "羅馬"),
    "America/New_York": (40.71, -74.01, "紐約"), "America/Chicago": (41.88, -87.63, "芝加哥"), "America/Denver": (39.74, -104.99, "丹佛"),
    "America/Los_Angeles": (34.05, -118.24, "洛杉磯"), "America/Vancouver": (49.28, -123.12, "溫哥華"), "America/Toronto": (43.65, -79.38, "多倫多"),
    "America/Sao_Paulo": (-23.55, -46.63, "聖保羅"), "UTC": (25.03, 121.57, "台北"),
}

# WMO 天氣代碼 → 跟公園同一套 key，前端不用多學一套
def _wmo(code: int, wind_kmh: float) -> tuple[str, str, str]:
    if code in (95, 96, 99):
        return "stormy", "⛈️", "雷雨"
    if code in (45, 48):
        return "foggy", "🌫️", "起霧"
    if 51 <= code <= 67 or 80 <= code <= 82:
        return "rainy", "🌧️", "下雨"
    if 71 <= code <= 77 or 85 <= code <= 86:
        return "rainy", "🌨️", "下雪"
    if wind_kmh >= 30:
        return "windy", "🍃", "風大"
    if code in (0, 1):
        return "sunny", "☀️", "晴"
    return "cloudy", "⛅", "多雲"


def geocode(city: str) -> tuple[float, float, str] | None:
    """城市名 → (lat, lon, 顯示名)。Open-Meteo geocoding，中英文都吃。"""
    city = city.strip()
    if not city:
        return None
    if city in _geo_cache:
        return _geo_cache[city]
    try:
        r = httpx.get("https://geocoding-api.open-meteo.com/v1/search", params={"name": city, "count": 1, "language": "zh"}, timeout=8.0)
        res = (r.json() or {}).get("results") or []
        out = (res[0]["latitude"], res[0]["longitude"], res[0].get("name", city)) if res else None
    except Exception as e:  # noqa: BLE001
        logger.warning("geocode failed for %s: %s", city, e)
        out = None
    _geo_cache[city] = out
    return out


def location_of(user: User) -> tuple[float, float, str] | None:
    """住戶的位置：填了城市就查，沒填用時區推。"""
    if getattr(user, "location_name", None):
        if user.location_lat is not None and user.location_lon is not None:
            return (user.location_lat, user.location_lon, user.location_name)
        g = geocode(user.location_name)
        if g:
            return g
    tz = time_service.tz_name_of(user)
    return TZ_DEFAULT.get(tz) or TZ_DEFAULT.get(tz.split("/")[0] + "/" + tz.split("/")[-1]) or None


def current(lat: float, lon: float) -> dict | None:
    key = (round(lat, 2), round(lon, 2))
    hit = _cache.get(key)
    if hit and time.time() - hit[0] < CACHE_TTL:
        return hit[1]
    try:
        r = httpx.get("https://api.open-meteo.com/v1/forecast", params={
            "latitude": lat, "longitude": lon, "current": "temperature_2m,weather_code,wind_speed_10m,is_day", "timezone": "auto",
        }, timeout=8.0)
        cur = r.json()["current"]
        weather, emoji, desc = _wmo(int(cur["weather_code"]), float(cur.get("wind_speed_10m", 0)))
        if weather == "sunny" and not cur.get("is_day", 1):
            emoji, desc = "🌙", "晴朗的夜"
        out = {"weather": weather, "emoji": emoji, "description": desc, "temperature": round(float(cur["temperature_2m"])),
               "wind_kmh": round(float(cur.get("wind_speed_10m", 0))), "is_day": bool(cur.get("is_day", 1)), "observed_at": cur.get("time")}
    except Exception as e:  # noqa: BLE001
        logger.warning("open-meteo failed for %s,%s: %s", lat, lon, e)
        return None
    _cache[key] = (time.time(), out)
    return out


def local_weather(user: User) -> dict | None:
    """給窗戶用：{weather, emoji, description, temperature, location, source:"local"}；拿不到回 None（前端退回社區天氣）。"""
    loc = location_of(user)
    if not loc:
        return None
    w = current(loc[0], loc[1])
    if not w:
        return None
    return {**w, "location": loc[2], "source": "local"}
