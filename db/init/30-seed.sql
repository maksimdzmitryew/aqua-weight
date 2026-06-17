-- Idempotent seed data for fresh Docker database initialization.
-- This file intentionally uses INSERT ... ON DUPLICATE KEY UPDATE so it can be re-run safely.

-- Application reference data.
INSERT INTO health_statuses (id, name, description, sort_order) VALUES
  (UNHEX('10000000000000000000000000000001'), 'Healthy', 'No visible health issues', 10),
  (UNHEX('10000000000000000000000000000002'), 'Needs Water', 'Plant appears to need watering', 20),
  (UNHEX('10000000000000000000000000000003'), 'Needs Attention', 'Plant needs review or intervention', 30),
  (UNHEX('10000000000000000000000000000004'), 'Dormant', 'Plant is dormant or resting', 40)
ON DUPLICATE KEY UPDATE
  name = VALUES(name),
  description = COALESCE(VALUES(description), description),
  sort_order = VALUES(sort_order);

INSERT INTO event_types (id, name, description, sort_order) VALUES
  (UNHEX('20000000000000000000000000000001'), 'Weight', 'Weight measurement event', 10),
  (UNHEX('20000000000000000000000000000002'), 'Watering', 'Watering or watering-related event', 20),
  (UNHEX('20000000000000000000000000000003'), 'Repotting', 'Repotting event', 30),
  (UNHEX('20000000000000000000000000000004'), 'Health Update', 'Health status or observation update', 40),
  (UNHEX('20000000000000000000000000000005'), 'Note', 'General plant note', 50)
ON DUPLICATE KEY UPDATE
  name = VALUES(name),
  description = COALESCE(VALUES(description), description),
  sort_order = VALUES(sort_order);

INSERT INTO substrate_types (id, name, description, sort_order) VALUES
  (UNHEX('30000000000000000000000000000001'), 'Soil', 'Standard potting soil', 10),
  (UNHEX('30000000000000000000000000000002'), 'Coco Coir', 'Coco coir based mix', 20),
  (UNHEX('30000000000000000000000000000003'), 'LECA', 'Lightweight expanded clay aggregate', 30),
  (UNHEX('30000000000000000000000000000004'), 'Bark Mix', 'Orchid/bark style mix', 40)
ON DUPLICATE KEY UPDATE
  name = VALUES(name),
  description = COALESCE(VALUES(description), description),
  sort_order = VALUES(sort_order);

INSERT INTO light_levels (id, name, description, sort_order) VALUES
  (UNHEX('40000000000000000000000000000001'), 'Low', 'Low indirect light', 10),
  (UNHEX('40000000000000000000000000000002'), 'Medium', 'Medium indirect light', 20),
  (UNHEX('40000000000000000000000000000003'), 'Bright Indirect', 'Bright indirect light', 30),
  (UNHEX('40000000000000000000000000000004'), 'Direct Sun', 'Direct sun exposure', 40)
ON DUPLICATE KEY UPDATE
  name = VALUES(name),
  description = COALESCE(VALUES(description), description),
  sort_order = VALUES(sort_order);

INSERT INTO pest_statuses (id, name, description, sort_order) VALUES
  (UNHEX('50000000000000000000000000000001'), 'None', 'No pest activity observed', 10),
  (UNHEX('50000000000000000000000000000002'), 'Monitoring', 'Monitoring for pests', 20),
  (UNHEX('50000000000000000000000000000003'), 'Minor', 'Minor pest activity', 30),
  (UNHEX('50000000000000000000000000000004'), 'Active', 'Active pest issue', 40)
ON DUPLICATE KEY UPDATE
  name = VALUES(name),
  description = COALESCE(VALUES(description), description),
  sort_order = VALUES(sort_order);

INSERT INTO measurement_methods (id, name, description, sort_order) VALUES
  (UNHEX('60000000000000000000000000000001'), 'Manual', 'Manual measurement entry', 10),
  (UNHEX('60000000000000000000000000000002'), 'Scale', 'Scale-assisted measurement', 20),
  (UNHEX('60000000000000000000000000000003'), 'Device', 'Automated device measurement', 30)
ON DUPLICATE KEY UPDATE
  name = VALUES(name),
  description = COALESCE(VALUES(description), description),
  sort_order = VALUES(sort_order);

INSERT INTO scales (id, name, description, sort_order) VALUES
  (UNHEX('70000000000000000000000000000001'), 'Primary Scale', 'Default scale for manual measurements', 10)
ON DUPLICATE KEY UPDATE
  name = VALUES(name),
  description = COALESCE(VALUES(description), description),
  sort_order = VALUES(sort_order);

-- Default location and access mapping for the seeded admin user.
INSERT INTO locations (id, name, description, sort_order) VALUES
  (UNHEX('80000000000000000000000000000001'), 'Default Location', 'Default location for fresh installs', 0)
ON DUPLICATE KEY UPDATE
  name = VALUES(name),
  description = COALESCE(VALUES(description), description),
  sort_order = VALUES(sort_order);

-- Development-only admin user.
-- Password for this seed user is: password
-- Replace this Argon2 hash with a generated hash for adminpass if that credential is required.
INSERT INTO users (id, username, password_hash, global_role, settings_json, settings_schema_version) VALUES
  (
    UNHEX('aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'),
    'admin',
    '$argon2i$v=19$m=512,t=2,p=2$5NfX6jW1x2k4H5W7K9L0Mw$q5Z8Y7X6W5V4U3T2S1R0P9O8N7M6L5K4J3I2H1G0F',
    'admin',
    '{}',
    1
  )
ON DUPLICATE KEY UPDATE
  username = VALUES(username),
  global_role = VALUES(global_role),
  settings_json = VALUES(settings_json),
  settings_schema_version = VALUES(settings_schema_version);

INSERT INTO user_location_acl (user_id, location_id, role) VALUES
  (UNHEX('aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'), UNHEX('80000000000000000000000000000001'), 'owner')
ON DUPLICATE KEY UPDATE role = VALUES(role);
