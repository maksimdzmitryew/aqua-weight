"""Load test for AW API endpoints."""

from locust import HttpUser, task, between, events
import json


class AWLoadTestUser(HttpUser):
    """Simulates a typical user interacting with the AW API."""

    wait_time = between(0.5, 2.0)  # Wait 0.5-2s between tasks
    host = "http://localhost:8000/api"

    def on_start(self):
        """Login and get access token before starting tasks."""
        # Reset and seed test data
        self.client.post("/test/reset")
        self.client.post("/test/seed")

        resp = self.client.post("/test/login")
        data = resp.json()
        self.token = data["access_token"]
        self.headers = {"Authorization": f"Bearer {self.token}"}

    @task(5)
    def list_plants(self):
        """List plants — the most frequent operation."""
        self.client.get("/plants?page=1&limit=20", headers=self.headers)

    @task(3)
    def list_plants_with_search(self):
        """List plants with search filter."""
        self.client.get("/plants?page=1&limit=20&search=fern", headers=self.headers)

    @task(2)
    def get_watering_approximation(self):
        """Get watering approximation for all plants."""
        self.client.get(
            "/plants/measurements/approximation/watering",
            headers=self.headers,
        )

    @task(1)
    def get_plant_detail(self):
        """Get plant detail (requires a known UUID from seed data)."""
        self.client.get(
            "/plants?page=1&limit=1&status=active",
            headers=self.headers,
        )

    @task(1)
    def create_weight_measurement(self):
        """Create a weight measurement."""
        resp = self.client.get(
            "/plants?page=1&limit=1&status=active",
            headers=self.headers,
        )
        data = resp.json()
        if data.get("items"):
            plant_uuid = data["items"][0]["uuid"]
            self.client.post(
                f"/plants/{plant_uuid}/measurements/weight",
                json={
                    "measured_weight_g": 150,
                    "measured_at": "2024-01-01T12:00",
                },
                headers={**self.headers, "Content-Type": "application/json"},
            )


# Custom event to print summary
@events.quitting.add_listener
def on_quitting(environment, **kwargs):
    stats = environment.runner.stats

    print("\n" + "=" * 60)
    print("LOAD TEST SUMMARY")
    print("=" * 60)

    for key in stats.entries:
        entry = stats.entries[key]
        print(f"\n{entry.method} {entry.name}:")
        print(f"  Requests: {entry.num_requests}")
        print(f"  Failures: {entry.num_failures}")
        print(f"  Median:   {entry.median_response_time:.1f} ms")
        print(f"  95th %ile: {entry.get_response_time_percentile(0.95):.1f} ms")
        print(f"  99th %ile: {entry.get_response_time_percentile(0.99):.1f} ms")
        print(f"  Avg:      {entry.avg_response_time:.1f} ms")
        print(f"  Min:      {entry.min_response_time:.1f} ms")
        print(f"  Max:      {entry.max_response_time:.1f} ms")

    print("=" * 60)
