"""026: additive wishes/receipts and nullable pet artwork reference; no seed assets or pets."""
import os
from pathlib import Path
import sqlite3
import sys

TABLES = ("pet_wishes", "pet_wish_receipts")


def main(db_path):
    path = Path(db_path).resolve()
    if not path.is_file():
        raise SystemExit("找不到既有資料庫")
    os.environ["COLIVING_ENV_FILE"] = ""
    os.environ.setdefault("JWT_SECRET", "schema-migration-only-never-used-to-sign")
    sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
    with sqlite3.connect(path) as db:
        cols = {row[1] for row in db.execute("PRAGMA table_info(pets)")}
        if not cols:
            raise SystemExit("找不到既有 pets 表")
        if "asset_key" not in cols:
            db.execute("ALTER TABLE pets ADD COLUMN asset_key VARCHAR(128)")
    from sqlalchemy import create_engine
    import models  # noqa: F401
    from database import Base
    engine = create_engine(f"sqlite:///{path}")
    try:
        Base.metadata.create_all(engine, tables=[Base.metadata.tables[name] for name in TABLES])
    finally:
        engine.dispose()


if __name__ == "__main__":
    if len(sys.argv) != 2:
        raise SystemExit("usage: 026_pet_wishes.py <db>")
    main(sys.argv[1])
