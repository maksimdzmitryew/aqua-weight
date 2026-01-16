from datetime import datetime, timedelta
from typing import Optional

def needs_weighing(last_measured_at: Optional[datetime], mode: str) -> bool:
    """
    Determines if a plant needs weighing.
    
    Logic:
    - In "vacation" mode: No plants need weighing.
    - In "automatic" or "manual" modes: Plants need weighing if they haven't been
      weighed in more than 18 hours.
    
    :param last_measured_at: The datetime of the last measurement.
    :param mode: The current operation mode ('manual', 'automatic', 'vacation').
    :return: True if the plant needs weighing.
    """
    if mode == "vacation":
        return False
    
    if not last_measured_at:
        return True
    
    # Check if more than 18 hours have passed since last_measured_at
    threshold = datetime.utcnow() - timedelta(hours=18)
    return last_measured_at < threshold
