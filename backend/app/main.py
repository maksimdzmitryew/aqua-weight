from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from datetime import datetime
from starlette.concurrency import run_in_threadpool
import os
import pymysql
import uuid

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


def get_db_connection():
    host = os.getenv("DB_HOST", "db")
    user = os.getenv("DB_USER", "appuser")
    password = os.getenv("DB_PASSWORD", "apppass")
    database = os.getenv("DB_NAME", "appdb")
    return pymysql.connect(host=host, user=user, password=password, database=database, autocommit=True)


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


class LocationUpdateByName(BaseModel):
    original_name: str
    name: str


@app.put("/locations/by-name")
async def update_location_by_name(payload: LocationUpdateByName):
    if not payload.name.strip():
        raise HTTPException(status_code=400, detail="Name cannot be empty")

    def do_update():
        conn = get_db_connection()
        try:
            with conn.cursor() as cur:
                # Update only the name field; 'type' field is not present in DB schema.
                new_name = payload.name.strip()
                orig_name = payload.original_name.strip()
                cur.execute(
                    "UPDATE locations SET name=%s WHERE name=%s",
                    (new_name, orig_name),
                )
                affected = cur.rowcount
                created = False
                if affected == 0:
                    # If no existing row with original name, insert a new one
                    new_id = uuid.uuid4().bytes  # 16 bytes for BINARY(16)
                    cur.execute(
                        "INSERT INTO locations (id, name) VALUES (%s, %s)",
                        (new_id, new_name),
                    )
                    affected = 1
                    created = True
            return affected, created
        finally:
            conn.close()

    try:
        affected, created = await run_in_threadpool(do_update)
    except pymysql.err.IntegrityError:
        # Unique constraint violation on name
        raise HTTPException(status_code=409, detail="Location name already exists")

    return {"ok": True, "rows_affected": affected, "name": payload.name, "created": created}
