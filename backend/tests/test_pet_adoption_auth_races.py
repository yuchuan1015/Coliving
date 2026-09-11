"""Ordinary adoption must retain its authenticated identity across capacity locks.

Real REST/MCP authentication and file-backed SQLite are used. A separate
transaction changes the identity immediately before the real capacity lock;
only that scheduling boundary is patched. No production data or network calls.
"""
from datetime import datetime, timezone
import unittest
from unittest.mock import patch

from models.activity_log import ActivityLog
from models.agent import Agent
from models.mcp_token import McpToken
from models.pet import Pet
from models.user import User
from services import pet_capacity
from tests import test_pet_wish_boundaries as boundary_fixture


class PetAdoptionAuthRaceTest(unittest.TestCase):
    def setUp(self):
        # Compose the existing fixture without importing its TestCase class into
        # this module, which would make unittest discover that suite twice.
        self.fixture = boundary_fixture.PetWishBoundaryTest(methodName="runTest")
        self.addCleanup(self.fixture.doCleanups)
        self.fixture.setUp()

    def race_before_lock(self, mutate, request):
        original = pet_capacity.lock_agent
        lock_calls = []

        def changed_before_lock(db, agent_id):
            lock_calls.append(agent_id)
            with self.fixture.sessions() as other:
                mutate(other)
                other.commit()
            return original(db, agent_id)

        with patch.object(pet_capacity, "lock_agent", side_effect=changed_before_lock):
            result = request()
        self.assertEqual(lock_calls, [self.fixture.agents[0].id])
        return result

    def assert_no_adoption(self):
        with self.fixture.sessions() as db:
            self.assertEqual(db.query(Pet).count(), 0)
            self.assertEqual(db.query(ActivityLog).count(), 0)

    def test_rest_rebound_agent_is_rejected_without_pet_or_activity(self):
        f = self.fixture
        agent_id = f.agents[0].id
        replacement_id = f.new_user("rest-race-replacement").id

        def rebind(db):
            db.get(Agent, agent_id).user_id = replacement_id

        response = self.race_before_lock(rebind, f.ordinary_adopt)
        self.assertEqual(response.status_code, 400, response.text)
        self.assert_no_adoption()
        with f.sessions() as db:
            self.assertEqual(db.get(Agent, agent_id).user_id, replacement_id)

    def test_rest_revoked_login_is_rejected_and_created_pet_is_rolled_back(self):
        f = self.fixture
        user_id = f.users[0].id
        version = f.users[0].auth_version

        def revoke(db):
            db.get(User, user_id).auth_version = version + 1

        response = self.race_before_lock(revoke, f.ordinary_adopt)
        self.assertEqual(response.status_code, 401, response.text)
        self.assert_no_adoption()
        with f.sessions() as db:
            self.assertEqual(db.get(User, user_id).auth_version, version + 1)

    def test_mcp_rebound_agent_is_rejected_without_pet_or_activity(self):
        f = self.fixture
        agent_id = f.agents[0].id
        replacement_id = f.new_user("mcp-race-replacement").id

        def rebind(db):
            db.get(Agent, agent_id).user_id = replacement_id

        response = self.race_before_lock(rebind, lambda: f.mcp(
            "adopt", name="MCP binding race", asset_key=boundary_fixture.ASSET_KEY))
        self.assertFalse(response["success"], response)
        self.assertNotIn("pet", response)
        self.assert_no_adoption()
        with f.sessions() as db:
            self.assertEqual(db.get(Agent, agent_id).user_id, replacement_id)

    def test_mcp_revoked_key_is_rejected_and_created_pet_is_rolled_back(self):
        f = self.fixture
        with f.sessions() as db:
            key = db.query(McpToken).filter_by(agent_id=f.agents[0].id).one()
            self.assertIsNone(key.revoked_at)
            key_id = key.id

        def revoke(db):
            db.get(McpToken, key_id).revoked_at = datetime.now(timezone.utc)

        response = self.race_before_lock(revoke, lambda: f.mcp(
            "adopt", name="MCP key race", asset_key=boundary_fixture.ASSET_KEY))
        self.assertFalse(response["success"], response)
        self.assertNotIn("pet", response)
        self.assert_no_adoption()
        with f.sessions() as db:
            self.assertIsNotNone(db.get(McpToken, key_id).revoked_at)
