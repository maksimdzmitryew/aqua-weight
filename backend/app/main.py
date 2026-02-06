import os as _os

from fastapi import APIRouter, Depends, FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from .errors import register_exception_handlers
from .routes.health import app as health_app
from .routes.locations import app as locations_app
from .routes.measurements import app as measurements_app
from .routes.plants import app as plants_app
from .routes.repotting import app as repotting_app
from .routes.test_admin import app as test_admin_app
from .security import require_api_key

APP_ENV = _os.getenv("APP_ENV", "development").lower()
TEST_MODE = _os.getenv("TEST_MODE") == "1"
MAX_BODY_BYTES = int(_os.getenv("MAX_BODY_BYTES", "1048576"))

if TEST_MODE and APP_ENV not in {"test", "development", "local"}:
    raise RuntimeError("TEST_MODE=1 is only allowed in test/dev environments")

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
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.middleware("http")
async def enforce_body_size(request: Request, call_next):
    if request.method in {"POST", "PUT", "PATCH"}:
        body = await request.body()
        if len(body) > MAX_BODY_BYTES:
            return JSONResponse(status_code=413, content={"detail": "Request too large"})
    return await call_next(request)

# Mount all routers under /api
api_router = APIRouter(prefix="/api", dependencies=[Depends(require_api_key)])
api_router.include_router(repotting_app)
api_router.include_router(health_app)
api_router.include_router(plants_app)
api_router.include_router(locations_app)
api_router.include_router(measurements_app)

# Conditionally include test admin endpoints when TEST_MODE=1
if _os.getenv("TEST_MODE") == "1":
    api_router.include_router(test_admin_app)

app.include_router(api_router)


# Top-level health endpoint for container health checks and uptime probes
@app.get("/health")
async def health_root():
    return {"status": "ok"}
