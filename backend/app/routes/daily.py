from fastapi import APIRouter

app = APIRouter()

# Placeholder endpoint for future bulk measurement features
@app.get("/api/daily/health")
async def daily_health():
    return {"status": "ok"}

@app.get("/api/daily")
async def daily_care():
    return {"status": "ok"}