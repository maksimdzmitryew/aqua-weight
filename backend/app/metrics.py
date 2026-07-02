"""Prometheus custom business metrics."""

from prometheus_client import Counter, Gauge

# Business-level metrics
watering_events_total = Counter(
    "aw_watering_events_total",
    "Total number of watering events created",
    ["mode"],  # manual, automatic, vacation
)

measurements_total = Counter(
    "aw_measurements_total",
    "Total number of weight measurements created",
)

plants_with_prediction = Gauge(
    "aw_plants_needing_water",
    "Number of plants currently predicted to need watering",
)
