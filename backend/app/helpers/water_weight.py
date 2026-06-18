from typing import Optional

from .last_repotting import get_last_repotting_event
from .watering_maximum import calculate_max_watering_added_g
from .weight_minimum import calculate_min_dry_weight_g


def update_min_dry_weight_and_max_watering_added_g(
    conn,
    plant_id_hex: str,
    new_measured_weight_g: Optional[int],
    new_added_watering_g: Optional[int],
) -> None:
    """
    Update the plant's min_dry_weight_g and max_water_weight_g based on
    measurement data, but only when the user has not explicitly set these
    values. If the plant already has non-None values for min_dry_weight_g or
    max_water_weight_g, they are preserved as the user's intentional
    configuration. PostgreSQL will itself save the effort and will not
    update the row when the value unchanged.
    """
    try:
        # Check if the user has explicitly set these values
        with conn.cursor() as cur:
            cur.execute(
                "SELECT min_dry_weight_g, max_water_weight_g FROM plants WHERE id = UNHEX(%s)",
                (plant_id_hex,),
            )
            row = cur.fetchone()
            user_min_dry = row[0] if row else None
            user_max_water = row[1] if row else None

        # First, find the last repotting event
        last_repotting = get_last_repotting_event(conn, plant_id_hex)

        # Get current minimum from measurements
        current_weight_min = calculate_min_dry_weight_g(conn, plant_id_hex, last_repotting)
        current_watering_max = calculate_max_watering_added_g(conn, plant_id_hex, last_repotting)

        # If there's no current minimum or the new weight is lower, update it
        if current_weight_min is None or (
            new_measured_weight_g is not None and new_measured_weight_g < current_weight_min
        ):
            current_weight_min = new_measured_weight_g

        if current_watering_max is None or (
            new_added_watering_g is not None and new_added_watering_g > current_watering_max
        ):
            current_watering_max = new_added_watering_g

        # Respect user-set values: don't overwrite explicit configuration
        if user_min_dry is not None:
            current_weight_min = user_min_dry
        if user_max_water is not None:
            current_watering_max = user_max_water

        # Update the plant's min_dry_weight_g and max_water_weight_g
        with conn.cursor() as cur:
            cur.execute(
                """
                UPDATE plants
                SET
                    min_dry_weight_g = %s,
                    max_water_weight_g = %s
                WHERE id = UNHEX(%s)
                """,
                (current_weight_min, current_watering_max, plant_id_hex),
            )
        conn.commit()
    except Exception as e:
        print(
            "Could not update weight and waterings: ",
            e,
        )
