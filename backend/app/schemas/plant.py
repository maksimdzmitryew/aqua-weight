from typing import Optional
from datetime import datetime
from pydantic import BaseModel, Field, constr

HexID = constr(pattern=r"^[0-9a-f]{32}$")

class PlantListItem(BaseModel):
    id: int
    uuid: Optional[HexID] = None
    name: str
    notes: Optional[str] = None
    species: Optional[str] = None
    min_dry_weight_g: Optional[int] = None
    max_water_weight_g: Optional[int] = None
    location: Optional[str] = None
    location_id: Optional[HexID] = None
    latest_at: datetime
    measured_weight_g: Optional[int] = None
    water_loss_total_pct: Optional[float] = None
    water_retained_pct: Optional[float] = None
    recommended_water_threshold_pct: Optional[int] = None
    identify_hint: Optional[str] = None

class PlantDetail(BaseModel):
    id: int
    uuid: Optional[HexID] = None
    name: str
    notes: Optional[str] = None
    species: Optional[str] = None
    min_dry_weight_g: Optional[int] = None
    max_water_weight_g: Optional[int] = None
    location: Optional[str] = None
    location_id: Optional[HexID] = None
    created_at: datetime
    water_loss_total_pct: Optional[float] = None

class PlantCreateRequest(BaseModel):
    # Minimum fields; all but name are optional
    # General
    name: str
    plant_type: Optional[str] = None
    identify_hint: Optional[str] = None
    typical_action: Optional[str] = None
    description: Optional[str] = None
    notes: Optional[str] = None
    location_id: Optional[HexID] = None
    photo_url: Optional[str] = None
    # Service
    default_measurement_method_id: Optional[HexID] = None
    # Care
    recommended_water_threshold_pct: Optional[int] = None
    biomass_weight_g: Optional[int] = None
    biomass_last_at: Optional[str] = None
    # Advanced
    species_name: Optional[str] = None
    botanical_name: Optional[str] = None
    cultivar: Optional[str] = None
    substrate_type_id: Optional[HexID] = None
    substrate_last_refresh_at: Optional[str] = None
    fertilized_last_at: Optional[str] = None
    fertilizer_ec_ms: Optional[float] = Field(default=None, ge=0)
    # Health
    light_level_id: Optional[HexID] = None
    pest_status_id: Optional[HexID] = None
    health_status_id: Optional[HexID] = None
    # Calculated
    min_dry_weight_g: Optional[int] = None
    max_water_weight_g: Optional[int] = None

class PlantUpdateRequest(BaseModel):
    name: Optional[str] = None
    description: Optional[str] = None
    location_id: Optional[HexID] = None
    photo_url: Optional[str] = None
    default_measurement_method_id: Optional[HexID] = None
    species_name: Optional[str] = None
    botanical_name: Optional[str] = None
    cultivar: Optional[str] = None
    substrate_type_id: Optional[HexID] = None
    substrate_last_refresh_at: Optional[str] = None
    fertilized_last_at: Optional[str] = None
    fertilizer_ec_ms: Optional[float] = Field(default=None, ge=0)
    min_dry_weight_g: Optional[int] = Field(default=None, ge=0)
    light_level_id: Optional[HexID] = None
    pest_status_id: Optional[HexID] = None
    health_status_id: Optional[HexID] = None
