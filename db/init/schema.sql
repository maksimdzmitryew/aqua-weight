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

-- Users and Identity
CREATE TABLE IF NOT EXISTS users (
  id BINARY(16) NOT NULL,
  username VARCHAR(255) NOT NULL,
  password_hash VARCHAR(255) NOT NULL,
  global_role VARCHAR(20) NOT NULL,
  settings_json JSON NOT NULL DEFAULT '{}',
  settings_schema_version INT UNSIGNED NOT NULL DEFAULT 1,
  created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  updated_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
  PRIMARY KEY (id),
  UNIQUE KEY uq_users_username (username),
  CONSTRAINT chk_users_role CHECK (global_role IN ('admin', 'customer')),
  CONSTRAINT chk_users_settings_json CHECK (JSON_VALID(settings_json))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_uca1400_ai_ci;

CREATE TABLE IF NOT EXISTS system_settings (
  id TINYINT UNSIGNED NOT NULL,
  settings_json JSON NOT NULL DEFAULT '{}',
  settings_schema_version INT UNSIGNED NOT NULL DEFAULT 1,
  created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  updated_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
  PRIMARY KEY (id),
  CONSTRAINT chk_system_settings_singleton CHECK (id = 1),
  CONSTRAINT chk_system_settings_json CHECK (JSON_VALID(settings_json))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_uca1400_ai_ci;

CREATE TABLE IF NOT EXISTS invite_tokens (
  token_hash BINARY(32) NOT NULL,
  user_id BINARY(16) NOT NULL,
  expires_at DATETIME(6) NOT NULL,
  activated_at DATETIME(6) NULL,
  created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  PRIMARY KEY (token_hash),
  KEY idx_invite_user (user_id),
  CONSTRAINT fk_invite_user FOREIGN KEY (user_id) REFERENCES users(id) ON UPDATE CASCADE ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_uca1400_ai_ci;

CREATE TABLE IF NOT EXISTS user_totp_secrets (
  user_id BINARY(16) NOT NULL,
  secret VARCHAR(32) NOT NULL,
  created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  updated_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
  PRIMARY KEY (user_id),
  CONSTRAINT fk_totp_user FOREIGN KEY (user_id) REFERENCES users(id) ON UPDATE CASCADE ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_uca1400_ai_ci;

CREATE TABLE IF NOT EXISTS user_recovery_codes (
  code_hash VARCHAR(255) NOT NULL,
  user_id BINARY(16) NOT NULL,
  sort_order TINYINT UNSIGNED NOT NULL,
  used_at DATETIME(6) NULL,
  created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  PRIMARY KEY (code_hash),
  UNIQUE KEY uq_user_recovery_order (user_id, sort_order, created_at),
  KEY idx_recovery_user (user_id),
  CONSTRAINT fk_recovery_user FOREIGN KEY (user_id) REFERENCES users(id) ON UPDATE CASCADE ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_uca1400_ai_ci;

-- Devices and Sessions
CREATE TABLE IF NOT EXISTS devices (
  id BINARY(16) NOT NULL,
  device_id VARCHAR(255) NOT NULL,
  user_agent VARCHAR(512) NULL,
  first_seen_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  last_seen_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
  PRIMARY KEY (id),
  UNIQUE KEY uq_devices_device_id (device_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_uca1400_ai_ci;

CREATE TABLE IF NOT EXISTS user_devices (
  user_id BINARY(16) NOT NULL,
  device_id BINARY(16) NOT NULL,
  trusted TINYINT(1) NOT NULL DEFAULT 0,
  trusted_at DATETIME(6) NULL,
  device_name VARCHAR(255) NULL,
  last_login_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  PRIMARY KEY (user_id, device_id),
  CONSTRAINT fk_user_devices_user FOREIGN KEY (user_id) REFERENCES users(id) ON UPDATE CASCADE ON DELETE CASCADE,
  CONSTRAINT fk_user_devices_device FOREIGN KEY (device_id) REFERENCES devices(id) ON UPDATE CASCADE ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_uca1400_ai_ci;

CREATE TABLE IF NOT EXISTS auth_refresh_tokens (
  id BINARY(16) NOT NULL,
  token_hash BINARY(32) NOT NULL,
  user_id BINARY(16) NOT NULL,
  device_id BINARY(16) NOT NULL,
  expires_at DATETIME(6) NOT NULL,
  rotated_from_id BINARY(16) NULL,
  revoked_at DATETIME(6) NULL,
  created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  PRIMARY KEY (id),
  UNIQUE KEY uq_auth_refresh_token_hash (token_hash),
  KEY idx_auth_refresh_user (user_id),
  KEY idx_auth_refresh_device (device_id),
  CONSTRAINT fk_auth_refresh_user FOREIGN KEY (user_id) REFERENCES users(id) ON UPDATE CASCADE ON DELETE CASCADE,
  CONSTRAINT fk_auth_refresh_device FOREIGN KEY (device_id) REFERENCES devices(id) ON UPDATE CASCADE ON DELETE CASCADE,
  CONSTRAINT fk_auth_refresh_rotated_from FOREIGN KEY (rotated_from_id) REFERENCES auth_refresh_tokens(id) ON UPDATE CASCADE ON DELETE SET NULL
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
  UNIQUE KEY uq_locations_name (name),
  KEY idx_locations_sort (sort_order)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_uca1400_ai_ci;

-- Access Control
CREATE TABLE IF NOT EXISTS user_location_acl (
  user_id BINARY(16) NOT NULL,
  location_id BINARY(16) NOT NULL,
  role VARCHAR(20) NOT NULL,
  created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  updated_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
  PRIMARY KEY (user_id, location_id),
  KEY idx_user_location_acl_location (location_id),
  CONSTRAINT fk_user_location_acl_user FOREIGN KEY (user_id) REFERENCES users(id) ON UPDATE CASCADE ON DELETE CASCADE,
  CONSTRAINT fk_user_location_acl_location FOREIGN KEY (location_id) REFERENCES locations(id) ON UPDATE CASCADE ON DELETE CASCADE,
  CONSTRAINT chk_user_location_acl_role CHECK (role IN ('owner', 'helper'))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_uca1400_ai_ci;

-- Plants master
CREATE TABLE IF NOT EXISTS plants (
  -- General
  id BINARY(16) NOT NULL,
  name VARCHAR(150) NOT NULL,
  plant_type VARCHAR(150) NULL,
  identify_hint VARCHAR(150) NULL,
  typical_action VARCHAR(150) NULL,
  description VARCHAR(2000) NULL,
  notes TEXT NULL,
  location_id BINARY(16) NULL,
  owner_id BINARY(16) NULL,
  photo_url VARCHAR(2048) NULL,
  -- Service
  default_measurement_method_id BINARY(16) NULL,
  scale_id BINARY(16) NULL,
  sort_order INT UNSIGNED NOT NULL DEFAULT 0,
  repotted TINYINT(1) NOT NULL DEFAULT 0,
  archive TINYINT(1) NOT NULL DEFAULT 0,
  -- Care
  recommended_water_threshold_pct SMALLINT UNSIGNED NULL,
  biomass_weight_g SMALLINT UNSIGNED NULL,
  biomass_last_at DATETIME(6) NULL,
  -- Advanced
  species_name VARCHAR(150) NULL,
  botanical_name VARCHAR(150) NULL,
  cultivar VARCHAR(150) NULL,
  substrate_type_id BINARY(16) NULL,
  substrate_last_refresh_at DATETIME(6) NULL,
  fertilized_last_at DATETIME(6) NULL,
  fertilizer_ec_ms DECIMAL(4,2) NULL,
  -- Health
  light_level_id BINARY(16) NULL,
  pest_status_id BINARY(16) NULL,
  health_status_id BINARY(16) NULL,
  -- Calculated
  min_dry_weight_g SMALLINT UNSIGNED NULL,
  max_water_weight_g SMALLINT UNSIGNED NULL,
  -- System
  created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  updated_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
  closed_at DATETIME(6) NULL,

  PRIMARY KEY (id),
  KEY idx_plants_location (location_id),
  KEY idx_plants_owner (owner_id),
  KEY idx_plants_sort (sort_order),
  KEY idx_plants_health (health_status_id),
  KEY idx_plants_archive (archive),
  KEY idx_plants_repotted (repotted),
  KEY idx_plants_default_method (default_measurement_method_id),
  CONSTRAINT fk_plants_location FOREIGN KEY (location_id) REFERENCES locations(id) ON UPDATE CASCADE ON DELETE SET NULL,
  CONSTRAINT fk_plants_owner FOREIGN KEY (owner_id) REFERENCES users(id) ON UPDATE CASCADE ON DELETE SET NULL,
  CONSTRAINT fk_plants_substrate FOREIGN KEY (substrate_type_id) REFERENCES substrate_types(id) ON UPDATE CASCADE ON DELETE SET NULL,
  CONSTRAINT fk_plants_light FOREIGN KEY (light_level_id) REFERENCES light_levels(id) ON UPDATE CASCADE ON DELETE SET NULL,
  CONSTRAINT fk_plants_pest FOREIGN KEY (pest_status_id) REFERENCES pest_statuses(id) ON UPDATE CASCADE ON DELETE SET NULL,
  CONSTRAINT fk_plants_health FOREIGN KEY (health_status_id) REFERENCES health_statuses(id) ON UPDATE CASCADE ON DELETE SET NULL,
  CONSTRAINT fk_plants_scale FOREIGN KEY (scale_id) REFERENCES scales(id) ON UPDATE CASCADE ON DELETE SET NULL,
  CONSTRAINT fk_plants_default_method FOREIGN KEY (default_measurement_method_id) REFERENCES measurement_methods(id) ON UPDATE CASCADE ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_uca1400_ai_ci;

ALTER TABLE plants
  MODIFY COLUMN description VARCHAR(2000) NULL,
  MODIFY COLUMN photo_url VARCHAR(2048) NULL;

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
  KEY idx_meas_method (method_id),
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

-- Encryption key storage for WhatsApp credentials
CREATE TABLE IF NOT EXISTS encryption_keys (
  id BINARY(16) NOT NULL,
  version VARCHAR(20) NOT NULL DEFAULT 'v1',
  encrypted_key TEXT NOT NULL,
  salt BINARY(32) NOT NULL,
  key_label VARCHAR(100) NULL,
  created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  updated_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
  PRIMARY KEY (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_uca1400_ai_ci;
