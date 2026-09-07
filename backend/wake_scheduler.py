"""Wake scheduler - runs every minute via systemd timer.
Checks for due schedules, creates wake events, fires webhooks.
cron 表達式照排程主人的時區解讀（2026-09-07 她定：艙室內用住戶當地時間）。"""

import logging

import httpx

from database import SessionLocal
from models.schedule import Schedule, WakeEvent
from services import bed_service, time_service

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
logger = logging.getLogger(__name__)


def run():
    bed_service.set_bed("schedule")
    db = SessionLocal()
    now = time_service.now_utc()
    try:
        schedules = db.query(Schedule).filter(
            Schedule.enabled.is_(True),
        ).all()

        fired = 0
        for s in schedules:
            if s.next_run and time_service.aware(s.next_run) > now:
                continue

            owner = time_service.owner_of_agent(db, s.agent_id)
            tz = time_service.tz_of(owner)
            next_time = time_service.next_cron_run(s.cron_expr, tz, s.last_run or s.created_at)

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
            s.next_run = time_service.next_cron_run(s.cron_expr, tz, now)
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
