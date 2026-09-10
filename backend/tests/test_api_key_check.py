"""金鑰檢查：前後空白要剪掉、分得出「供應商說不對」和「連不上供應商」。
2026-09-10：她回報金鑰存不進去，查出來從網頁複製多帶一個換行就會直接爆掉，而且只說「驗證失敗」。
跑法：cd backend && DATABASE_URL=sqlite:////tmp/ak.db .venv/bin/python -m unittest tests.test_api_key_check
"""
import os
import tempfile
import unittest

os.environ.setdefault("DATABASE_URL", f"sqlite:///{tempfile.mkdtemp()}/ak.db")

import httpx  # noqa: E402

from services import llm_service  # noqa: E402


class _Resp:
    def __init__(self, code):
        self.status_code = code
        self.text = "{}"

    def json(self):
        return {}


class ApiKeyCheckTest(unittest.TestCase):
    def setUp(self):
        self.seen = {}
        self._get, self._post = llm_service.httpx.get, llm_service.httpx.post

    def tearDown(self):
        llm_service.httpx.get, llm_service.httpx.post = self._get, self._post

    def _fake(self, code=200, boom=None):
        def f(url, **kw):
            if boom:
                raise boom
            self.seen["headers"] = kw.get("headers") or {}
            self.seen["url"] = url
            return _Resp(code)
        llm_service.httpx.get = f
        llm_service.httpx.post = f

    def test_whitespace_is_trimmed(self):
        self._fake(200)
        for messy in ["sk-ant-abc\n", " sk-ant-abc", "sk-ant-abc  ", "\tsk-ant-abc\r\n"]:
            ok, why = llm_service.check_api_key("claude", messy)
            self.assertTrue(ok, f"{messy!r} → {why}")
            self.assertEqual(self.seen["headers"]["x-api-key"], "sk-ant-abc")

    def test_provider_says_invalid(self):
        self._fake(401)
        ok, why = llm_service.check_api_key("claude", "sk-ant-bad")
        self.assertFalse(ok)
        self.assertIn("Anthropic", why)
        self.assertIn("無效", why)

    def test_cannot_reach_provider_is_a_different_message(self):
        self._fake(boom=httpx.ConnectError("no route"))
        ok, why = llm_service.check_api_key("claude", "sk-ant-abc")
        self.assertFalse(ok)
        self.assertIn("連不上", why)
        self.assertNotIn("無效", why)      # 不要把網路問題說成金鑰錯

    def test_empty_key(self):
        ok, why = llm_service.check_api_key("claude", "   ")
        self.assertFalse(ok)
        self.assertIn("空的", why)

    def test_unknown_provider(self):
        ok, why = llm_service.check_api_key("nobody", "x")
        self.assertFalse(ok)
        self.assertIn("不支援", why)

    def test_other_status_code(self):
        self._fake(500)
        ok, why = llm_service.check_api_key("openai", "sk-x")
        self.assertFalse(ok)
        self.assertIn("500", why)

    def test_non_ascii_key_gets_a_human_message(self):
        ok, why = llm_service.check_api_key("claude", "sk-ant-這是假的")
        self.assertFalse(ok)
        self.assertIn("不是金鑰", why)
        self.assertNotIn("codec", why)      # 不要把技術訊息丟給住戶

    def test_weird_error_is_wrapped(self):
        def boom(*a, **k):
            raise UnicodeEncodeError("ascii", "x", 0, 1, "bad")
        llm_service.httpx.get = boom
        llm_service.httpx.post = boom
        ok, why = llm_service.check_api_key("claude", "sk-ant-abc")
        self.assertFalse(ok)
        self.assertIn("不像金鑰", why)

    def test_old_wrapper_still_works(self):
        self._fake(200)
        self.assertTrue(llm_service.validate_api_key("claude", "sk-ant-abc"))
        self._fake(401)
        self.assertFalse(llm_service.validate_api_key("claude", "sk-ant-abc"))


if __name__ == "__main__":
    unittest.main()
