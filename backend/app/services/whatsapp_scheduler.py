"""WhatsApp notification scheduler using APScheduler."""

import logging
from datetime import datetime, timezone

from apscheduler.schedulers.background import BackgroundScheduler
from apscheduler.triggers.cron import CronTrigger
import pytz

from ..db.core import get_conn
from ..helpers.whatsapp_notify import (
    get_thirsty_plants,
    format_digest_message,
    send_whatsapp_message,
    should_skip_notification,
)
from ..services.settings_service import SettingsService

logger = logging.getLogger(__name__)

_scheduler = None


def _send_digest_for_user(conn, user_id: bytes, settings: dict):
    """Send daily digest to a single user's WhatsApp group.

    Settings are read from the user's settings_json (not a dedicated table).
    """
    try:
        if should_skip_notification(settings):
            logger.info(f"Skipping notification for user {user_id.hex()} (helping user requested recently)")
            return

        whatsapp_number = settings.get("whatsapp_number")
        if not whatsapp_number:
            logger.warning(f"No whatsapp_number for user {user_id.hex()}, skipping")
            return

        helpers = settings.get("whatsapp_helpers", [])
        thirsty_plants = get_thirsty_plants(conn, user_id)
        message = format_digest_message(thirsty_plants, helpers_count=len(helpers))
        sent, _ = send_whatsapp_message(whatsapp_number, message)

        if not sent:
            logger.warning(f"WhatsApp send failed for user {user_id.hex()} — not recording timestamp")
            return

        # Record last notification timestamp in settings_json (replaces notification_sessions table)
        service = SettingsService(conn)
        settings["whatsapp_last_notification"] = {
            "sent_at": datetime.now(timezone.utc).isoformat(),
            "triggered_by": "scheduled",
            "thirsty_plants": [p["name"] for p in thirsty_plants],
        }
        service.update_settings(user_id, settings)
    except Exception as e:
        logger.error(f"Failed to send digest for user {user_id.hex()}: {e}")


def _daily_digest_job():
    """Scheduled job: send daily digest to all users with WhatsApp enabled."""
    logger.info("Running daily WhatsApp digest job")
    try:
        conn = get_conn()
        try:
            service = SettingsService(conn)
            for user_id, settings in service.get_whatsapp_enabled_users():
                _send_digest_for_user(conn, user_id, settings)
        finally:
            conn.close()
    except Exception as e:
        logger.error(f"Daily digest job failed: {e}")


def schedule_daily_digest():
    """Register the daily digest job at 17:00 Europe/Berlin."""
    global _scheduler
    if _scheduler is not None:
        return

    _scheduler = BackgroundScheduler(timezone=pytz.timezone("Europe/Berlin"))
    _scheduler.add_job(
        _daily_digest_job,
        trigger=CronTrigger(hour=17, minute=0),
        id="whatsapp_daily_digest",
        name="WhatsApp Daily Digest",
        replace_existing=True,
    )
    _scheduler.start()
    logger.info("WhatsApp daily digest scheduler started (17:00 Berlin time)")


if __name__ == "__main__":
    """Run as a standalone cron process: python -m app.services.whatsapp_scheduler"""
    import logging as _logging
    _logging.basicConfig(level=_logging.INFO)

    schedule_daily_digest()
    logger.info("Scheduler running as standalone process — press Ctrl+C to exit")

    try:
        # Block forever; schedule_daily_digest already started the background jobs
        import threading
        threading.Event().wait()
    except (KeyboardInterrupt, SystemExit):
        if _scheduler is not None:
            _scheduler.shutdown()
        logger.info("Scheduler shut down")
