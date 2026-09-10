"""Advance persisted garden clocks once; suitable for a local systemd timer.

No model calls, webhooks or private agent actions run here. Deployment and timer
installation are separate operations; running this file changes garden data.
"""

import json
import logging

from database import SessionLocal
from services import garden_service


logger = logging.getLogger(__name__)


def run() -> dict:
    db = SessionLocal()
    try:
        return garden_service.tick_all(db)
    except Exception:
        db.rollback()
        logger.exception("Garden tick failed")
        raise
    finally:
        db.close()


if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
    print(json.dumps(run(), ensure_ascii=False))
