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
                           p.location_id,
                           COALESCE(l.name, NULL) AS location_name,
                           p.created_at,
                           latest_pm.measured_at,
                           latest_pm.water_loss_total_pct
                    FROM plants p
                             LEFT JOIN locations l ON l.id = p.location_id
                             LEFT JOIN (SELECT measured_at, plant_id,
                                               water_loss_total_pct,
                                               ROW_NUMBER() OVER (PARTITION BY plant_id ORDER BY measured_at DESC) AS rn
                                        FROM plants_measurements
                                        WHERE water_loss_total_pct IS NOT NULL) latest_pm
                                       ON latest_pm.plant_id = p.id AND latest_pm.rn = 1
                    WHERE p.archive = 0
                """
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
                    location_id_bytes = row[4]
                    location_name = row[5]
                    # Prefer latest measurement time, then created_at, then now
                    created_at = row[7] or row[6] or now
                    water_loss_total_pct = row[8]

                    uuid_hex = bin_to_hex(pid)
                    location_id_hex = bin_to_hex(location_id_bytes)

                    results.append({
                        "id": idx,  # synthetic index for UI
                        "uuid": uuid_hex,
                        "name": name,
                        "description": description,
                        "species": species_name,
                        "location": location_name,
                        "location_id": location_id_hex,
                        "created_at": created_at,
                        "water_loss_total_pct": water_loss_total_pct,
                    })
                return results
        finally:
            try:
                conn.close()
            except Exception:
                pass