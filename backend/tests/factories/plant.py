import factory
from faker import Faker

fake = Faker()


class PlantFactory(factory.Factory):
    class Meta:
        model = dict

    id = factory.Sequence(lambda n: n + 1)
    uuid = factory.LazyFunction(lambda: fake.hexify(text='^' + '^[0-9a-f]{32}$'.strip('^$')))
    name = factory.Faker("word")
    description = factory.Maybe(
        factory.Faker("pybool"),
        yes_declaration=factory.Faker("sentence"),
        no_declaration=None,
    )
    species = factory.Maybe(
        factory.Faker("pybool"),
        yes_declaration=factory.Faker("word"),
        no_declaration=None,
    )
    location = factory.Maybe(
        factory.Faker("pybool"),
        yes_declaration=factory.Faker("city"),
        no_declaration=None,
    )
    location_id = factory.LazyFunction(lambda: fake.hexify(text='^' + '^[0-9a-f]{32}$'.strip('^$')))
    created_at = factory.Faker("date_time_this_year")
    water_loss_total_pct = factory.Maybe(
        factory.Faker("pybool"),
        yes_declaration=factory.Faker("pyfloat", left_digits=1, right_digits=2, positive=True),
        no_declaration=None,
    )
