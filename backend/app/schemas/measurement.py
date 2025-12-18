from typing import List, Optional

from pydantic import BaseModel, Field, constr

HexID = constr(pattern=r"^[0-9a-f]{32}$")


# Generic measurement requests
class MeasurementCreateRequest(BaseModel):
    plant_id: HexID
    measured_at: str
    measured_weight_g: Optional[int] = Field(default=None, ge=0)
    method_id: Optional[HexID] = None
    use_last_method: bool = False
    scale_id: Optional[HexID] = None
    note: Optional[str] = None
    last_dry_weight_g: Optional[int] = Field(default=None, ge=0)
    last_wet_weight_g: Optional[int] = Field(default=None, ge=0)
    water_added_g: Optional[int] = Field(default=None, ge=0)


class MeasurementUpdateRequest(BaseModel):
    measured_at: Optional[str] = None
    measured_weight_g: Optional[int] = Field(default=None, ge=0)
    last_dry_weight_g: Optional[int] = Field(default=None, ge=0)
    last_wet_weight_g: Optional[int] = Field(default=None, ge=0)
    water_added_g: Optional[int] = Field(default=None, ge=0)
    method_id: Optional[HexID] = None
    use_last_method: Optional[bool] = None
    scale_id: Optional[HexID] = None
    note: Optional[str] = None


# Repotting specific
class RepottingCreateRequest(BaseModel):
    plant_id: HexID
    measured_at: str
    measured_weight_g: Optional[int] = Field(default=None, ge=0)
    last_wet_weight_g: Optional[int] = Field(default=None, ge=0)
    note: Optional[str] = None


class RepottingUpdateRequest(BaseModel):
    plant_id: Optional[HexID] = None
    measured_at: Optional[str] = None
    measured_weight_g: Optional[int] = Field(default=None, ge=0)
    last_wet_weight_g: Optional[int] = Field(default=None, ge=0)
    note: Optional[str] = None


class MeasurementItem(BaseModel):
    id: Optional[HexID] = None
    measured_at: Optional[str] = None
    measured_weight_g: Optional[int] = None
    last_dry_weight_g: Optional[int] = None
    last_wet_weight_g: Optional[int] = None
    water_added_g: Optional[int] = None
    water_loss_total_pct: Optional[float] = None
    water_loss_total_g: Optional[int] = None
    water_loss_day_pct: Optional[float] = None
    water_loss_day_g: Optional[int] = None


class LastMeasurementResponse(BaseModel):
    measured_at: Optional[str] = None
    measured_weight_g: Optional[int] = None
    last_dry_weight_g: Optional[int] = None
    last_wet_weight_g: Optional[int] = None
    water_added_g: Optional[int] = None
    method_id: Optional[HexID] = None
    scale_id: Optional[HexID] = None
    note: Optional[str] = None


class MeasurementsListResponse(BaseModel):
    items: List[MeasurementItem]


class RepottingResponse(BaseModel):
    id: Optional[int] = None
    plant_id: HexID
    measured_at: str
    measured_weight_g: Optional[int] = None
    last_wet_weight_g: Optional[int] = None
    note: Optional[str] = None
