"""Verify additive, repeatable migration against an existing populated SQLite DB."""
import importlib.util
from pathlib import Path
import sqlite3
import tempfile
import unittest


class GardenMigrationTest(unittest.TestCase):
    def test_migration_is_repeatable_and_preserves_existing_rows_without_initializing_game(self):
        path = Path(__file__).resolve().parents[1] / "migrations" / "023_garden_tier1.py"
        spec = importlib.util.spec_from_file_location("garden_migration_023", path)
        migration = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(migration)
        with tempfile.TemporaryDirectory() as temp:
            db_path = Path(temp) / "existing.db"
            with sqlite3.connect(db_path) as db:
                db.execute("CREATE TABLE users (id TEXT PRIMARY KEY, marker TEXT)")
                db.execute("INSERT INTO users VALUES ('fixture-resident', 'preserve-me')")
                db.execute("CREATE TABLE unrelated (value TEXT)")
                db.execute("INSERT INTO unrelated VALUES ('keep')")
            migration.main(db_path)
            migration.main(db_path)
            with sqlite3.connect(db_path) as db:
                self.assertEqual(db.execute("SELECT * FROM users").fetchall(), [("fixture-resident", "preserve-me")])
                self.assertEqual(db.execute("SELECT * FROM unrelated").fetchall(), [("keep",)])
                tables = {r[0] for r in db.execute("SELECT name FROM sqlite_master WHERE type='table'")}
                self.assertEqual({t for t in tables if t.startswith('garden_')}, {
                    'garden_world', 'garden_plots', 'garden_operations', 'garden_stock',
                    'garden_ledger', 'garden_progress', 'garden_logs',
                })
                self.assertNotIn('agents', tables)
                self.assertEqual(db.execute("SELECT COUNT(*) FROM garden_world").fetchone()[0], 0)
                self.assertEqual(db.execute("SELECT COUNT(*) FROM garden_plots").fetchone()[0], 0)

    def test_missing_database_is_not_created(self):
        path = Path(__file__).resolve().parents[1] / "migrations" / "023_garden_tier1.py"
        spec = importlib.util.spec_from_file_location("garden_migration_023_missing", path)
        migration = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(migration)
        with tempfile.TemporaryDirectory() as temp:
            missing = Path(temp) / "missing.db"
            with self.assertRaises(SystemExit):
                migration.main(missing)
            self.assertFalse(missing.exists())
