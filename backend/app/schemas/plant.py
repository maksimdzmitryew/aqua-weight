from datetime import datetime
from typing import TYPE_CHECKING, Annotated, List, Optional

from pydantic import BaseModel, Field, StringConstraints, constr

# For mypy: use a simple alias during type checking; keep runtime validation with pydantic
if TYPE_CHECKING:
    HexID = str
else:
    HexID = constr(pattern=r"^[0-9a-f]{32}$")


class ReferenceItem(BaseModel):
    uuid: HexID
    name: str


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
    # Calculated scheduling
    frequency_days: Optional[int] = None
    frequency_confidence: Optional[int] = None
    next_watering_at: Optional[datetime] = None
    first_calculated_at: Optional[datetime] = None
    days_offset: Optional[int] = None
    needs_weighing: bool = False
    archive: int = 0


class PlantDetail(BaseModel):
    id: int
    uuid: Optional[HexID] = None
    # General
    name: str
    plant_type: Optional[str] = None
    identify_hint: Optional[str] = None
    typical_action: Optional[str] = None
    description: Optional[str] = None
    notes: Optional[str] = None
    location_id: Optional[HexID] = None
    location: Optional[str] = None
    photo_url: Optional[str] = None
    # Service
    default_measurement_method_id: Optional[HexID] = None
    scale_id: Optional[HexID] = None
    sort_order: int = 0
    repotted: int = 0
    archive: int = 0
    # Care
    recommended_water_threshold_pct: Optional[int] = None
    biomass_weight_g: Optional[int] = None
    biomass_last_at: Optional[datetime] = None
    # Advanced
    species_name: Optional[str] = None
    botanical_name: Optional[str] = None
    cultivar: Optional[str] = None
    substrate_type_id: Optional[HexID] = None
    substrate_last_refresh_at: Optional[datetime] = None
    fertilized_last_at: Optional[datetime] = None
    fertilizer_ec_ms: Optional[float] = None
    # Health
    light_level_id: Optional[HexID] = None
    pest_status_id: Optional[HexID] = None
    health_status_id: Optional[HexID] = None
    # Calculated
    min_dry_weight_g: Optional[int] = None
    max_water_weight_g: Optional[int] = None
    # System
    created_at: datetime
    water_loss_total_pct: Optional[float] = None


class PlantCreateRequest(BaseModel):
    # Minimum fields; all but name are optional
    # General
    name: Annotated[str, StringConstraints(max_length=120)]
    plant_type: Optional[
        Annotated[str, StringConstraints(strip_whitespace=True, max_length=80)]
    ] = None
    identify_hint: Optional[
        Annotated[str, StringConstraints(strip_whitespace=True, max_length=140)]
    ] = None
    typical_action: Optional[
        Annotated[str, StringConstraints(strip_whitespace=True, max_length=140)]
    ] = None
    description: Optional[
        Annotated[str, StringConstraints(strip_whitespace=True, max_length=2000)]
    ] = None
    notes: Optional[Annotated[str, StringConstraints(strip_whitespace=True, max_length=4000)]] = (
        None
    )
    location_id: Optional[HexID] = None
    photo_url: Optional[
        Annotated[str, StringConstraints(strip_whitespace=True, max_length=2048)]
    ] = None
    # Service
    default_measurement_method_id: Optional[HexID] = None
    scale_id: Optional[HexID] = None
    sort_order: Optional[int] = Field(default=0, ge=0)
    repotted: Optional[int] = Field(default=0, ge=0, le=1)
    archive: Optional[int] = Field(default=0, ge=0, le=1)
    # Care
    recommended_water_threshold_pct: Optional[int] = None
    biomass_weight_g: Optional[int] = None
    biomass_last_at: Optional[
        Annotated[str, StringConstraints(strip_whitespace=True, max_length=32)]
    ] = None
    # Advanced
    species_name: Optional[
        Annotated[str, StringConstraints(strip_whitespace=True, max_length=120)]
    ] = None
    botanical_name: Optional[
        Annotated[str, StringConstraints(strip_whitespace=True, max_length=120)]
    ] = None
    cultivar: Optional[Annotated[str, StringConstraints(strip_whitespace=True, max_length=120)]] = (
        None
    )
    substrate_type_id: Optional[HexID] = None
    substrate_last_refresh_at: Optional[
        Annotated[str, StringConstraints(strip_whitespace=True, max_length=32)]
    ] = None
    fertilized_last_at: Optional[
        Annotated[str, StringConstraints(strip_whitespace=True, max_length=32)]
    ] = None
    fertilizer_ec_ms: Optional[float] = Field(default=None, ge=0)
    # Health
    light_level_id: Optional[HexID] = None
    pest_status_id: Optional[HexID] = None
    health_status_id: Optional[HexID] = None
    # Calculated
    min_dry_weight_g: Optional[int] = None
    max_water_weight_g: Optional[int] = None


class PlantUpdateRequest(BaseModel):
    # General
    name: Optional[Annotated[str, StringConstraints(strip_whitespace=True, max_length=120)]] = None
    plant_type: Optional[
        Annotated[str, StringConstraints(strip_whitespace=True, max_length=80)]
    ] = None
    identify_hint: Optional[
        Annotated[str, StringConstraints(strip_whitespace=True, max_length=140)]
    ] = None
    typical_action: Optional[
        Annotated[str, StringConstraints(strip_whitespace=True, max_length=140)]
    ] = None
    description: Optional[
        Annotated[str, StringConstraints(strip_whitespace=True, max_length=2000)]
    ] = None
    notes: Optional[Annotated[str, StringConstraints(strip_whitespace=True, max_length=4000)]] = (
        None
    )
    location_id: Optional[HexID] = None
    photo_url: Optional[
        Annotated[str, StringConstraints(strip_whitespace=True, max_length=2048)]
    ] = None
    # Service
    default_measurement_method_id: Optional[HexID] = None
    scale_id: Optional[HexID] = None
    sort_order: Optional[int] = Field(default=None, ge=0)
    repotted: Optional[int] = Field(default=None, ge=0, le=1)
    archive: Optional[int] = Field(default=None, ge=0, le=1)
    # Care
    recommended_water_threshold_pct: Optional[int] = Field(default=None, ge=0, le=100)
    biomass_weight_g: Optional[int] = None
    biomass_last_at: Optional[
        Annotated[str, StringConstraints(strip_whitespace=True, max_length=32)]
    ] = None
    # Advanced
    species_name: Optional[
        Annotated[str, StringConstraints(strip_whitespace=True, max_length=120)]
    ] = None
    botanical_name: Optional[
        Annotated[str, StringConstraints(strip_whitespace=True, max_length=120)]
    ] = None
    cultivar: Optional[Annotated[str, StringConstraints(strip_whitespace=True, max_length=120)]] = (
        None
    )
    substrate_type_id: Optional[HexID] = None
    substrate_last_refresh_at: Optional[
        Annotated[str, StringConstraints(strip_whitespace=True, max_length=32)]
    ] = None
    fertilized_last_at: Optional[
        Annotated[str, StringConstraints(strip_whitespace=True, max_length=32)]
    ] = None
    fertilizer_ec_ms: Optional[float] = Field(default=None, ge=0)
    # Health
    light_level_id: Optional[HexID] = None
    pest_status_id: Optional[HexID] = None
    health_status_id: Optional[HexID] = None
    # Calculated
    min_dry_weight_g: Optional[int] = Field(default=None, ge=0)
    max_water_weight_g: Optional[int] = Field(default=None, ge=0)


class CalibrationEntry(BaseModel):
    id: Optional[str] = None
    measured_at: Optional[str] = None
    water_added_g: Optional[int] = None
    last_wet_weight_g: Optional[int] = None
    target_weight_g: Optional[int] = None
    under_g: Optional[int] = None
    under_pct: Optional[float] = None


class CalibrationData(BaseModel):
    max_water_retained: List[CalibrationEntry]
    min_dry_weight: List[CalibrationEntry]


class PlantCalibrationItem(PlantListItem):
    calibration: CalibrationData


class PaginatedPlantsResponse(BaseModel):
    """Response model for paginated plants list with drift detection support."""

    items: List[PlantListItem]
    total: int = Field(description="Total count of plants matching filters")
    global_total: int = Field(description="Total count of ALL active plants (for drift detection)")
    page: int = Field(ge=1, description="Current page number")
    limit: int = Field(ge=1, le=100, description="Items per page")
    total_pages: int = Field(ge=0, description="Total number of pages")
