from datetime import datetime, timedelta
from unittest.mock import patch
from backend.app.helpers.weighing import needs_weighing


def test_needs_weighing_vacation_mode():
    # In vacation mode, it should always return False
    assert needs_weighing(datetime.utcnow(), "vacation") is False
    assert needs_weighing(None, "vacation") is False
    assert needs_weighing(datetime.utcnow() - timedelta(days=7), "vacation") is False


def test_needs_weighing_no_last_measurement():
    # If no last measurement, it should return True (except in vacation mode)
    assert needs_weighing(None, "automatic") is True
    assert needs_weighing(None, "manual") is True


def test_needs_weighing_time_thresholds():
    now = datetime.utcnow()

    # Exactly 18 hours ago (threshold is last_measured_at < threshold)
    # threshold = now - 18h
    # if last_measured_at == threshold, last_measured_at < threshold is False

    with patch("backend.app.helpers.weighing.datetime") as mock_datetime:
        mock_datetime.utcnow.return_value = now
        # Mocking datetime class is tricky because it's a built-in.
        # Often easier to mock the whole module or just use a fixed 'now' if possible.
        # But needs_weighing calls datetime.utcnow() directly.
        pass


def test_needs_weighing_logic():
    now = datetime.utcnow()

    # Case: more than 18 hours ago
    last_measured_at = now - timedelta(hours=18, minutes=1)
    # We need to control what needs_weighing thinks 'now' is.
    # Instead of patching datetime (which is hard), we can patch the function's access to it if we import it differently,
    # or just use the fact that it calls datetime.utcnow().

    with patch("backend.app.helpers.weighing.datetime") as mock_dt:
        mock_dt.utcnow.return_value = now
        mock_dt.side_effect = lambda *args, **kw: datetime(*args, **kw)  # Allow creating datetimes

        # more than 18h ago -> True
        assert needs_weighing(now - timedelta(hours=18, seconds=1), "automatic") is True

        # exactly 18h ago -> False (threshold is now - 18h, last < threshold is False)
        assert needs_weighing(now - timedelta(hours=18), "automatic") is False

        # less than 18h ago -> False
        assert needs_weighing(now - timedelta(hours=17, minutes=59), "manual") is False

        # recently -> False
        assert needs_weighing(now - timedelta(minutes=5), "automatic") is False
