from fastapi import APIRouter, Query
from datetime import datetime
from ..helpers.plants_list import PlantsList
from ..schemas.plant import DailyCareResponse, PlantListItem
app = APIRouter()

# Placeholder endpoint for future bulk measurement features
@app.get("/daily/health", response_model=dict)
@app.get("/api/daily/health", response_model=dict)
async def daily_health():
    return {"status": "ok"}

@app.get("/daily", response_model=DailyCareResponse)
@app.get("/api/daily", response_model=DailyCareResponse)
async def daily_care(min_water_loss_total_pct: float = Query(70, description="Minimum water loss percentage to filter plants")):
    plants = PlantsList.fetch_all(min_water_loss_total_pct)
    # PlantsList returns list of dicts compatible with PlantListItem; FastAPI will coerce types.
    return DailyCareResponse(status="ok", items=plants)
