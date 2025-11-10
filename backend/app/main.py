from fastapi import FastAPI, APIRouter
from fastapi.middleware.cors import CORSMiddleware
from .errors import register_exception_handlers
from .routes.repotting import app as repotting_app
from .routes.daily import app as daily_app
from .routes.health import app as health_app
from .routes.plants import app as plants_app
from .routes.locations import app as locations_app
from .routes.measurements import app as measurements_app
from .routes.test_admin import app as test_admin_app

app = FastAPI()

# Register global exception handlers
register_exception_handlers(app)

# Allow frontend served at https://aw.max
origins = [
    "https://aw.max",
]

app.add_middleware(
    CORSMiddleware,
    allow_origins=origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Mount all routers under /api
api_router = APIRouter(prefix="/api")
api_router.include_router(repotting_app)
api_router.include_router(daily_app)
api_router.include_router(health_app)
api_router.include_router(plants_app)
api_router.include_router(locations_app)
api_router.include_router(measurements_app)

# Conditionally include test admin endpoints when TEST_MODE=1
import os as _os
if _os.getenv("TEST_MODE") == "1":
    api_router.include_router(test_admin_app)

app.include_router(api_router)


# Top-level health endpoint for container health checks and uptime probes
@app.get("/health")
async def health_root():
    return {"status": "ok"}
