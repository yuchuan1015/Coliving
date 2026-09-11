"""Only delivered registry records may authorize artwork or instant adoption."""
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

from services import pet_assets


class PetAssetRegistryTest(unittest.TestCase):
    def setUp(self):
        temp = tempfile.TemporaryDirectory(prefix='pet-assets-')
        self.addCleanup(temp.cleanup)
        self.path = Path(temp.name) / 'assets.json'
        self.enterContext(patch.object(pet_assets, 'REGISTRY_PATH', self.path))

    def write(self, assets):
        self.path.write_text(json.dumps({'schema_version': 1, 'catalog_version': 'fixture-1', 'assets': assets}))

    def asset(self, **changes):
        return {'asset_key': 'fixture-cat-v1', 'species': 'cat', 'emoji': '🐈',
                'image_url': '/assets/pets/fixture-cat.v1.webp', 'published': True, **changes}

    def test_empty_registry_and_unpublished_records_cannot_authorize_adoption(self):
        self.write([])
        self.assertEqual(pet_assets.catalog(), {'items': [], 'catalog_version': 'fixture-1'})
        self.write([self.asset(published=False)])
        self.assertIsNone(pet_assets.get_asset('fixture-cat-v1'))
        self.assertIsNone(pet_assets.resolve_asset('cat', '🐈', None))

    def test_trusted_catalog_and_unique_legacy_match(self):
        self.write([self.asset()])
        resolved = pet_assets.resolve_asset('cat', '🐈', None)
        self.assertEqual(resolved['asset_key'], 'fixture-cat-v1')
        self.assertEqual(pet_assets.resolve_asset('', '', 'fixture-cat-v1'), resolved)
        self.assertIsNone(pet_assets.resolve_asset('dog', '🐈', 'fixture-cat-v1'))
        self.assertIsNone(pet_assets.resolve_asset('cat', '🐕', 'fixture-cat-v1'))
        self.assertNotIn('published', resolved)

    def test_same_species_appearances_require_an_explicit_key(self):
        self.write([self.asset(), self.asset(asset_key='fixture-cat-v2', image_url='/assets/pets/fixture-cat-v2.png')])
        self.assertIsNone(pet_assets.resolve_asset('cat', '🐈', None))
        self.assertEqual(pet_assets.get_asset('fixture-cat-v2')['image_url'], '/assets/pets/fixture-cat-v2.png')

    def test_remote_paths_traversal_and_non_image_urls_fail_closed(self):
        for value in ['https://elsewhere.invalid/cat.png', '//elsewhere.invalid/cat.png',
                      '/Users/resident/cat.png', '/assets/pets/../private.png',
                      '/assets/pets/%2e%2e/private.png', '/assets/pets/cat.png?secret=1',
                      '/assets/pets/cat.svg', '/assets/pets/cat.png#fragment']:
            with self.subTest(value=value):
                self.write([self.asset(image_url=value)])
                with self.assertRaises(ValueError):
                    pet_assets.get_assets()

    def test_duplicate_keys_and_malformed_published_records_fail_closed(self):
        for assets in [[self.asset(), self.asset()], [self.asset(asset_key='../escape')],
                       [self.asset(species=' ')], [self.asset(emoji='')]]:
            self.write(assets)
            with self.assertRaises(ValueError):
                pet_assets.get_assets()

    def test_unknown_or_non_key_inputs_cannot_read_a_file(self):
        self.write([self.asset()])
        for key in [None, '', '/private/tmp/cat', 'https://elsewhere.invalid', 'missing', '../assets']:
            self.assertIsNone(pet_assets.get_asset(key))
