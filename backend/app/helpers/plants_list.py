# app/helpers/plants_list.py
from datetime import datetime
from ..db import get_conn, bin_to_hex

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
                           p.description,
                           p.species_name,
                           p.min_dry_weight_g,
                           p.max_water_weight_g,
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
                                        FROM plants_measurements
                                        WHERE last_wet_weight_g IS NOT NULL) latest_pm
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
                    description = row[2]
                    species_name = row[3]
                    location_id_bytes = row[6]
                    location_name = row[7]
                    # Prefer latest measurement time, then created_at, then now
                    created_at = row[9] or row[8] or now
                    last_wet_weight_g = row[11]
                    water_loss_total_pct = row[12]

                    min_dry_weight_g = row[4] # 𝑊𝑑: Dry weight = pot + soil + plant completely dry
                    max_water_weight_g = row[5] # maximum water retained capacity
                    measured_weight_g = row[10] # 𝑊𝑐: Current weight = weight read any day on a scale

                    # 𝑊𝑐 − 𝑊𝑑
                    # likely a watering event
                    if measured_weight_g is None:
                        water_remain_g = last_wet_weight_g - min_dry_weight_g
                    # regular measurement event
                    else:
                        water_remain_g = measured_weight_g - min_dry_weight_g

                    if min_dry_weight_g != measured_weight_g:
                        # Wfc: Saturated weight / field capacity
                        # weight right after thoroughly watering and allowing free drainage to stop
                        saturated_weight_g = min_dry_weight_g + max_water_weight_g

                        # AWC = 𝑊𝑓𝑐 − 𝑊𝑑: available water at field capacity
                        available_water_g = saturated_weight_g - min_dry_weight_g
                        # frac = 𝑊𝑐 − 𝑊𝑑 / Wfc − 𝑊𝑑
                        # current fraction of AWC remaining
                        frac_ratio = water_remain_g / available_water_g
                        water_retained_pct = frac_ratio * 100
                    else:
                        water_retained_pct = 100 - water_loss_total_pct

                    # watering threshold (plant-dependent). Typical thresholds:
                    # Seedlings / moisture-loving plants: water when frac ≤ 0.6 (60%)
                    # Most houseplants / balanced: water when frac ≤ 0.4 (40%)
                    # Drought-tolerant plants / succulents: water when frac ≤ 0.2 (20%)

                    uuid_hex = bin_to_hex(pid)
                    location_id_hex = bin_to_hex(location_id_bytes)

                    results.append({
                        "id": idx,  # synthetic index for UI
                        "uuid": uuid_hex,
                        "name": name,
                        # f"min_dry_weight_g {min_dry_weight_g} + max_water_weight_g {max_water_weight_g} = Wfc {saturated_weight_g}; measured_weight_g {measured_weight_g}; AWC_g {available_water_g} frac_ratio {frac_ratio}"
                        "description": description,
                        "species": species_name,
                        "min_dry_weight_g": min_dry_weight_g,
                        "max_water_weight_g": max_water_weight_g,
                        "location": location_name,
                        "location_id": location_id_hex,
                        "created_at": created_at,
                        "measured_weight_g": measured_weight_g,
                        "water_loss_total_pct": water_loss_total_pct,
                        "water_retained_pct": round(water_retained_pct, 0),
                    })
                return results
        finally:
            try:
                conn.close()
            except Exception:
                pass