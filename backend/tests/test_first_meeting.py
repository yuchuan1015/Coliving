"""剛領養的室友第一句話不該被擋；但「本來有記憶、現在讀不到」還是要擋。
跑法：cd backend && DATABASE_URL=sqlite:////tmp/fm.db .venv/bin/python -m unittest tests.test_first_meeting
"""
import os
import tempfile
import unittest

os.environ.setdefault("DATABASE_URL", f"sqlite:///{tempfile.mkdtemp()}/fm.db")

from database import Base, SessionLocal, engine  # noqa: E402
import models  # noqa: E402,F401
from models.agent import Agent  # noqa: E402
from models.conversation import Conversation  # noqa: E402
from models.message import Message  # noqa: E402
from models.user import User  # noqa: E402
from services import memory_service  # noqa: E402


def _pair(db, tag, **agent_kw):
    u = User(username=f"fm_{tag}_{os.urandom(2).hex()}", display_name=tag, hashed_password="x", birth_year=1990)
    db.add(u)
    db.flush()
    a = Agent(user_id=u.id, name=f"fm_{tag}_{os.urandom(2).hex()}", persona="我是誰", llm_provider="claude",
              llm_model="m", encrypted_api_key="", **agent_kw)
    db.add(a)
    db.commit()
    return u, a


class FirstMeetingTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        Base.metadata.create_all(bind=engine)

    def test_brand_new_agent_can_speak(self):
        db = SessionLocal()
        u, a = _pair(db, "new")
        ctx = memory_service.require_context(db, a, query="嗨")
        self.assertTrue(ctx["first_meeting"])
        self.assertIn("第一次見面", ctx["text"])
        prompt = memory_service.system_prompt_with_memory(a, ctx)
        self.assertIn("我是誰", prompt)          # 人設還在
        self.assertIn("第一次見面", prompt)
        db.close()

    def test_agent_that_has_spoken_is_still_blocked(self):
        db = SessionLocal()
        u, a = _pair(db, "old")
        conv = Conversation(agent_id=a.id, user_id=u.id)
        db.add(conv)
        db.flush()
        db.add(Message(conversation_id=conv.id, role="user", content="以前講過話"))
        db.commit()
        self.assertTrue(memory_service.has_lived(db, a))
        with self.assertRaises(memory_service.MemoryEmpty):
            memory_service.require_context(db, a, query="嗨")
        db.close()

    def test_external_memory_down_is_blocked_even_when_new(self):
        db = SessionLocal()
        u, a = _pair(db, "ext")
        a.external_mcps = '[{"name": "ob", "url": "https://example.invalid/mcp", "token": "x"}]'
        a.memory_mcp = "ob"
        db.commit()

        class Dead:
            def __init__(self, *args, **kwargs):
                pass

            def call(self, *args, **kwargs):
                raise RuntimeError("連不上")

        with self.assertRaises(memory_service.MemoryEmpty) as cm:
            memory_service.require_context(db, a, query="嗨", client_factory=Dead, force=True)
        self.assertIn("記憶庫連不上", str(cm.exception))
        db.close()

    def test_note_alone_still_counts_as_memory(self):
        db = SessionLocal()
        u, a = _pair(db, "note")
        u.note_to_agent = "我是喻墨"
        db.commit()
        ctx = memory_service.require_context(db, a, query="嗨")
        self.assertFalse(ctx.get("first_meeting", False))
        self.assertIn("我是喻墨", ctx["text"])
        db.close()


if __name__ == "__main__":
    unittest.main()
