"""024: Add credit limits, frozen crop prices, sale receipts and exact wallets.

Schema only. Existing balances/stocks are retained; their exact wallet/lot
records are initialized lazily in the same locked transaction that uses them.
No crop simulation, rewards, sales or retrospective garden credit are run here.
"""
import os
import sys
from pathlib import Path

from sqlalchemy import create_engine

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

TABLES = {"garden_credit_days", "garden_credit_slots", "garden_credit_votes",
          "garden_market_batches", "garden_market_lots", "garden_sales",
          "shell_wallets", "shell_entries"}


def main(db_path):
    path = Path(db_path).resolve()
    if not path.is_file():
        raise SystemExit("找不到既有資料庫；新環境請由應用程式建立資料表")
    os.environ["COLIVING_ENV_FILE"] = ""
    os.environ.setdefault("JWT_SECRET", "schema-migration-only-never-used-to-sign")
    import models  # noqa: F401
    from database import Base
    engine = create_engine(f"sqlite:///{path}")
    try:
        Base.metadata.create_all(engine, tables=[Base.metadata.tables[name] for name in sorted(TABLES)])
    finally:
        engine.dispose()


if __name__ == "__main__":
    if len(sys.argv) != 2:
        raise SystemExit("usage: 024_garden_economy.py <db>")
    main(sys.argv[1])
