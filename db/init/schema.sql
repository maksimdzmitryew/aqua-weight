-- Schema initialization for AW project
-- Implements normalized schema for plant weight tracking per requirements
-- ULIDs are stored as BINARY(16) (Crockford ULID decoded to 128-bit) for compact keys

-- Ensure database is selected (MariaDB sets it via MARIADB_DATABASE env)
-- You can uncomment the following line and set your DB name if running manually
-- USE appdb;

-- Reference tables (normalized categories)
CREATE TABLE IF NOT EXISTS health_statuses (
  id BINARY(16) NOT NULL,
  name VARCHAR(100) NOT NULL,
  description TEXT NULL,
  sort_order INT UNSIGNED NOT NULL DEFAULT 0,
  created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  updated_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
  PRIMARY KEY (id),
  UNIQUE KEY uq_health_statuses_name (name)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_uca1400_ai_ci;

CREATE TABLE IF NOT EXISTS event_types (
  id BINARY(16) NOT NULL,
  name VARCHAR(100) NOT NULL,
  description TEXT NULL,
  sort_order INT UNSIGNED NOT NULL DEFAULT 0,
  created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  updated_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
  PRIMARY KEY (id),
  UNIQUE KEY uq_event_types_name (name)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_uca1400_ai_ci;

CREATE TABLE IF NOT EXISTS substrate_types (
  id BINARY(16) NOT NULL,
  name VARCHAR(100) NOT NULL,
  description TEXT NULL,
  sort_order INT UNSIGNED NOT NULL DEFAULT 0,
  created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  updated_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
  PRIMARY KEY (id),
  UNIQUE KEY uq_substrate_types_name (name)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_uca1400_ai_ci;

CREATE TABLE IF NOT EXISTS light_levels (
  id BINARY(16) NOT NULL,
  name VARCHAR(100) NOT NULL,
  description TEXT NULL,
  sort_order INT UNSIGNED NOT NULL DEFAULT 0,
  created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  updated_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
  PRIMARY KEY (id),
  UNIQUE KEY uq_light_levels_name (name)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_uca1400_ai_ci;

CREATE TABLE IF NOT EXISTS pest_statuses (
  id BINARY(16) NOT NULL,
  name VARCHAR(100) NOT NULL,
  description TEXT NULL,
  sort_order INT UNSIGNED NOT NULL DEFAULT 0,
  created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  updated_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
  PRIMARY KEY (id),
  UNIQUE KEY uq_pest_statuses_name (name)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_uca1400_ai_ci;

CREATE TABLE IF NOT EXISTS measurement_methods (
  id BINARY(16) NOT NULL,
  name VARCHAR(100) NOT NULL,
  description TEXT NULL,
  sort_order INT UNSIGNED NOT NULL DEFAULT 0,
  created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  updated_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
  PRIMARY KEY (id),
  UNIQUE KEY uq_measurement_methods_name (name)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_uca1400_ai_ci;

CREATE TABLE IF NOT EXISTS scales (
  id BINARY(16) NOT NULL,
  name VARCHAR(100) NOT NULL,
  description TEXT NULL,
  sort_order INT UNSIGNED NOT NULL DEFAULT 0,
  created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  updated_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
  PRIMARY KEY (id),
  UNIQUE KEY uq_scales_name (name)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_uca1400_ai_ci;

-- Locations
CREATE TABLE IF NOT EXISTS locations (
  id BINARY(16) NOT NULL,
  name VARCHAR(100) NOT NULL,
  description TEXT NULL,
  sort_order INT UNSIGNED NOT NULL DEFAULT 0,
  created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  updated_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
  PRIMARY KEY (id),
  UNIQUE KEY uq_locations_name (name)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_uca1400_ai_ci;

-- Plants master
CREATE TABLE IF NOT EXISTS plants (
  id BINARY(16) NOT NULL,
  name VARCHAR(150) NOT NULL,
  description TEXT NULL,
  species_name VARCHAR(150) NULL,
  botanical_name VARCHAR(150) NULL,
  cultivar VARCHAR(150) NULL,
  sort_order INT UNSIGNED NOT NULL DEFAULT 0,
  location_id BINARY(16) NULL,
  substrate_type_id BINARY(16) NULL,
  substrate_last_refresh_at DATETIME(6) NULL,
  light_level_id BINARY(16) NULL,
  fertilized_last_at DATETIME(6) NULL,
  fertilizer_ec_ms DECIMAL(4,2) NULL,
  pest_status_id BINARY(16) NULL,
  health_status_id BINARY(16) NULL,
  photo_url VARCHAR(255) NULL,
  scale_id BINARY(16) NULL,
  default_measurement_method_id BINARY(16) NULL,
  repotted TINYINT(1) NOT NULL DEFAULT 0,
  archive TINYINT(1) NOT NULL DEFAULT 0,
  created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  updated_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
  closed_at DATETIME(6) NULL,
  PRIMARY KEY (id),
  KEY idx_plants_location (location_id),
  KEY idx_plants_sort (sort_order),
  KEY idx_plants_health (health_status_id),
  KEY idx_plants_archive (archive),
  KEY idx_plants_repotted (repotted),
  KEY idx_plants_default_method (default_measurement_method_id),
  CONSTRAINT fk_plants_location FOREIGN KEY (location_id) REFERENCES locations(id) ON UPDATE CASCADE ON DELETE SET NULL,
  CONSTRAINT fk_plants_substrate FOREIGN KEY (substrate_type_id) REFERENCES substrate_types(id) ON UPDATE CASCADE ON DELETE SET NULL,
  CONSTRAINT fk_plants_light FOREIGN KEY (light_level_id) REFERENCES light_levels(id) ON UPDATE CASCADE ON DELETE SET NULL,
  CONSTRAINT fk_plants_pest FOREIGN KEY (pest_status_id) REFERENCES pest_statuses(id) ON UPDATE CASCADE ON DELETE SET NULL,
  CONSTRAINT fk_plants_health FOREIGN KEY (health_status_id) REFERENCES health_statuses(id) ON UPDATE CASCADE ON DELETE SET NULL,
  CONSTRAINT fk_plants_scale FOREIGN KEY (scale_id) REFERENCES scales(id) ON UPDATE CASCADE ON DELETE SET NULL,
  CONSTRAINT fk_plants_default_method FOREIGN KEY (default_measurement_method_id) REFERENCES measurement_methods(id) ON UPDATE CASCADE ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_uca1400_ai_ci;

-- Time-series measurements of weight and water events
CREATE TABLE IF NOT EXISTS plants_measurements (
  id BINARY(16) NOT NULL,
  plant_id BINARY(16) NOT NULL,
  measured_at DATETIME(6) NOT NULL,
  measured_weight_g SMALLINT UNSIGNED NULL,
  last_dry_weight_g SMALLINT UNSIGNED NULL,
  last_wet_weight_g SMALLINT UNSIGNED NULL,
  water_added_g SMALLINT UNSIGNED NOT NULL DEFAULT 0,
  water_loss_total_pct DECIMAL(5,2) NULL,
  water_loss_total_g SMALLINT UNSIGNED NULL,
  water_loss_day_pct DECIMAL(5,2) NULL,
  water_loss_day_g SMALLINT UNSIGNED NULL,
  method_id BINARY(16) NULL,
  use_last_method TINYINT(1) NOT NULL DEFAULT 0,
  scale_id BINARY(16) NULL,
  note TEXT NULL,
  created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  updated_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
  PRIMARY KEY (id),
  KEY idx_meas_plant_time (plant_id, measured_at),
  KEY idx_meas_scale (scale_id),
  CONSTRAINT fk_meas_plant FOREIGN KEY (plant_id) REFERENCES plants(id) ON UPDATE CASCADE ON DELETE CASCADE,
  CONSTRAINT fk_meas_method FOREIGN KEY (method_id) REFERENCES measurement_methods(id) ON UPDATE CASCADE ON DELETE SET NULL,
  CONSTRAINT fk_meas_scale FOREIGN KEY (scale_id) REFERENCES scales(id) ON UPDATE CASCADE ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_uca1400_ai_ci;

-- Structured events (repot, move, prune, health update, notes)
CREATE TABLE IF NOT EXISTS plants_events (
  id BINARY(16) NOT NULL,
  plant_id BINARY(16) NOT NULL,
  event_type_id BINARY(16) NOT NULL,
  event_at DATETIME(6) NOT NULL,
  related_location_id BINARY(16) NULL,
  note TEXT NULL,
  created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  updated_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
  PRIMARY KEY (id),
  KEY idx_events_plant_time (plant_id, event_at),
  KEY idx_events_type (event_type_id),
  CONSTRAINT fk_events_plant FOREIGN KEY (plant_id) REFERENCES plants(id) ON UPDATE CASCADE ON DELETE CASCADE,
  CONSTRAINT fk_events_type FOREIGN KEY (event_type_id) REFERENCES event_types(id) ON UPDATE CASCADE ON DELETE RESTRICT,
  CONSTRAINT fk_events_location FOREIGN KEY (related_location_id) REFERENCES locations(id) ON UPDATE CASCADE ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_uca1400_ai_ci;

