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


# 台灣的城市自己查表（2026-09-09）：Open-Meteo 的中文索引對台灣很差——「台北」「花蓮」查不到，
# 「高雄」「新北」會查到大陸同名的地方，差上千公里。這張表先比，比不到才問 API。
TW_PLACES: dict[str, tuple[float, float, str]] = {
    # 六都與縣市
    "台北": (25.0330, 121.5654, "台北市"),
    "新北": (25.0169, 121.4628, "新北市"),
    "基隆": (25.1276, 121.7392, "基隆市"),
    "桃園": (24.9937, 121.3009, "桃園市"),
    "新竹": (24.8138, 120.9675, "新竹市"),
    "竹北": (24.8387, 121.0177, "竹北市"),
    "苗栗": (24.5602, 120.8214, "苗栗市"),
    "台中": (24.1477, 120.6736, "台中市"),
    "彰化": (24.0518, 120.5161, "彰化市"),
    "南投": (23.9609, 120.9719, "南投市"),
    "雲林": (23.7075, 120.5439, "雲林縣"),
    "斗六": (23.7075, 120.5439, "斗六市"),
    "嘉義": (23.4801, 120.4491, "嘉義市"),
    "台南": (22.9999, 120.2270, "台南市"),
    "高雄": (22.6273, 120.3014, "高雄市"),
    "屏東": (22.6813, 120.4880, "屏東市"),
    "宜蘭": (24.7021, 121.7378, "宜蘭市"),
    "羅東": (24.6772, 121.7666, "羅東鎮"),
    "花蓮": (23.9871, 121.6015, "花蓮市"),
    "台東": (22.7583, 121.1444, "台東市"),
    "澎湖": (23.5654, 119.5665, "澎湖縣"),
    "馬公": (23.5654, 119.5665, "馬公市"),
    "金門": (24.4321, 118.3171, "金門縣"),
    "連江": (26.1608, 119.9500, "連江縣"),
    "馬祖": (26.1608, 119.9500, "馬祖"),
    # 常講的區鎮
    "板橋": (25.0143, 121.4672, "新北市板橋"),
    "中和": (24.9993, 121.4989, "新北市中和"),
    "永和": (25.0107, 121.5152, "新北市永和"),
    "新莊": (25.0359, 121.4503, "新北市新莊"),
    "三重": (25.0616, 121.4869, "新北市三重"),
    "新店": (24.9678, 121.5417, "新北市新店"),
    "汐止": (25.0629, 121.6586, "新北市汐止"),
    "淡水": (25.1697, 121.4406, "新北市淡水"),
    "中壢": (24.9537, 121.2251, "桃園市中壢"),
    "豐原": (24.2530, 120.7180, "台中市豐原"),
    "鹿港": (24.0576, 120.4347, "彰化縣鹿港"),
    "埔里": (23.9650, 120.9677, "南投縣埔里"),
    "恆春": (22.0028, 120.7455, "屏東縣恆春"),
    "墾丁": (21.9483, 120.7997, "屏東縣墾丁"),
    "蘇澳": (24.5951, 121.8425, "宜蘭縣蘇澳"),
    "小琉球": (22.3428, 120.3706, "屏東縣小琉球"),
    "綠島": (22.6597, 121.4870, "台東縣綠島"),
    "蘭嶼": (22.0400, 121.5580, "台東縣蘭嶼"),
}
# 英文也吃
TW_PLACES.update({
    "taipei": TW_PLACES["台北"], "new taipei": TW_PLACES["新北"], "keelung": TW_PLACES["基隆"],
    "taoyuan": TW_PLACES["桃園"], "hsinchu": TW_PLACES["新竹"], "miaoli": TW_PLACES["苗栗"],
    "taichung": TW_PLACES["台中"], "changhua": TW_PLACES["彰化"], "nantou": TW_PLACES["南投"],
    "yunlin": TW_PLACES["雲林"], "chiayi": TW_PLACES["嘉義"], "tainan": TW_PLACES["台南"],
    "kaohsiung": TW_PLACES["高雄"], "pingtung": TW_PLACES["屏東"], "yilan": TW_PLACES["宜蘭"],
    "hualien": TW_PLACES["花蓮"], "taitung": TW_PLACES["台東"], "penghu": TW_PLACES["澎湖"],
    "kinmen": TW_PLACES["金門"], "matsu": TW_PLACES["馬祖"],
})

_SUFFIXES = ("市", "縣", "區", "鎮", "鄉", "村", "city", "county")


def _tw_lookup(city: str) -> tuple[float, float, str] | None:
    """台灣的地名先自己查：臺＝台，市／縣／區可有可無。"""
    key = city.strip().replace("臺", "台").lower()
    if key in TW_PLACES:
        return TW_PLACES[key]
    for suf in _SUFFIXES:
        if key.endswith(suf) and key[: -len(suf)].strip() in TW_PLACES:
            return TW_PLACES[key[: -len(suf)].strip()]
    return None


def geocode(city: str) -> tuple[float, float, str] | None:
    """城市名 → (lat, lon, 顯示名)。台灣的地名先查自己的表（Open-Meteo 中文索引對台灣很差，會查到大陸同名的地方），其他地方問 Open-Meteo，中文查不到再用英文。"""
    city = city.strip()
    if not city:
        return None
    if city in _geo_cache:
        return _geo_cache[city]
    out = _tw_lookup(city)
    if out is None:
        for lang in ("zh", "en"):
            try:
                r = httpx.get("https://geocoding-api.open-meteo.com/v1/search", params={"name": city, "count": 1, "language": lang}, timeout=8.0)
                res = (r.json() or {}).get("results") or []
            except Exception as e:  # noqa: BLE001
                logger.warning("geocode failed for %s (%s): %s", city, lang, e)
                res = []
            if res:
                out = (res[0]["latitude"], res[0]["longitude"], res[0].get("name", city))
                break
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
