"""Public credit is issued by successful garden transactions, never human actions."""
from datetime import timedelta
import json
from unittest.mock import patch

from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy import func, select, update

from models.agent import Agent
from models.credit_log import CreditLog
from models.garden_credit import GardenCreditDay, GardenCreditSlot, GardenCreditVote
from models.pet import Pet
from models.post import Post
from routers import credit, posts
from services import auth_service, bed_service, garden_service as G, pet_service
from tests.test_garden_acceptance import GardenServiceFixture
from utils.deps import get_db


class GardenCreditIntegrationTest(GardenServiceFixture):
    def credits(self, actor=None):
        with self.sessions() as db:
            return db.scalar(select(Agent.credit_total).where(Agent.id == (actor or self.agent).id))

    def rows(self, model):
        with self.sessions() as db:
            return db.scalar(select(func.count()).select_from(model))

    def public_round(self):
        return G.get_public(self.db, self.user)["plots"][0]

    def start_public(self):
        public = self.public_round()
        outcome = self.do(self.user, "vote", plot_id=public["id"],
                          vote_id=public["vote"]["id"], crop_id="water_spinach")
        self.assertEqual(outcome["credit_awarded"], 0)
        self.now += timedelta(hours=12)
        G.tick_all(self.db)
        public = self.public_round()
        return public["id"], public["planting"]["planting_id"]

    def rest_client(self):
        app = FastAPI()
        app.include_router(posts.router)
        app.include_router(credit.router)
        def isolated_db():
            with self.sessions() as db:
                yield db
        app.dependency_overrides[get_db] = isolated_db
        owner = self.households[0][0]
        token = auth_service.create_access_token(owner.id, owner.username, owner.role,
                                                 auth_version=owner.auth_version)
        client = TestClient(app, headers={"Authorization": f"Bearer {token}"})
        self.addCleanup(client.close)
        return client

    def test_human_public_actions_do_not_award_or_consume_agent_credit_entitlements(self):
        public = self.public_round()
        human_vote = self.do(self.user, "vote", plot_id=public["id"],
                             vote_id=public["vote"]["id"], crop_id="water_spinach")
        self.assertEqual(human_vote["credit_awarded"], 0)
        self.assertEqual(self.credits(), 0)
        self.assertEqual(self.rows(GardenCreditVote), 0)
        agent_vote = self.do(self.agent, "vote", plot_id=public["id"],
                             vote_id=public["vote"]["id"], crop_id="water_spinach")
        self.assertEqual(agent_vote["credit_awarded"], 1)
        self.now += timedelta(hours=12)
        G.tick_all(self.db)
        planting = self.public_round()["planting"]
        for action in ("water", "care", "water"):
            outcome = self.do(self.user, action, plot_id=public["id"], planting_id=planting["planting_id"])
            self.assertEqual(outcome["credit_awarded"], 0)
        self.assertEqual(self.credits(), 1)
        self.assertEqual(self.rows(GardenCreditSlot), 0)
        self.assertEqual(self.rows(GardenCreditDay), 0)
        agent_care = self.do(self.agent, "care", plot_id=public["id"], planting_id=planting["planting_id"])
        self.assertEqual(agent_care["credit_awarded"], 20)
        self.assertEqual(self.credits(), 21)
        self.assertEqual(self.credits(self.other_agent), 0)

    def test_failed_stale_action_same_slot_and_request_replay_cannot_duplicate_credit(self):
        plot_id, planting_id = self.start_public()
        stale = self.assert_rejected(self.agent, "care", plot_id=plot_id, planting_id="old-planting")
        self.assertEqual(stale.code, "stale_planting")
        self.assertEqual(self.credits(), 0)
        self.assertEqual(self.rows(GardenCreditSlot), 0)
        request_id = self.request_id("original-awarded-care")
        first = self.do(self.agent, "care", plot_id=plot_id, planting_id=planting_id, request_id=request_id)
        self.assertEqual(first["credit_awarded"], 20)
        water = self.do(self.agent, "water", plot_id=plot_id, planting_id=planting_id)
        self.assertEqual(water["credit_awarded"], 0)
        replay = self.do(self.agent, "care", plot_id=plot_id, planting_id=planting_id, request_id=request_id)
        self.assertEqual(replay, first)  # replay preserves original result, including the 20
        self.assertEqual(self.credits(), 20)
        self.assertEqual(self.rows(GardenCreditSlot), 1)
        self.assertEqual(self.rows(CreditLog), 1)

    def test_private_plant_care_and_human_water_leave_public_bonus_available(self):
        planting = self.plant("water_spinach")
        care = self.do(self.agent, "care", planting_id=planting["planting_id"])
        water = self.do(self.user, "water", planting_id=planting["planting_id"])
        self.assertEqual(care["credit_awarded"], 0)
        self.assertEqual(water["credit_awarded"], 0)
        self.assertEqual(self.credits(), 0)
        self.assertEqual(self.rows(GardenCreditDay), 0)
        plot_id, planting_id = self.start_public()
        public = self.do(self.agent, "care", plot_id=plot_id, planting_id=planting_id)
        self.assertEqual(public["credit_awarded"], 20)
        self.assertEqual(self.credits(), 20)

    def test_garden_credit_summary_and_existing_500_point_pet_threshold(self):
        self.db.execute(update(Agent).where(Agent.id == self.agent.id).values(credit_total=480))
        self.db.commit()
        agent = self.db.get(Agent, self.agent.id, populate_existing=True)
        self.assertEqual(pet_service.get_max_pets(agent), 0)
        self.assertIsInstance(pet_service.adopt(self.db, agent, "before", "cat", "🐈"), str)
        self.db.rollback()
        plot_id, planting_id = self.start_public()
        outcome = self.do(self.agent, "care", plot_id=plot_id, planting_id=planting_id)
        self.assertEqual(outcome["credit_awarded"], 20)
        summary = self.rest_client().get("/api/credit/summary")
        self.assertEqual(summary.status_code, 200, summary.text)
        self.assertEqual(summary.json()["credit_total"], 500)
        self.assertIn("pet_1", summary.json()["unlocked"])
        agent = self.db.get(Agent, self.agent.id, populate_existing=True)
        self.assertEqual(pet_service.get_max_pets(agent), 1)
        adopted = pet_service.adopt(self.db, agent, "after", "cat", "🐈")
        self.assertIsInstance(adopted, Pet)
        self.db.commit()
        self.assertEqual(self.credits(), 500)

    def test_human_rest_post_never_awards_household_agent_but_agent_mcp_post_still_does(self):
        client = self.rest_client()
        for anonymous in (False, True):
            response = client.post("/api/posts", json={"content": "isolated human post", "is_anonymous": anonymous})
            self.assertEqual(response.status_code, 201, response.text)
        self.assertEqual(self.credits(), 0)
        self.assertEqual(self.rows(CreditLog), 0)
        with self.sessions() as db:
            self.assertTrue(all(not post.posted_by_agent for post in db.scalars(select(Post))))
        import mcp_server as M
        owner, agent = self.households[0]
        key = bed_service.issue_key(self.db, owner.id, agent.id)
        self.db.commit()
        token = bed_service.token_string(key, owner.username)
        with patch.object(M, "SessionLocal", self.sessions):
            result = json.loads(M.post_message(token, "isolated Agent post"))
        self.assertTrue(result["success"], result)
        self.assertEqual(self.credits(), 1)
        with self.sessions() as db:
            entry = db.get(Post, result["post_id"])
            self.assertTrue(entry.posted_by_agent)
            log = db.scalar(select(CreditLog))
            self.assertEqual((log.agent_id, log.action, log.amount), (self.agent.id, "post", 1))
