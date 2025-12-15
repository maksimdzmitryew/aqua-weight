# app/helpers/plants_list.py
from datetime import datetime, timedelta
from math import ceil
from ..db import get_conn, bin_to_hex
from ..helpers.water_retained import calculate_water_retained
from ..helpers.frequency import compute_frequency_days

class PlantsList:
    """
    Helper to fetch a list of active (non-archived) plants with latest water loss.

    Usage:
      items = PlantsList.fetch_all()
    """

    @staticmethod
    def fetch_all(min_water_loss_total_pct: float = None) -> list[dict]:
        conn = get_conn()
        try:
            with conn.cursor() as cur:
                query = """
                    SELECT p.id,
                           p.name,
                           p.notes,
                           p.species_name,
                           p.min_dry_weight_g,
                           p.max_water_weight_g,
                           p.recommended_water_threshold_pct,
                           p.identify_hint,
                           p.location_id,
                           COALESCE(l.name, NULL) AS location_name,
                           p.created_at,
                           latest_pm.measured_at,
                           latest_pm.measured_weight_g,
                           latest_pm.last_wet_weight_g,
                           latest_pm.water_loss_total_pct
                    FROM plants p
                             LEFT JOIN locations l ON l.id = p.location_id
                             LEFT JOIN (SELECT measured_at, plant_id,
                                               measured_weight_g, last_wet_weight_g, water_loss_total_pct,
                                               ROW_NUMBER() OVER (PARTITION BY plant_id ORDER BY measured_at DESC) AS rn
                                        FROM plants_measurements) latest_pm
                                       ON latest_pm.plant_id = p.id AND latest_pm.rn = 1
                    WHERE p.archive = 0
                """
                # WHERE measured_weight_g IS NOT NULL AND water_loss_total_pct IS NOT NULL
                params = []
                if min_water_loss_total_pct is not None:
                    query += " AND latest_pm.water_loss_total_pct > %s"
                    params.append(min_water_loss_total_pct)

                query += " ORDER BY p.sort_order ASC, p.created_at DESC, p.name ASC"

                cur.execute(query, params)

                rows = cur.fetchall() or []
                results: list[dict] = []
                now = datetime.utcnow()
                for idx, row in enumerate(rows, start=1):
                    pid = row[0]
                    name = row[1]
                    notes = row[2]
                    species_name = row[3]
                    min_dry_weight_g = row[4] # 𝑊𝑑: Dry weight = pot + soil + plant completely dry
                    max_water_weight_g = row[5] # maximum water retained capacity
                    recommended_water_threshold_pct = row[6]
                    identify_hint = row[7]
                    location_id_bytes = row[8]
                    location_name = row[9]
                    # Prefer latest measurement time, then created_at, then now as a fallback
                    # Note: row[11] = latest_pm.measured_at, row[10] = p.created_at
                    # The previous order mistakenly preferred created_at over the latest measurement.
                    latest_at = row[11] or row[10] or now
                    measured_weight_g = row[12] # 𝑊𝑐: Current weight = weight read any day on a scale
                    last_wet_weight_g = row[13]
                    water_loss_total_pct = row[14]



                    # Calculate water retained percentage using the helper
                    water_retained_calc = calculate_water_retained(
                        min_dry_weight_g=min_dry_weight_g,
                        max_water_weight_g=max_water_weight_g,
                        measured_weight_g=measured_weight_g,
                        last_wet_weight_g=last_wet_weight_g,
                        water_loss_total_pct=water_loss_total_pct
                    )
                    water_retained_pct = water_retained_calc.water_retained_pct

                    # watering threshold (plant-dependent). Typical thresholds:
                    # Seedlings / moisture-loving plants: water when frac ≤ 0.6 (60%)
                    # Most houseplants / balanced: water when frac ≤ 0.4 (40%)
                    # Drought-tolerant plants / succulents: water when frac ≤ 0.2 (20%)

                    uuid_hex = bin_to_hex(pid)
                    location_id_hex = bin_to_hex(location_id_bytes)

                    # Compute frequency (in days) based on watering events since last repot
                    try:
                        freq_days = compute_frequency_days(conn, uuid_hex)
                    except Exception:
                        freq_days = None

                    # Compute next watering date: last watering + frequency
                    next_watering_at = None
                    if freq_days is not None and freq_days > 0:
                        try:
                            with conn.cursor() as cur2:
                                cur2.execute(
                                    (
                                        """
                                        SELECT measured_at
                                        FROM plants_measurements
                                        WHERE plant_id = UNHEX(%s)
                                          AND measured_weight_g IS NULL
                                          AND water_loss_total_pct = 0
                                        ORDER BY measured_at DESC
                                        LIMIT 1
                                        """
                                    ),
                                    (uuid_hex,),
                                )
                                last_row = cur2.fetchone()
                                last_watering_at = last_row[0] if last_row else None
                                if last_watering_at:
                                    # Initial projection
                                    next_watering_at = last_watering_at + timedelta(days=int(freq_days))
                                    # If projection is in the past, roll forward by multiples of frequency
                                    try:
                                        if next_watering_at and next_watering_at < now:
                                            # How many full frequencies have elapsed since the last watering
                                            elapsed_days = (now - last_watering_at).total_seconds() / (24 * 60 * 60)
                                            steps = max(1, ceil(elapsed_days / int(freq_days)))
                                            next_watering_at = last_watering_at + timedelta(days=int(freq_days) * steps)
                                    except Exception:
                                        # Keep the initial projection if any math fails
                                        pass
                        except Exception:
                            next_watering_at = None

                    results.append({
                        "id": idx,  # synthetic index for UI
                        "uuid": uuid_hex,
                        "name": name,
                        "notes": notes,
                        "species": species_name,
                        "min_dry_weight_g": min_dry_weight_g,
                        "max_water_weight_g": max_water_weight_g,
                        "location": location_name,
                        "location_id": location_id_hex,
                        "latest_at": latest_at,
                        "measured_weight_g": measured_weight_g,
                        "water_loss_total_pct": water_loss_total_pct,
                        "water_retained_pct": round(water_retained_pct, 0) if water_retained_pct is not None else None,
                        "recommended_water_threshold_pct": recommended_water_threshold_pct if recommended_water_threshold_pct is not None else None,
                        "identify_hint": identify_hint if identify_hint is not None else None,
                        "frequency_days": int(freq_days) if freq_days is not None else None,
                        "next_watering_at": next_watering_at,
                    })
                return results
        finally:
            try:
                conn.close()
            except Exception:
                pass