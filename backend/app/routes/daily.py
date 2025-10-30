from fastapi import APIRouter

app = APIRouter()

# Placeholder endpoint for future bulk measurement features
@app.get("/api/daily/health")
async def daily_health():
    return {"status": "ok"}

@app.get("/api/daily")
async def daily_care():
    return {
        "status": "ok",
        "items": [
            {
                "id": 1,
                "uuid": "8c4b8b9d-3c3a-4a5d-8b6b-1f2e3d4c5b6a",
                "plant_name": "Fiddle Leaf Fig",
                "type": "Fertilize",
                "scheduled_for": "2025-10-30",
                "reason": "Monthly feed"
            },
            {"id": 2, "plant_name": "Monstera", "task": "Water", "when": "Today", "notes": "Dry 2cm"},
            {"id": 3, "plant_name": "Aloe Vera", "task": "Fertilize", "when": "2025-11-01"}
        ]
    }
