"""Unit tests for backend/app/helpers/needs_water.py targeting 100% coverage."""

from datetime import datetime, timedelta
from unittest.mock import patch, MagicMock

import pytest

from backend.app.helpers.needs_water import (
    WaterStatus,
    compute_water_status,
    _days_offset_for_plant,
)
from backend.app.helpers.water_retained import WaterRetainedCalculation


class FakeCursor:
    def __init__(self, rows=None, fetchone_results=None):
        self._rows = rows or []
        self._fetchone_results = fetchone_results or []
        self._fetchone_index = 0
        self.last_query = None
        self.last_params = None
        self.closed = False

    def __enter__(self):
        return self

    def __exit__(self, exc_type, exc, tb):
        self.close()
        return False

    def execute(self, query, params=None):
        self.last_query = query
        self.last_params = list(params or [])
        return len(self._rows)

    def fetchall(self):
        return list(self._rows)

    def fetchone(self):
        if self._fetchone_index < len(self._fetchone_results):
            result = self._fetchone_results[self._fetchone_index]
            self._fetchone_index += 1
            return result
        return None

    def close(self):
        self.closed = True


class FakeConnection:
    def __init__(self, cursor=None):
        self._cursor = cursor or FakeCursor()
        self.closed = False

    def cursor(self):
        return self._cursor

    def close(self):
        self.closed = True


def make_water_retained_result(water_retained_pct=None):
    """Create a mock WaterRetainedCalculation."""
    result = MagicMock(spec=WaterRetainedCalculation)
    result.water_retained_pct = water_retained_pct
    return result


class TestComputeWaterStatus:
    """Tests for compute_water_status function."""

    def test_compute_water_status_vacation_days_offset_zero_or_negative(self, monkeypatch):
        """Test vacation mode with days_offset <= 0 sets needs_water=True (line 77)."""
        # Mock _days_offset_for_plant to return 0 (overdue)
        monkeypatch.setattr(
            "backend.app.helpers.needs_water._days_offset_for_plant", lambda conn, plant_id: 0
        )

        fake_conn = FakeConnection()
        plant_id = "11" * 16

        result = compute_water_status(
            conn=fake_conn,
            plant_id_hex=plant_id,
            water_retained_pct=50.0,
            water_loss_total_pct=10.0,
            mode="vacation",
            recommended_water_threshold_pct=40.0,
            default_threshold=40.0,
            days_offset=None,  # Will be computed via _days_offset_for_plant
        )

        assert result.needs_water is True
        assert result.needs_watering_prediction is False

    def test_compute_water_status_vacation_days_offset_negative(self, monkeypatch):
        """Test vacation mode with negative days_offset sets needs_water=True (line 77)."""
        monkeypatch.setattr(
            "backend.app.helpers.needs_water._days_offset_for_plant", lambda conn, plant_id: -5
        )

        fake_conn = FakeConnection()
        plant_id = "22" * 16

        result = compute_water_status(
            conn=fake_conn,
            plant_id_hex=plant_id,
            water_retained_pct=80.0,
            water_loss_total_pct=5.0,
            mode="vacation",
            recommended_water_threshold_pct=40.0,
            default_threshold=40.0,
            days_offset=None,
        )

        assert result.needs_water is True

    def test_compute_water_status_vacation_days_offset_none_retained_below_threshold(
        self, monkeypatch
    ):
        """Test vacation mode with days_offset=None and retained <= threshold (lines 78-79)."""
        monkeypatch.setattr(
            "backend.app.helpers.needs_water._days_offset_for_plant", lambda conn, plant_id: None
        )

        fake_conn = FakeConnection()
        plant_id = "33" * 16

        # water_retained_pct=30, threshold=40 -> needs_water=True
        result = compute_water_status(
            conn=fake_conn,
            plant_id_hex=plant_id,
            water_retained_pct=30.0,
            water_loss_total_pct=10.0,
            mode="vacation",
            recommended_water_threshold_pct=40.0,
            default_threshold=40.0,
            days_offset=None,
        )

        assert result.needs_water is True

    def test_compute_water_status_vacation_days_offset_none_retained_above_threshold(
        self, monkeypatch
    ):
        """Test vacation mode with days_offset=None and retained > threshold."""
        monkeypatch.setattr(
            "backend.app.helpers.needs_water._days_offset_for_plant", lambda conn, plant_id: None
        )

        fake_conn = FakeConnection()
        plant_id = "44" * 16

        # water_retained_pct=50, threshold=40 -> needs_water=False
        result = compute_water_status(
            conn=fake_conn,
            plant_id_hex=plant_id,
            water_retained_pct=50.0,
            water_loss_total_pct=10.0,
            mode="vacation",
            recommended_water_threshold_pct=40.0,
            default_threshold=40.0,
            days_offset=None,
        )

        assert result.needs_water is False

    def test_compute_water_status_vacation_days_offset_positive(self, monkeypatch):
        """Test vacation mode with positive days_offset uses retained vs threshold."""
        monkeypatch.setattr(
            "backend.app.helpers.needs_water._days_offset_for_plant", lambda conn, plant_id: 5
        )

        fake_conn = FakeConnection()
        plant_id = "55" * 16

        # days_offset=5 > 0, retained=30 <= threshold=40 -> needs_water=True
        result = compute_water_status(
            conn=fake_conn,
            plant_id_hex=plant_id,
            water_retained_pct=30.0,
            water_loss_total_pct=10.0,
            mode="vacation",
            recommended_water_threshold_pct=40.0,
            default_threshold=40.0,
            days_offset=None,
        )

        assert result.needs_water is True

    def test_compute_water_status_vacation_explicit_days_offset_zero(self):
        """Test vacation mode with explicit days_offset=0 (line 77)."""
        fake_conn = FakeConnection()
        plant_id = "66" * 16

        # Explicit days_offset=0 should trigger needs_water=True
        result = compute_water_status(
            conn=fake_conn,
            plant_id_hex=plant_id,
            water_retained_pct=80.0,
            water_loss_total_pct=5.0,
            mode="vacation",
            recommended_water_threshold_pct=40.0,
            default_threshold=40.0,
            days_offset=0,
        )

        assert result.needs_water is True

    def test_compute_water_status_vacation_explicit_days_offset_negative(self):
        """Test vacation mode with explicit negative days_offset (line 77)."""
        fake_conn = FakeConnection()
        plant_id = "77" * 16

        result = compute_water_status(
            conn=fake_conn,
            plant_id_hex=plant_id,
            water_retained_pct=80.0,
            water_loss_total_pct=5.0,
            mode="vacation",
            recommended_water_threshold_pct=40.0,
            default_threshold=40.0,
            days_offset=-3,
        )

        assert result.needs_water is True

    def test_compute_water_status_manual_mode_standard_needs_water(self):
        """Test manual mode uses standard_needs_water logic."""
        fake_conn = FakeConnection()
        plant_id = "88" * 16

        # retained=30 <= threshold=40 -> needs_water=True
        result = compute_water_status(
            conn=fake_conn,
            plant_id_hex=plant_id,
            water_retained_pct=30.0,
            water_loss_total_pct=10.0,
            mode="manual",
            recommended_water_threshold_pct=40.0,
            default_threshold=40.0,
        )

        assert result.needs_water is True

    def test_compute_water_status_manual_mode_retained_above_threshold(self):
        """Test manual mode with retained above threshold."""
        fake_conn = FakeConnection()
        plant_id = "99" * 16

        result = compute_water_status(
            conn=fake_conn,
            plant_id_hex=plant_id,
            water_retained_pct=60.0,
            water_loss_total_pct=10.0,
            mode="manual",
            recommended_water_threshold_pct=40.0,
            default_threshold=40.0,
        )

        assert result.needs_water is False

    def test_compute_water_status_manual_mode_zero_loss_suppresses(self):
        """Test manual mode with water_loss_total_pct=0 suppresses needs_water (line 62)."""
        fake_conn = FakeConnection()
        plant_id = "aa" * 16

        # water_loss_total_pct=0 should suppress needs_water even if retained is low
        result = compute_water_status(
            conn=fake_conn,
            plant_id_hex=plant_id,
            water_retained_pct=10.0,  # Very low
            water_loss_total_pct=0.0,  # But no loss
            mode="manual",
            recommended_water_threshold_pct=40.0,
            default_threshold=40.0,
        )

        assert result.needs_water is False

    def test_compute_water_status_manual_mode_none_retained_calls_prediction(self, monkeypatch):
        """Test manual mode with None retained calls _check_watering_prediction."""
        mock_check = MagicMock(return_value=True)
        monkeypatch.setattr(
            "backend.app.helpers.plants_list.PlantsList._check_watering_prediction", mock_check
        )

        fake_conn = FakeConnection()
        plant_id = "bb" * 16

        result = compute_water_status(
            conn=fake_conn,
            plant_id_hex=plant_id,
            water_retained_pct=None,
            water_loss_total_pct=10.0,
            mode="manual",
            recommended_water_threshold_pct=40.0,
            default_threshold=40.0,
        )

        assert result.needs_water is True
        mock_check.assert_called_once_with(fake_conn, plant_id)

    def test_compute_water_status_needs_watering_prediction_when_not_needs_water(self, monkeypatch):
        """Test needs_watering_prediction is checked when standard_needs_water is False."""
        mock_check = MagicMock(return_value=True)
        monkeypatch.setattr(
            "backend.app.helpers.plants_list.PlantsList._check_watering_prediction", mock_check
        )

        fake_conn = FakeConnection()
        plant_id = "cc" * 16

        # retained=60 > threshold=40 -> standard_needs_water=False
        # Then needs_watering_prediction should be checked
        result = compute_water_status(
            conn=fake_conn,
            plant_id_hex=plant_id,
            water_retained_pct=60.0,
            water_loss_total_pct=10.0,
            mode="manual",
            recommended_water_threshold_pct=40.0,
            default_threshold=40.0,
        )

        assert result.needs_water is False
        assert result.needs_watering_prediction is True
        mock_check.assert_called_once_with(fake_conn, plant_id)

    def test_compute_water_status_vacation_mode_no_prediction_when_needs_water(self, monkeypatch):
        """Test vacation mode still checks prediction when standard_needs_water is False."""
        mock_check = MagicMock(return_value=True)
        monkeypatch.setattr(
            "backend.app.helpers.plants_list.PlantsList._check_watering_prediction", mock_check
        )

        fake_conn = FakeConnection()
        plant_id = "dd" * 16

        # days_offset=0 -> needs_water=True, but standard_needs_water is False (vacation mode skips it)
        # So needs_watering_prediction is still checked
        result = compute_water_status(
            conn=fake_conn,
            plant_id_hex=plant_id,
            water_retained_pct=60.0,
            water_loss_total_pct=10.0,
            mode="vacation",
            recommended_water_threshold_pct=40.0,
            default_threshold=40.0,
            days_offset=0,
        )

        assert result.needs_water is True
        # In vacation mode, standard_needs_water is always False, so prediction is checked
        assert result.needs_watering_prediction is True
        mock_check.assert_called_once_with(fake_conn, plant_id)

    def test_compute_water_status_manual_mode_thresh_none_retained_not_none(self):
        """Test manual mode with thresh_val=None and retained not None (branch 50->59).

        Covers the case where water_retained_pct is not None but thresh_val is None,
        so first if is False, elif is False (retained not None), falls through to
        water_loss_total_pct check.
        """
        fake_conn = FakeConnection()
        plant_id = "ee" * 16

        # recommended_water_threshold_pct=None and default_threshold=None -> thresh_val=None
        # water_retained_pct=30.0 (not None), so first if fails (thresh_val is None)
        # elif fails (water_retained_pct is not None)
        # water_loss_total_pct=10.0 != 0, so no suppression
        # standard_needs_water stays False
        result = compute_water_status(
            conn=fake_conn,
            plant_id_hex=plant_id,
            water_retained_pct=30.0,
            water_loss_total_pct=10.0,
            mode="manual",
            recommended_water_threshold_pct=None,
            default_threshold=None,
        )

        assert result.needs_water is False

    def test_compute_water_status_manual_mode_else_branch(self):
        """Test manual mode else branch (branch 78->83).

        Covers the else branch of 'if mode == "vacation":' where
        needs_water = standard_needs_water.
        """
        fake_conn = FakeConnection()
        plant_id = "ff" * 16

        # mode="manual" (not vacation) -> takes else branch at line 78
        # retained=30 <= threshold=40 -> standard_needs_water=True
        result = compute_water_status(
            conn=fake_conn,
            plant_id_hex=plant_id,
            water_retained_pct=30.0,
            water_loss_total_pct=10.0,
            mode="manual",
            recommended_water_threshold_pct=40.0,
            default_threshold=40.0,
        )

        assert result.needs_water is True
        assert result.needs_watering_prediction is False

    def test_compute_water_status_vacation_days_offset_positive_elif_false(self, monkeypatch):
        """Test vacation mode with days_offset > 0 and elif condition False (branch 78->83).

        Covers the case where days_offset > 0 but water_retained_pct is None,
        so the elif condition fails and falls through to return.
        """
        monkeypatch.setattr(
            "backend.app.helpers.needs_water._days_offset_for_plant", lambda conn, plant_id: 5
        )

        fake_conn = FakeConnection()
        plant_id = "gg" * 16

        # days_offset=5 > 0, but water_retained_pct=None -> elif is False
        # needs_water stays False (default)
        result = compute_water_status(
            conn=fake_conn,
            plant_id_hex=plant_id,
            water_retained_pct=None,
            water_loss_total_pct=10.0,
            mode="vacation",
            recommended_water_threshold_pct=40.0,
            default_threshold=40.0,
            days_offset=None,
        )

        assert result.needs_water is False

    def test_compute_water_status_vacation_days_offset_positive_thresh_none(self, monkeypatch):
        """Test vacation mode with days_offset > 0 and thresh_val None (branch 78->83).

        Covers the case where days_offset > 0 but thresh_val is None
        (both recommended_water_threshold_pct and default_threshold are None),
        so the elif condition fails.
        """
        monkeypatch.setattr(
            "backend.app.helpers.needs_water._days_offset_for_plant", lambda conn, plant_id: 5
        )

        fake_conn = FakeConnection()
        plant_id = "hh" * 16

        # days_offset=5 > 0, retained=30.0 not None, but thresh_val=None
        # (recommended_water_threshold_pct=None, default_threshold=None)
        # elif condition: water_retained_pct is not None AND thresh_val is not None -> False
        result = compute_water_status(
            conn=fake_conn,
            plant_id_hex=plant_id,
            water_retained_pct=30.0,
            water_loss_total_pct=10.0,
            mode="vacation",
            recommended_water_threshold_pct=None,
            default_threshold=None,
            days_offset=None,
        )

        assert result.needs_water is False


class TestDaysOffsetForPlant:
    """Tests for _days_offset_for_plant function (lines 109-111)."""

    def test_days_offset_for_plant_normal_calculation(self, monkeypatch):
        """Test normal calculation path covering lines 109-111."""
        # Fixed datetime for deterministic testing
        fixed_now = datetime(2024, 6, 15, 12, 0, 0)

        # last_watering_at = 2024-06-10, freq_days=7
        # first_date = 2024-06-17
        # today_date = 2024-06-15
        # days_offset = 2
        last_watering_at = datetime(2024, 6, 10, 10, 0, 0)
        freq_days = 7

        fake_conn = FakeConnection()
        fake_cursor = fake_conn._cursor
        fake_cursor._fetchone_results = [
            (freq_days,),  # frequency_days query
        ]

        # Mock get_last_watering_event_since to return a tuple
        monkeypatch.setattr(
            "backend.app.helpers.needs_water.get_last_watering_event_since",
            lambda conn, plant_id: (last_watering_at, 100.0, 200.0, 50.0),
        )

        with patch("backend.app.helpers.needs_water.datetime") as mock_datetime:
            mock_datetime.now.return_value = fixed_now
            mock_datetime.timedelta = timedelta

            result = _days_offset_for_plant(fake_conn, "11" * 16)

        assert result == 2

    def test_days_offset_for_plant_overdue(self, monkeypatch):
        """Test days_offset calculation when overdue (negative result)."""
        fixed_now = datetime(2024, 6, 20, 12, 0, 0)

        # last_watering_at = 2024-06-10, freq_days=7
        # first_date = 2024-06-17
        # today_date = 2024-06-20
        # days_offset = -3
        last_watering_at = datetime(2024, 6, 10, 10, 0, 0)
        freq_days = 7

        fake_conn = FakeConnection()
        fake_cursor = fake_conn._cursor
        fake_cursor._fetchone_results = [
            (freq_days,),
        ]

        monkeypatch.setattr(
            "backend.app.helpers.needs_water.get_last_watering_event_since",
            lambda conn, plant_id: (last_watering_at, 100.0, 200.0, 50.0),
        )

        with patch("backend.app.helpers.needs_water.datetime") as mock_datetime:
            mock_datetime.now.return_value = fixed_now
            mock_datetime.timedelta = timedelta

            result = _days_offset_for_plant(fake_conn, "22" * 16)

        assert result == -3

    def test_days_offset_for_plant_no_frequency(self):
        """Test returns None when frequency_days is None."""
        fake_conn = FakeConnection()
        fake_cursor = fake_conn._cursor
        fake_cursor._fetchone_results = [
            (None,),  # frequency_days is None
        ]

        result = _days_offset_for_plant(fake_conn, "33" * 16)

        assert result is None

    def test_days_offset_for_plant_zero_frequency(self):
        """Test returns None when frequency_days <= 0."""
        fake_conn = FakeConnection()
        fake_cursor = fake_conn._cursor
        fake_cursor._fetchone_results = [
            (0,),  # frequency_days is 0
        ]

        result = _days_offset_for_plant(fake_conn, "44" * 16)

        assert result is None

    def test_days_offset_for_plant_no_last_watering(self, monkeypatch):
        """Test returns None when no last watering event."""
        fake_conn = FakeConnection()
        fake_cursor = fake_conn._cursor
        fake_cursor._fetchone_results = [
            (7,),  # frequency_days = 7
        ]

        monkeypatch.setattr(
            "backend.app.helpers.needs_water.get_last_watering_event_since",
            lambda conn, plant_id: None,
        )

        result = _days_offset_for_plant(fake_conn, "55" * 16)

        assert result is None

    def test_days_offset_for_plant_exception_handling(self):
        """Test exception handling returns None (line 112-113)."""
        fake_conn = FakeConnection()
        fake_cursor = fake_conn._cursor
        # Make execute raise an exception
        fake_cursor.execute = MagicMock(side_effect=Exception("DB error"))

        result = _days_offset_for_plant(fake_conn, "66" * 16)

        assert result is None

    def test_days_offset_for_plant_covers_lines_109_111(self, monkeypatch):
        """Explicit test to ensure lines 109, 110, 111 are covered."""
        fixed_now = datetime(2024, 7, 1, 12, 0, 0)
        last_watering_at = datetime(2024, 6, 25, 10, 0, 0)  # 6 days ago
        freq_days = 7

        # first_date = 2024-06-25 + 7 days = 2024-07-02
        # today_date = 2024-07-01
        # days_offset = 1
        fake_conn = FakeConnection()
        fake_cursor = fake_conn._cursor
        fake_cursor._fetchone_results = [
            (freq_days,),
        ]

        monkeypatch.setattr(
            "backend.app.helpers.needs_water.get_last_watering_event_since",
            lambda conn, plant_id: (last_watering_at, 100.0, 200.0, 50.0),
        )

        with patch("backend.app.helpers.needs_water.datetime") as mock_datetime:
            mock_datetime.now.return_value = fixed_now
            mock_datetime.timedelta = timedelta

            # This exercises lines 109 (today_date), 110 (first_date), 111 (return)
            result = _days_offset_for_plant(fake_conn, "77" * 16)

        assert result == 1
        # Verify the query was executed
        assert fake_cursor.last_query is not None
        assert "frequency_days" in fake_cursor.last_query
