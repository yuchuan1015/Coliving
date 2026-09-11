"""023: Create garden tables only. Does not plant crops or change existing resident data."""
import os
import sys
from pathlib import Path

from sqlalchemy import create_engine

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))


def main(db_path):
    path = Path(db_path).resolve()
    if not path.is_file():
        raise SystemExit("找不到既有資料庫；新環境請由應用程式建立資料表")
    # Load metadata without opening the application's configured database.
    os.environ["COLIVING_ENV_FILE"] = ""
    # Settings requires a signing secret even though this schema-only process
    # never issues tokens. Allow standalone migration without loading secrets.
    os.environ.setdefault("JWT_SECRET", "schema-migration-only-never-used-to-sign")
    import models  # noqa: F401
    from database import Base
    db_engine = create_engine(f"sqlite:///{path}")
    try:
        # This migration stays bound to its original seven tables even after
        # future garden releases register additional models.
        names = {"garden_world", "garden_plots", "garden_operations", "garden_stock",
                 "garden_ledger", "garden_progress", "garden_logs"}
        tables = [t for t in Base.metadata.tables.values() if t.name in names]
        Base.metadata.create_all(db_engine, tables=tables)
    finally:
        db_engine.dispose()


if __name__ == "__main__":
    if len(sys.argv) != 2:
        raise SystemExit("usage: 023_garden_tier1.py <db>")
    main(sys.argv[1])
