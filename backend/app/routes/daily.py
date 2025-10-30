from fastapi import APIRouter, Query
from datetime import datetime
from ..helpers.plants_list import PlantsList
app = APIRouter()

# Placeholder endpoint for future bulk measurement features
@app.get("/api/daily/health")
async def daily_health():
    return {"status": "ok"}

@app.get("/api/daily")
async def daily_care(min_water_loss_total_pct: float = Query(70, description="Minimum water loss percentage to filter plants")):
    plants = PlantsList.fetch_all(min_water_loss_total_pct)
    print(plants)
    return {
        "status": "ok",
        "items": plants
    }
