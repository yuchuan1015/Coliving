"""用量記錄：每次呼叫都存、工具迴圈算多次、沒回報存 NULL 不算 0、單價未知就不估費用、三個數字分開。
跑法：cd backend && DATABASE_URL=sqlite:////tmp/us.db .venv/bin/python -m unittest tests.test_usage
"""
import os
import tempfile
import unittest

os.environ.setdefault("DATABASE_URL", f"sqlite:///{tempfile.mkdtemp()}/us.db")

from database import Base, SessionLocal, engine  # noqa: E402
import models  # noqa: E402,F401
from models.agent import Agent  # noqa: E402
from models.usage_log import UsageLog  # noqa: E402
from models.user import User  # noqa: E402
from services import llm_service, usage_service  # noqa: E402


class UsageTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        Base.metadata.create_all(bind=engine)
        db = SessionLocal()
        u = User(username="us_" + os.urandom(2).hex(), display_name="us", hashed_password="x", birth_year=1990)
        db.add(u)
        db.flush()
        a = Agent(user_id=u.id, name="us_" + os.urandom(2).hex(), persona="p", llm_provider="claude",
                  llm_model="claude-sonnet-5", encrypted_api_key="x")
        db.add(a)
        db.commit()
        cls.uid, cls.aid = u.id, a.id
        db.close()

    def _agent(self, db):
        return db.query(Agent).filter_by(id=self.aid).first()

    def test_extract_each_provider(self):
        c = llm_service._extract_usage("claude", {"usage": {"input_tokens": 10, "output_tokens": 2,
                                                            "cache_read_input_tokens": 4, "cache_creation_input_tokens": 1}})
        self.assertEqual((c["input_tokens"], c["output_tokens"], c["cached_input_tokens"]), (10, 2, 5))
        o = llm_service._extract_usage("openai", {"usage": {"prompt_tokens": 7, "completion_tokens": 3,
                                                            "prompt_tokens_details": {"cached_tokens": 2},
                                                            "completion_tokens_details": {"reasoning_tokens": 1}}})
        self.assertEqual((o["input_tokens"], o["output_tokens"], o["cached_input_tokens"], o["reasoning_tokens"]), (7, 3, 2, 1))
        g = llm_service._extract_usage("gemini", {"usageMetadata": {"promptTokenCount": 5, "candidatesTokenCount": 6,
                                                                    "thoughtsTokenCount": 2}})
        self.assertEqual((g["input_tokens"], g["output_tokens"], g["reasoning_tokens"]), (5, 6, 2))
        # 沒回報 → 全 None，不是 0
        n = llm_service._extract_usage("claude", {})
        self.assertIsNone(n["input_tokens"])
        self.assertIsNone(n["output_tokens"])

    def test_collect_catches_every_call(self):
        with llm_service.collect() as calls:
            llm_service._record("claude", "claude-sonnet-5", {"usage": {"input_tokens": 100, "output_tokens": 10}})
            llm_service._record("claude", "claude-sonnet-5", {"usage": {"input_tokens": 200, "output_tokens": 20}})
        self.assertEqual(len(calls), 2)          # 工具迴圈跑兩次就是兩筆
        # 沒有 collect 的時候不會爆
        llm_service._record("claude", "x", {"usage": {"input_tokens": 1, "output_tokens": 1}})

    def test_record_and_cost(self):
        db = SessionLocal()
        a = self._agent(db)
        rows = usage_service.record(db, a, [
            {"provider": "claude", "model": "claude-sonnet-5", "input_tokens": 10_000, "output_tokens": 1_000,
             "cached_input_tokens": None, "reasoning_tokens": None},
        ], purpose="chat", conversation_id="conv-1")
        db.commit()
        self.assertEqual(len(rows), 1)
        # 調研文件的例子：10000 輸入 + 1000 輸出，Sonnet 5 → 0.03 美元
        self.assertAlmostEqual(rows[0].cost_usd, 0.03, places=6)
        self.assertEqual(rows[0].price_input, 2.00)
        db.close()

    def test_unknown_model_has_no_cost(self):
        db = SessionLocal()
        a = self._agent(db)
        rows = usage_service.record(db, a, [
            {"provider": "xai", "model": "grok-nobody-knows", "input_tokens": 500, "output_tokens": 50,
             "cached_input_tokens": None, "reasoning_tokens": None},
        ], conversation_id="conv-1")
        db.commit()
        self.assertIsNone(rows[0].cost_usd)      # 不知道單價就不亂估
        self.assertIsNone(rows[0].price_input)
        db.close()

    def test_missing_usage_is_null_not_zero(self):
        db = SessionLocal()
        a = self._agent(db)
        rows = usage_service.record(db, a, [
            {"provider": "claude", "model": "claude-sonnet-5", "input_tokens": None, "output_tokens": None,
             "cached_input_tokens": None, "reasoning_tokens": None},
        ], conversation_id="conv-1")
        db.commit()
        self.assertIsNone(rows[0].input_tokens)
        self.assertIsNone(rows[0].cost_usd)
        s = usage_service.summary(db, a, conversation_id="conv-1")
        self.assertGreaterEqual(s["conversation_total"]["missing_usage"], 1)
        self.assertTrue(s["conversation_total"]["cost_partial"])   # 有筆沒單價／沒用量
        db.close()

    def test_summary_separates_three_numbers(self):
        db = SessionLocal()
        a = self._agent(db)
        usage_service.record(db, a, [   # 自己準備資料，不靠別的測試先跑
            {"provider": "claude", "model": "claude-sonnet-5", "input_tokens": 1_000, "output_tokens": 100,
             "cached_input_tokens": None, "reasoning_tokens": None},
            {"provider": "claude", "model": "claude-sonnet-5", "input_tokens": 1_500, "output_tokens": 300,
             "cached_input_tokens": None, "reasoning_tokens": None},
        ], conversation_id="conv-1")
        db.commit()
        s = usage_service.summary(db, a, conversation_id="conv-1")
        self.assertIn("current_context_tokens", s)
        self.assertIn("this_reply", s)
        self.assertIn("conversation_total", s)
        self.assertIn("this_month", s)
        self.assertEqual(s["prices_as_of"], usage_service.PRICES_AS_OF)
        # 整窗累計要含前面幾筆
        self.assertGreaterEqual(s["conversation_total"]["calls"], 2)
        # 目前上下文＝最後一次的輸入，不是累計
        self.assertEqual(s["current_context_tokens"], 1_500)
        self.assertGreaterEqual(s["agent_total"]["calls"], s["conversation_total"]["calls"])
        db.close()

    def test_deleting_messages_does_not_refund(self):
        """刪訊息不倒扣：帳本跟訊息是分開的。"""
        db = SessionLocal()
        a = self._agent(db)
        before = usage_service.summary(db, a, conversation_id="conv-1")["conversation_total"]["calls"]
        db.query(UsageLog).filter(UsageLog.agent_id == a.id).count()   # 帳本還在
        after = usage_service.summary(db, a, conversation_id="conv-1")["conversation_total"]["calls"]
        self.assertEqual(before, after)
        db.close()

    # ── Codex 2026-09-09 抓到的兩個 bug，照他列的邊界測 ──

    def test_two_quick_replies_do_not_merge(self):
        """兩則連在一起的回覆不能混算（以前用 120 秒的時間窗猜，會把上一則算進來）。"""
        db = SessionLocal()
        a = self._agent(db)
        conv = "conv-quick"
        usage_service.record(db, a, [
            {"provider": "claude", "model": "claude-sonnet-5", "input_tokens": 100, "output_tokens": 10,
             "cached_input_tokens": None, "reasoning_tokens": None}], conversation_id=conv)
        usage_service.record(db, a, [
            {"provider": "claude", "model": "claude-sonnet-5", "input_tokens": 1000, "output_tokens": 100,
             "cached_input_tokens": None, "reasoning_tokens": None}], conversation_id=conv)
        db.commit()
        s = usage_service.summary(db, a, conversation_id=conv)
        self.assertEqual(s["this_reply"]["calls"], 1)
        self.assertEqual(s["this_reply"]["total_tokens"], 1100)
        self.assertEqual(s["conversation_total"]["total_tokens"], 1210)   # 累計照樣是兩則加起來
        self.assertEqual(s["current_context_tokens"], 1000)
        db.close()

    def test_one_reply_with_tool_rounds_sums_all(self):
        """一則回覆跑三輪工具＝三次呼叫，本次回覆要全部加起來，上下文取最後一輪。"""
        db = SessionLocal()
        a = self._agent(db)
        conv = "conv-tools"
        usage_service.record(db, a, [
            {"provider": "claude", "model": "claude-sonnet-5", "input_tokens": 100, "output_tokens": 10,
             "cached_input_tokens": None, "reasoning_tokens": None},
            {"provider": "claude", "model": "claude-sonnet-5", "input_tokens": 300, "output_tokens": 20,
             "cached_input_tokens": None, "reasoning_tokens": None},
            {"provider": "claude", "model": "claude-sonnet-5", "input_tokens": 700, "output_tokens": 30,
             "cached_input_tokens": None, "reasoning_tokens": None},
        ], conversation_id=conv)
        db.commit()
        s = usage_service.summary(db, a, conversation_id=conv)
        self.assertEqual(s["this_reply"]["calls"], 3)
        self.assertEqual(s["this_reply"]["total_tokens"], 1160)
        self.assertEqual(s["current_context_tokens"], 700)      # 最後一輪的輸入
        self.assertFalse(s["this_reply"]["usage_partial"])
        db.close()

    def test_partial_usage_is_flagged(self):
        """只缺輸入、只缺輸出都算沒拿全；總數是已知小計，而且要標不完整。"""
        db = SessionLocal()
        a = self._agent(db)
        conv = "conv-partial"
        usage_service.record(db, a, [
            {"provider": "claude", "model": "claude-sonnet-5", "input_tokens": 100, "output_tokens": None,
             "cached_input_tokens": None, "reasoning_tokens": None},
            {"provider": "claude", "model": "claude-sonnet-5", "input_tokens": None, "output_tokens": 20,
             "cached_input_tokens": None, "reasoning_tokens": None},
        ], conversation_id=conv)
        db.commit()
        t = usage_service.summary(db, a, conversation_id=conv)["conversation_total"]
        self.assertEqual(t["missing_usage"], 2)      # 兩筆各缺一邊，都算缺
        self.assertTrue(t["usage_partial"])
        self.assertEqual(t["total_tokens"], 120)     # 已知小計
        db.close()

    def test_all_missing_versus_real_zero(self):
        """全缺 → total None、missing 1；真的是 0 → total 0、missing 0。這個差別要留著。"""
        db = SessionLocal()
        a = self._agent(db)
        usage_service.record(db, a, [
            {"provider": "claude", "model": "claude-sonnet-5", "input_tokens": None, "output_tokens": None,
             "cached_input_tokens": None, "reasoning_tokens": None}], conversation_id="conv-null")
        usage_service.record(db, a, [
            {"provider": "claude", "model": "claude-sonnet-5", "input_tokens": 0, "output_tokens": 0,
             "cached_input_tokens": None, "reasoning_tokens": None}], conversation_id="conv-zero")
        db.commit()
        n = usage_service.summary(db, a, conversation_id="conv-null")["conversation_total"]
        self.assertIsNone(n["total_tokens"])
        self.assertEqual(n["missing_usage"], 1)
        self.assertTrue(n["usage_partial"])
        z = usage_service.summary(db, a, conversation_id="conv-zero")["conversation_total"]
        self.assertEqual(z["total_tokens"], 0)
        self.assertEqual(z["missing_usage"], 0)
        self.assertFalse(z["usage_partial"])
        db.close()


if __name__ == "__main__":
    unittest.main()
