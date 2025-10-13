from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from datetime import datetime

app = FastAPI()

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


class Plant(BaseModel):
    id: int
    name: str
    species: str | None = None
    location: str | None = None
    created_at: datetime


@app.get("/")
async def root():
    return {"message": "Hello World"}


@app.get("/hello/{name}")
async def say_hello(name: str):
    return {"message": f"Hello {name}"}


@app.get("/health")
async def health():
    return {"status": "ok"}


@app.get("/plants")
async def list_plants() -> list[Plant]:
    # NOTE: This is a temporary in-memory/mock response. Replace with real DB queries later.
    now = datetime.utcnow()
    data = [
        Plant(id=1, name="Monstera Deliciosa", species="Monstera deliciosa", location="Living Room", created_at=now),
        Plant(id=2, name="Snake Plant", species="Dracaena trifasciata", location="Bedroom", created_at=now),
        Plant(id=3, name="ZZ Plant", species="Zamioculcas zamiifolia", location="Office", created_at=now),
    ]
    return data



class Location(BaseModel):
    id: int
    name: str
    type: str | None = None
    created_at: datetime


@app.get("/locations")
async def list_locations() -> list[Location]:
    # Temporary mock response; replace with real DB queries later.
    now = datetime.utcnow()
    data = [
        Location(id=1, name="Living Room", type="room", created_at=now),
        Location(id=2, name="Bedroom", type="room", created_at=now),
        Location(id=3, name="Office", type="room", created_at=now),
    ]
    return data
