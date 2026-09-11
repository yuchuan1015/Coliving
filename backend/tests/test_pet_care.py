"""Pet state settlement and care preserve concurrent requests and transaction ownership."""
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timedelta, timezone
import threading
import unittest
from unittest.mock import patch

from models.activity_log import ActivityLog
from models.mail import Mail
from models.pet import Pet
from models.agent import Agent
from services import pet_service
from tests import test_pet_entitlement as fixture

NOW = datetime(2026, 9, 12, 1, 0, tzinfo=timezone.utc)


class PetCareTest(unittest.TestCase):
    setUp = fixture.PetEntitlementTest.setUp

    def make_pet(self, **values):
        params = dict(agent_id=self.agents[0].id, name="fixture-care", species="cat", emoji="🐈",
                      born_at=NOW - timedelta(days=1), last_tick_at=NOW,
                      lifespan_days=150, hunger=20, cleanliness=60, happiness=40, health=40)
        params.update(values)
        pet = Pet(**params)
        self.db.add(pet)
        self.db.commit()
        return pet.id

    def clock(self):
        mocked = self.enterContext(patch.object(pet_service, "datetime"))
        mocked.now.return_value = NOW

    def parallel(self, pet_id, callback):
        ready = threading.Barrier(2)
        def work():
            with self.sessions() as db:
                agent = db.get(Agent, self.agents[0].id)
                pet = db.get(Pet, pet_id)
                ready.wait(timeout=10)  # both requests have the same old snapshot
                result = callback(db, agent, pet)
                db.commit()
                return result
        with ThreadPoolExecutor(max_workers=2) as executor:
            futures = [executor.submit(work) for _ in range(2)]
            return [f.result(timeout=15) for f in futures]

    def test_concurrent_feeds_keep_both_updates(self):
        pet_id = self.make_pet()
        self.clock()
        results = self.parallel(pet_id, lambda db, agent, pet: pet_service.interact(db, agent, pet, "feed"))
        self.assertEqual(sorted(r["hunger"] for r in results), [60, 100])
        self.db.expire_all()
        self.assertEqual(self.db.get(Pet, pet_id).hunger, 100)
        self.assertEqual(self.db.query(ActivityLog).filter_by(action="pet_interact").count(), 2)

    def test_concurrent_status_reads_settle_events_only_once(self):
        pet_id = self.make_pet(last_tick_at=NOW - timedelta(hours=1))
        self.clock()
        self.enterContext(patch.object(pet_service._rng, "random", return_value=0))
        self.enterContext(patch.object(pet_service._rng, "choice", return_value=pet_service.RANDOM_EVENTS[0]))
        results = self.parallel(pet_id, lambda db, agent, pet: pet_service.get_pet_status(db, pet))
        self.assertEqual(sorted(len(r["events"]) for r in results), [0, 1])
        self.assertEqual(self.db.query(ActivityLog).filter_by(action="pet_event").count(), 1)
        self.assertEqual(self.db.query(Mail).count(), 1)
        self.db.expire_all()
        self.assertEqual(self.db.get(Pet, pet_id).happiness, 48.5)

    def test_death_during_rest_interaction_is_committed_once(self):
        pet_id = self.make_pet(last_tick_at=NOW-timedelta(days=10))
        self.clock()
        first = self.client.post(f"/api/pets/{pet_id}/interact?action=feed")
        self.assertEqual(first.status_code, 400, first.text)
        self.db.expire_all()
        self.assertFalse(self.db.get(Pet, pet_id).is_alive)
        self.assertEqual(self.db.query(Mail).count(), 1)
        second = self.client.post(f"/api/pets/{pet_id}/interact?action=feed")
        self.assertEqual(second.status_code, 400, second.text)
        self.assertEqual(self.db.query(Mail).count(), 1)
        self.assertEqual(self.db.query(ActivityLog).filter_by(action="pet_death").count(), 1)
        self.assertEqual(self.db.query(ActivityLog).filter_by(action="pet_interact").count(), 0)

    def test_successful_care_returns_events_from_its_single_tick(self):
        pet_id = self.make_pet(last_tick_at=NOW-timedelta(hours=1))
        self.clock()
        self.enterContext(patch.object(pet_service._rng, "random", return_value=0))
        self.enterContext(patch.object(pet_service._rng, "choice", return_value=pet_service.RANDOM_EVENTS[0]))
        response = self.client.post(f"/api/pets/{pet_id}/interact?action=feed")
        self.assertEqual(response.status_code, 200, response.text)
        self.assertEqual(len(response.json()["events"]), 1)
        self.assertEqual(response.json()["hunger"], 58)
        self.assertEqual(self.db.query(Mail).count(), 1)

    def test_invalid_action_or_foreign_owner_cannot_settle_or_care(self):
        pet_id = self.make_pet(last_tick_at=NOW-timedelta(hours=1))
        self.clock()
        pet = self.db.get(Pet, pet_id)
        self.assertIsInstance(pet_service.interact(self.db, self.agents[0], pet, "invalid"), str)
        self.assertIsInstance(pet_service.interact(self.db, self.agents[1], pet, "feed"), str)
        self.db.commit()
        self.assertEqual(pet.hunger, 20)
        self.assertEqual(self.db.query(ActivityLog).count(), 0)

    def test_service_still_leaves_care_and_event_commit_to_caller(self):
        pet_id = self.make_pet()
        self.clock()
        pet_service.interact(self.db, self.agents[0], self.db.get(Pet, pet_id), "feed")
        self.db.rollback()
        self.db.expire_all()
        self.assertEqual(self.db.get(Pet, pet_id).hunger, 20)
        self.assertEqual(self.db.query(ActivityLog).count(), 0)

    def test_blank_or_oversized_adoption_text_does_not_create_pet(self):
        self.agents[0].credit_total = 500
        self.db.commit()
        for name, species, emoji in [("", "cat", "🐈"), ("  ", "cat", "🐈"),
                                      ("x"*65, "cat", "🐈"), ("valid", "\t", "🐈"),
                                      ("valid", "cat", "x"*9)]:
            with self.subTest(name=name, species=species, emoji=emoji):
                self.assertIsInstance(pet_service.adopt(self.db, self.agents[0], name, species, emoji), str)
        self.db.commit()
        self.assertEqual(self.db.query(Pet).count(), 0)
        self.assertEqual(self.db.query(ActivityLog).count(), 0)

    def test_status_read_can_return_newly_deceased_pet_then_next_list_omits_it(self):
        self.make_pet(last_tick_at=NOW-timedelta(days=10))
        self.clock()
        first = self.client.get('/api/pets')
        self.assertEqual(first.status_code, 200)
        self.assertEqual(len(first.json()['pets']), 1)
        self.assertFalse(first.json()['pets'][0]['is_alive'])
        self.assertEqual(self.client.get('/api/pets').json()['pets'], [])
