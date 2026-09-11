"""025: Add the optional first-pet entitlement table without granting anyone."""
import os
import sys
from pathlib import Path

from sqlalchemy import create_engine

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))


def main(db_path):
    path = Path(db_path).resolve()
    if not path.is_file():
        raise SystemExit("找不到既有資料庫")
    os.environ["COLIVING_ENV_FILE"] = ""
    os.environ.setdefault("JWT_SECRET", "schema-migration-only-never-used-to-sign")
    import models  # noqa: F401
    from database import Base
    from models.pet_entitlement import PetEntitlement
    engine = create_engine(f"sqlite:///{path}")
    try:
        Base.metadata.create_all(engine, tables=[PetEntitlement.__table__])
    finally:
        engine.dispose()


if __name__ == "__main__":
    if len(sys.argv) != 2:
        raise SystemExit("usage: 025_pet_entitlement.py <db>")
    main(sys.argv[1])
