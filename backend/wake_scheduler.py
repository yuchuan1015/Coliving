"""Wake scheduler - runs every minute via systemd timer.
Checks for due schedules, creates wake events, fires webhooks."""

import logging
from datetime import datetime, timezone

import httpx
from croniter import croniter

from database import SessionLocal
from models.schedule import Schedule, WakeEvent

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
logger = logging.getLogger(__name__)


def run():
    db = SessionLocal()
    now = datetime.now(timezone.utc)
    try:
        schedules = db.query(Schedule).filter(
            Schedule.enabled.is_(True),
        ).all()

        fired = 0
        for s in schedules:
            if s.next_run and s.next_run > now:
                continue

            cron = croniter(s.cron_expr, s.last_run or s.created_at)
            next_time = cron.get_next(datetime)
            if next_time.tzinfo is None:
                next_time = next_time.replace(tzinfo=timezone.utc)

            if next_time > now:
                s.next_run = next_time
                continue

            event = WakeEvent(
                schedule_id=s.id,
                agent_id=s.agent_id,
                message=s.message,
                status="pending",
            )
            db.add(event)

            if s.callback_url:
                try:
                    resp = httpx.post(
                        s.callback_url,
                        json={
                            "type": "wake",
                            "schedule_name": s.name,
                            "message": s.message,
                            "event_id": event.id,
                        },
                        timeout=10.0,
                    )
                    if resp.status_code < 400:
                        event.status = "delivered"
                        event.delivered_at = now
                        logger.info("Webhook delivered: %s -> %s", s.name, s.callback_url)
                    else:
                        logger.warning("Webhook failed (%d): %s", resp.status_code, s.callback_url)
                except Exception as e:
                    logger.warning("Webhook error: %s -> %s", s.name, e)

            s.last_run = now
            next_after = croniter(s.cron_expr, now).get_next(datetime)
            if next_after.tzinfo is None:
                next_after = next_after.replace(tzinfo=timezone.utc)
            s.next_run = next_after
            fired += 1

        db.commit()
        if fired:
            logger.info("Fired %d schedule(s)", fired)
    except Exception:
        logger.exception("Scheduler error")
        db.rollback()
    finally:
        db.close()


if __name__ == "__main__":
    run()
