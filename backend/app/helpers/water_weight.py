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
    Always update the plant's min_dry_weight_g because the plant might not
    have a minimum weight yet or unrelated measurements (in the middle of
    measurements list) changed. PostgreSQL will itself save the effort
    and will not update the row when the value unchanged.
    Returns the new min_dry_weight_g value or None if no update was made.
    """
    try:
        # First, find the last repotting event
        last_repotting = get_last_repotting_event(conn, plant_id_hex)

        # Get current minimum
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
