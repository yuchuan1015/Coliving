"""隔離排程測試：真實資料表，webhook 以測試回應替換。"""
import unittest
from datetime import datetime, timedelta, timezone
from types import SimpleNamespace
from unittest.mock import patch
from uuid import UUID

from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

import models
from database import Base
from models.agent import Agent
from models.schedule import Schedule, WakeEvent
from models.user import User
from services import time_service
import wake_scheduler


class WakeSchedulerTest(unittest.TestCase):
    def setUp(self):
        engine = create_engine("sqlite://", poolclass=StaticPool)
        self.addCleanup(engine.dispose)
        Base.metadata.create_all(engine)
        self.sessions = sessionmaker(bind=engine)
        self.db = self.sessions()
        self.addCleanup(self.db.close)
        self.now = datetime(2026, 9, 10, 12, 0, tzinfo=timezone.utc)
        self.user = User(username="scheduler", display_name="test", hashed_password="unused", timezone="Asia/Taipei")
        self.db.add(self.user)
        self.db.flush()
        self.agent = Agent(user_id=self.user.id, name="test", persona="test", llm_provider="claude", llm_model="test", encrypted_api_key="")
        self.db.add(self.agent)
        self.db.flush()
        self.schedule = Schedule(agent_id=self.agent.id, name="test wake", cron_expr="* * * * *", message="test",
                                 callback_url="https://callback.example.test/wake", created_at=self.now - timedelta(minutes=2),
                                 next_run=self.now - timedelta(minutes=1))
        self.db.add(self.schedule)
        self.db.commit()
        self.addCleanup(patch.stopall)
        patch.object(wake_scheduler, "SessionLocal", self.sessions).start()
        patch.object(wake_scheduler.time_service, "now_utc", return_value=self.now).start()
        patch.object(wake_scheduler.bed_service, "set_bed").start()
        self.post = patch.object(wake_scheduler.httpx, "post", return_value=SimpleNamespace(status_code=200)).start()

    def test_webhook_receives_the_persisted_event_id_and_same_tick_does_not_repeat(self):
        wake_scheduler.run()
        event_id = self.post.call_args.kwargs["json"]["event_id"]
        self.assertEqual(str(UUID(event_id)), event_id)
        event = self.db.get(WakeEvent, event_id)
        self.assertIsNotNone(event)
        self.assertEqual(event.status, "delivered")
        self.db.refresh(self.schedule)
        self.assertEqual(time_service.aware(self.schedule.last_run), self.now)
        self.assertGreater(time_service.aware(self.schedule.next_run), self.now)
        wake_scheduler.run()
        self.assertEqual(self.post.call_count, 1)

    def test_inactive_or_missing_owner_never_creates_or_delivers_an_event(self):
        self.user.is_active = False
        self.db.add(Schedule(agent_id="missing-agent", name="orphan", cron_expr="* * * * *", message="test",
                             callback_url="https://callback.example.test/orphan", created_at=self.schedule.created_at))
        self.db.commit()
        wake_scheduler.run()
        self.post.assert_not_called()
        self.assertEqual(self.db.query(WakeEvent).count(), 0)
        self.db.refresh(self.schedule)
        self.assertIsNone(self.schedule.last_run)
        self.assertTrue(self.schedule.enabled)

    def test_failed_webhook_keeps_the_same_event_pending(self):
        self.post.return_value.status_code = 503
        wake_scheduler.run()
        event_id = self.post.call_args.kwargs["json"]["event_id"]
        event = self.db.get(WakeEvent, event_id)
        self.assertIsNotNone(event)
        self.assertEqual(event.status, "pending")
        self.assertIsNone(event.delivered_at)
