import os as _os

from fastapi import APIRouter, Depends, FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.openapi.docs import get_redoc_html, get_swagger_ui_html
from fastapi.openapi.utils import get_openapi
from fastapi.responses import JSONResponse

from .errors import register_exception_handlers
from .routes.admin import router as admin_router
from .routes.auth import router as auth_router
from .routes.health import app as health_app
from .routes.locations import app as locations_app
from .routes.measurements import app as measurements_app
from .routes.plants import app as plants_app
from .routes.repotting import app as repotting_app
from .routes.settings import router as settings_router
from .routes.test_admin import app as test_admin_app
from .routes.whatsapp import router as whatsapp_router
from .security import require_authenticated_user
from prometheus_fastapi_instrumentator import Instrumentator

APP_ENV = _os.getenv("APP_ENV", "development").lower()
TEST_MODE = _os.getenv("TEST_MODE") == "1"
MAX_BODY_BYTES = int(_os.getenv("MAX_BODY_BYTES", "1048576"))
API_VERSION = _os.getenv("API_VERSION", "1.0.0")

if TEST_MODE and APP_ENV not in {"test", "development", "local"}:
    raise RuntimeError("TEST_MODE=1 is only allowed in test/dev environments")

app = FastAPI(docs_url=None, redoc_url=None, openapi_url=None)

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
internal_auth_router.include_router(settings_router)
internal_auth_router.include_router(admin_router)
internal_auth_router.include_router(whatsapp_router)

# Versioned router (v1)
v1 = APIRouter()
v1.include_router(infrastructure_router)
v1.include_router(auth_router, prefix="/auth", tags=["auth"])
v1.include_router(internal_auth_router)

# Test admin endpoints (unauthenticated, protected by TEST_MODE check in handlers)
if TEST_MODE:
    v1.include_router(test_admin_app)


@v1.get("/docs", include_in_schema=False)
async def v1_docs():
    return get_swagger_ui_html(openapi_url="/api/v1/openapi.json", title="API v1 Docs")


@v1.get("/redoc", include_in_schema=False)
async def v1_redoc():
    return get_redoc_html(openapi_url="/api/v1/openapi.json", title="API v1 ReDoc")


@v1.get("/openapi.json", include_in_schema=False)
async def v1_openapi():
    return JSONResponse(get_openapi(title="API v1", version=API_VERSION, routes=v1.routes))


# Mount v1 under both /api/v1 and /api alias (Double Mount)
app.include_router(v1, prefix="/api/v1")
app.include_router(v1, prefix="/api")

# Also mount infrastructure routes at root for top-level /health consolidation
app.include_router(infrastructure_router)

# Prometheus instrumentation
Instrumentator().instrument(app).expose(app, endpoint="/metrics", include_in_schema=False)
