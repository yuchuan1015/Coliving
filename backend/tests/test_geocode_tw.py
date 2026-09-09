"""所在城市：台灣地名要查到台灣（Open-Meteo 中文索引會給大陸同名的地方）。純本地表，不打網路。
跑法：cd backend && .venv/bin/python -m unittest tests.test_geocode_tw
"""
import os
import tempfile
import unittest

os.environ.setdefault("DATABASE_URL", f"sqlite:///{tempfile.mkdtemp()}/geo.db")

from services import weather_service as w  # noqa: E402

# 台灣本島與離島的經緯度範圍
TW_LAT = (21.5, 26.5)
TW_LON = (118.0, 122.2)


class GeocodeTWTest(unittest.TestCase):
    def test_taiwan_places_resolve_inside_taiwan(self):
        for name in ["台北", "臺北", "台北市", "臺北市", "Taipei", "taipei",
                     "新北", "板橋", "高雄", "高雄市", "台中", "臺中市", "台南", "桃園",
                     "新竹", "基隆", "宜蘭", "花蓮", "台東", "嘉義", "彰化", "南投",
                     "雲林", "屏東", "苗栗", "澎湖", "金門", "馬祖", "墾丁", "小琉球"]:
            g = w._tw_lookup(name)
            self.assertIsNotNone(g, f"{name} 查不到")
            lat, lon, label = g
            self.assertTrue(TW_LAT[0] <= lat <= TW_LAT[1], f"{name} 緯度跑出台灣：{lat}")
            self.assertTrue(TW_LON[0] <= lon <= TW_LON[1], f"{name} 經度跑出台灣：{lon}")
            self.assertTrue(label)

    def test_key_cities_are_the_right_city(self):
        # 之前的 bug：高雄查到四川（31.37, 105.37）、新北查到江蘇（34.09, 120.12）
        for name, lat, lon in [("高雄", 22.63, 120.30), ("新北", 25.02, 121.46), ("台北", 25.03, 121.57)]:
            g = w._tw_lookup(name)
            self.assertAlmostEqual(g[0], lat, delta=0.15, msg=name)
            self.assertAlmostEqual(g[1], lon, delta=0.15, msg=name)

    def test_geocode_uses_table_without_network(self):
        called = []

        def boom(*a, **k):
            called.append(1)
            raise AssertionError("台灣的地名不該打 API")

        orig = w.httpx.get
        w.httpx.get = boom
        try:
            w._geo_cache.clear()
            g = w.geocode("花蓮")
            self.assertEqual(g[2], "花蓮市")
            self.assertEqual(called, [])
        finally:
            w.httpx.get = orig
            w._geo_cache.clear()

    def test_unknown_place_falls_through(self):
        self.assertIsNone(w._tw_lookup("東京"))
        self.assertIsNone(w._tw_lookup(""))


if __name__ == "__main__":
    unittest.main()
