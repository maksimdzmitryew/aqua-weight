"""WhatsApp notification scheduler using APScheduler."""

import logging
from datetime import datetime, timezone

from apscheduler.schedulers.background import BackgroundScheduler
from apscheduler.triggers.cron import CronTrigger
import pytz

from ..db.core import cursor
from ..db.core import get_conn
from ..helpers.whatsapp_notify import (
    get_thirsty_plants,
    get_weight_plants,
    record_whatsapp_send_log,
    render_placeholders,
    send_whatsapp_text_message,
    should_skip_notification,
    SETTINGS_KEY_DAILY_DIGEST,
    _build_thirsty_list,
    _build_weight_plants_list,
)
from ..services.settings_service import SettingsService

SETTINGS_KEY_THIRSTY_LIST_TEMPLATE = "whatsapp_thirsty_list_template"
SETTINGS_KEY_WEIGHT_PLANTS_TEMPLATE = "whatsapp_weight_plants_template"

logger = logging.getLogger(__name__)

_scheduler = None


def _fetch_username(conn, user_id: bytes) -> str:
    with cursor(conn) as cur:
        cur.execute("SELECT username FROM users WHERE id = %s", (user_id,))
        row = cur.fetchone()
        return row[0] if row else ""


# _build_thirsty_list is now imported from whatsapp_notify.py


def _send_digest_for_admin(conn, user_id: bytes, settings: dict):
    """Send daily digest to the admin user's WhatsApp number.

    Settings are read from the user's settings_json (not a dedicated table).
    """
    try:
        triggered_by = "scheduled"
        username = _fetch_username(conn, user_id)

        if should_skip_notification(settings):
            msg = "Skipped (helping user requested recently)"
            logger.info(f"Skipping digest for user {user_id.hex()} ({username}) - {msg}")
            record_whatsapp_send_log(
                conn,
                user_id=user_id,
                to_number=settings.get("whatsapp_number") or "",
                message_type="text",
                triggered_by=triggered_by,
                body=None,
                success=True,
                error_message=msg,
            )
            return

        whatsapp_number = settings.get("whatsapp_number")
        if not whatsapp_number:
            err = "WhatsApp number not configured"
            logger.warning(f"{err} for user {user_id.hex()} ({username})")
            record_whatsapp_send_log(
                conn,
                user_id=user_id,
                to_number="",
                message_type="text",
                triggered_by=triggered_by,
                body=None,
                success=False,
                error_message=err,
            )
            return

        digest_template = (settings.get(SETTINGS_KEY_DAILY_DIGEST) or "").strip()
        if not digest_template:
            err = "Daily digest is empty"
            logger.warning(f"{err} for user {user_id.hex()} ({username}) - refusing to send")
            record_whatsapp_send_log(
                conn,
                user_id=user_id,
                to_number=whatsapp_number,
                message_type="text",
                triggered_by=triggered_by,
                body=None,
                success=False,
                error_message=err,
            )
            return

        thirsty_list_template = settings.get(SETTINGS_KEY_THIRSTY_LIST_TEMPLATE) or None
        weight_plants_template = settings.get(SETTINGS_KEY_WEIGHT_PLANTS_TEMPLATE) or None

        helpers = settings.get("whatsapp_helpers", [])
        thirsty_plants = get_thirsty_plants(conn, user_id)
        weight_plants = get_weight_plants(conn, user_id)

        now_berlin = datetime.now(pytz.timezone("Europe/Berlin"))
        values = {
            "date": now_berlin.strftime("%Y-%m-%d"),
            "app_name": "Aqua Weight",
            "thirsty_count": str(len(thirsty_plants)),
            "thirsty_list": _build_thirsty_list(thirsty_plants, thirsty_list_template),
            "helpers_count": str(len(helpers)),
            "admin_username": username,
            "weight_plants_list": _build_weight_plants_list(weight_plants, weight_plants_template),
            "weight_plants_count": str(len(weight_plants)),
            "phone_number_id": whatsapp_number,
        }

        message = render_placeholders(digest_template, values)
        sent, error = send_whatsapp_text_message(whatsapp_number, message, conn=conn)

        record_whatsapp_send_log(
            conn,
            user_id=user_id,
            to_number=whatsapp_number,
            message_type="text",
            triggered_by=triggered_by,
            body=message,
            success=sent,
            error_message=error or None,
        )

        if not sent:
            logger.warning(f"WhatsApp digest send failed for user {user_id.hex()} ({username})")
            return

        # Record last notification timestamp in settings_json (kept for legacy skip logic).
        service = SettingsService(conn)
        settings["whatsapp_last_notification"] = {
            "sent_at": datetime.now(timezone.utc).isoformat(),
            "triggered_by": "scheduled",
            "thirsty_plants": [p.get("name") for p in thirsty_plants if p.get("name")],
        }
        service.update_settings(user_id, settings)
    except Exception as e:
        logger.error(f"Failed to send digest for user {user_id.hex()}: {e}")


def _daily_digest_job():
    """Scheduled job: send daily digest to admin users."""
    logger.info("Running daily WhatsApp digest job")
    try:
        conn = get_conn()
        try:
            service = SettingsService(conn)
            with cursor(conn) as cur:
                cur.execute("SELECT id FROM users WHERE global_role = 'admin'")
                admin_rows = cur.fetchall()

            for (admin_id,) in admin_rows:
                settings, _ = service.get_settings(admin_id)
                _send_digest_for_admin(conn, admin_id, settings)
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
