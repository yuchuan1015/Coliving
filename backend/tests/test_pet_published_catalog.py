"""Exercise the actual v1 release registry with isolated REST accounts and SQLite.

The boundary fixture supplies accounts/database only; its synthetic asset loader
is replaced with the real loader. No image files or production APIs are touched.
"""
import unittest
from unittest.mock import patch

from models.mail import Mail
from models.pet import Pet
from models.pet_wish import PetWish
from services import pet_assets
from tests import test_pet_wish_boundaries as boundary_fixture


V1_IDS = {
    "cat", "dog", "pig", "cow", "sheep", "rabbit", "hamster", "lizard",
    "snake", "fish", "bird", "fox", "raccoon", "horse", "octopus", "raven",
    "owl", "blue-whale", "orca", "jellyfish", "turtle", "wolf", "deer", "bear",
    "butterfly", "goose", "duck", "honeybee",
}


class PetPublishedCatalogTest(unittest.TestCase):
    def setUp(self):
        # Compose rather than inherit/import TestCase, avoiding duplicate suite
        # discovery. The nested patch calls the unmodified registry loader.
        self.fixture = boundary_fixture.PetWishBoundaryTest(methodName="runTest")
        self.addCleanup(self.fixture.doCleanups)
        self.fixture.setUp()
        self.enterContext(patch.object(pet_assets, "get_assets", self.fixture.real_get_assets))

    def test_catalog_exposes_all_28_v1_assets_with_exact_static_paths(self):
        response = self.fixture.request("GET", "/api/pet-assets")
        self.assertEqual(response.status_code, 200, response.text)
        catalog = response.json()
        self.assertEqual(catalog["catalog_version"], "rookery-pets-v1-20260912")
        self.assertEqual(len(catalog["items"]), 28)
        by_key = {item["asset_key"]: item for item in catalog["items"]}
        self.assertEqual(set(by_key), {f"{identifier}-v1" for identifier in V1_IDS})
        for identifier in V1_IDS:
            with self.subTest(identifier=identifier):
                item = by_key[f"{identifier}-v1"]
                self.assertEqual(set(item), {"asset_key", "species", "emoji", "image_url"})
                self.assertEqual(item["image_url"], f"/assets/pets/v1/{identifier}.png")
                self.assertTrue(item["species"].strip())
                self.assertTrue(item["emoji"].strip())
        self.assertEqual(by_key["blue-whale-v1"]["species"], "藍鯨")
        self.assertEqual(by_key["honeybee-v1"]["species"], "蜜蜂")
        self.assertEqual(by_key["raven-v1"]["emoji"], "🐦‍⬛")

    def test_real_blue_whale_key_adopts_and_persists_catalog_identity(self):
        f = self.fixture
        response = f.request("POST", "/api/pets/adopt",
                             json={"name": "測試藍鯨", "asset_key": "blue-whale-v1"})
        self.assertEqual(response.status_code, 201, response.text)
        pet = response.json()
        self.assertEqual((pet["name"], pet["species"], pet["emoji"], pet["asset_key"]),
                         ("測試藍鯨", "藍鯨", "🐋", "blue-whale-v1"))
        with f.sessions() as db:
            stored = db.query(Pet).one()
            self.assertEqual(stored.id, pet["id"])
            self.assertEqual(stored.agent_id, f.agents[0].id)
            self.assertEqual(stored.asset_key, "blue-whale-v1")
            self.assertEqual(db.query(PetWish).count(), 0)
        listing = f.request("GET", "/api/pets")
        self.assertEqual(listing.status_code, 200, listing.text)
        f.capacity(listing.json()["capacity"], active=1, reserved=0)

    def test_real_honeybee_key_fulfills_reserved_wish_once(self):
        f = self.fixture
        payload = f.payload("published-honeybee-wish")
        payload.update(requested_name="測試蜜蜂", requested_species="蜜蜂")
        response = f.request("POST", "/api/pet-wishes", json=payload)
        self.assertEqual(response.status_code, 201, response.text)
        prepared = f.prepare(response.json(), asset_key="honeybee-v1")
        f.capacity(prepared["capacity"], active=0, reserved=1)
        arrived = f.arrive(prepared)
        self.assertEqual(arrived.status_code, 200, arrived.text)
        result = arrived.json()
        self.assertEqual(result["wish"]["status"], "arrived")
        self.assertEqual(result["wish"]["asset_key"], "honeybee-v1")
        f.capacity(result["capacity"], active=1, reserved=0)
        replay = f.arrive(prepared)
        self.assertEqual(replay.status_code, 200, replay.text)
        self.assertEqual(replay.json()["receipt"], result["receipt"])
        with f.sessions() as db:
            pet = db.query(Pet).one()
            self.assertEqual(pet.id, result["wish"]["pet_id"])
            self.assertEqual((pet.name, pet.species, pet.emoji, pet.asset_key),
                             ("測試蜜蜂", "蜜蜂", "🐝", "honeybee-v1"))
            self.assertEqual(db.query(Mail).count(), 1)

    def test_unknown_key_cannot_adopt_or_replace_reserved_wish_asset(self):
        f = self.fixture
        unknown = "unpublished-unicorn-v1"
        response = f.request("POST", "/api/pets/adopt",
                             json={"name": "未知圖資", "asset_key": unknown})
        self.assertEqual(response.status_code, 400, response.text)
        created = f.create()
        prepared = f.prepare(created, asset_key="cat-v1")
        wish = prepared["wish"]
        rejected = f.request("PATCH", f"/api/admin/pet-wishes/{wish['id']}/preparation",
                             admin=0, json={"expected_version": wish["version"],
                                            "asset_key": unknown,
                                            "preparation_note": "should roll back"})
        f.error(rejected, "asset_unavailable")
        detail = f.request("GET", f"/api/admin/pet-wishes/{wish['id']}", admin=0)
        self.assertEqual(detail.status_code, 200, detail.text)
        self.assertEqual(detail.json()["wish"], wish)
        f.capacity(detail.json()["capacity"], active=0, reserved=1)
        with f.sessions() as db:
            self.assertEqual(db.query(Pet).count(), 0)
            self.assertEqual(db.query(Mail).count(), 0)
            self.assertEqual(db.query(PetWish).count(), 1)
