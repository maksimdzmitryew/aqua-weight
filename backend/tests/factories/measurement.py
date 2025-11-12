import factory
from faker import Faker

fake = Faker()


class MeasurementFactory(factory.Factory):
    class Meta:
        model = dict

    id = factory.Sequence(lambda n: n + 1)
    plant_id = factory.Sequence(lambda n: n + 1)
    method = factory.Iterator(["weight", "height", "leaf_count"])  # example methods
    measured_at = factory.Faker("date_time_this_year")
    # For weight method, include grams; for others, use optional fields
    weight_g = factory.Maybe(
        factory.Faker("pybool"),
        yes_declaration=factory.Faker("pyint", min_value=10, max_value=5000),
        no_declaration=None,
    )
    notes = factory.Maybe(
        factory.Faker("pybool"),
        yes_declaration=factory.Faker("sentence"),
        no_declaration=None,
    )
