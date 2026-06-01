import os as _os

from fastapi import APIRouter, Depends, FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from .errors import register_exception_handlers
from .routes.auth import router as auth_router
from .routes.health import app as health_app
from .routes.locations import app as locations_app
from .routes.measurements import app as measurements_app
from .routes.plants import app as plants_app
from .routes.repotting import app as repotting_app
from .routes.test_admin import app as test_admin_app
from .security import require_authenticated_user

APP_ENV = _os.getenv("APP_ENV", "development").lower()
TEST_MODE = _os.getenv("TEST_MODE") == "1"
MAX_BODY_BYTES = int(_os.getenv("MAX_BODY_BYTES", "1048576"))
API_VERSION = _os.getenv("API_VERSION", "1.0.0")

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
    allow_credentials=True,
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


# Infrastructure routes (public)
infrastructure_router = APIRouter()
infrastructure_router.include_router(health_app)


@infrastructure_router.get("/bootstrap")
async def bootstrap():
    return {"version": API_VERSION}

# Domain routes (protected)
internal_auth_router = APIRouter(dependencies=[Depends(require_authenticated_user)])
internal_auth_router.include_router(repotting_app)
internal_auth_router.include_router(plants_app)
internal_auth_router.include_router(locations_app)
internal_auth_router.include_router(measurements_app)

# Conditionally include test admin endpoints when TEST_MODE=1
if _os.getenv("TEST_MODE") == "1":
    internal_auth_router.include_router(test_admin_app)

# Versioned router (v1)
v1 = APIRouter()
v1.include_router(infrastructure_router)
v1.include_router(auth_router, prefix="/auth", tags=["auth"])
v1.include_router(internal_auth_router)

# Mount v1 under both /api/v1 and /api alias (Double Mount)
app.include_router(v1, prefix="/api/v1")
app.include_router(v1, prefix="/api")

# Also mount infrastructure routes at root for top-level /health consolidation
app.include_router(infrastructure_router)
