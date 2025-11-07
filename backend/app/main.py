from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from .errors import register_exception_handlers
from .routes.repotting import app as repotting_app
from .routes.daily import app as daily_app
from .routes.health import app as health_app
from .routes.plants import app as plants_app
from .routes.locations import app as locations_app
from .routes.measurements import app as measurements_app

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

# Include routers
app.include_router(repotting_app)
app.include_router(daily_app)
app.include_router(health_app)
app.include_router(plants_app)
app.include_router(locations_app)
app.include_router(measurements_app)
