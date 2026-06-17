-- Ensure application database users and roles exist.
-- MariaDB creates MARIADB_USER before running these init scripts; CREATE USER IF NOT EXISTS
-- keeps this file safe to re-run and still covers manual/local initialization.

CREATE USER IF NOT EXISTS 'appuser'@'%' IDENTIFIED BY 'apppass';

CREATE ROLE IF NOT EXISTS 'aw_app_read', 'aw_app_write', 'aw_app_admin';

-- Runtime database privileges.
GRANT ALL PRIVILEGES ON appdb.* TO 'appuser'@'%';
GRANT SELECT ON appdb.* TO 'aw_app_read'@'%';
GRANT SELECT, INSERT, UPDATE, DELETE ON appdb.* TO 'aw_app_write'@'%';
GRANT ALL PRIVILEGES ON appdb.* TO 'aw_app_admin'@'%';

-- Test database privileges.
GRANT ALL PRIVILEGES ON appdb_test.* TO 'appuser'@'%';
GRANT SELECT ON appdb_test.* TO 'aw_app_read'@'%';
GRANT SELECT, INSERT, UPDATE, DELETE ON appdb_test.* TO 'aw_app_write'@'%';
GRANT ALL PRIVILEGES ON appdb_test.* TO 'aw_app_admin'@'%';

GRANT 'aw_app_write' TO 'appuser'@'%';
SET DEFAULT ROLE 'aw_app_write' TO 'appuser'@'%';

FLUSH PRIVILEGES;
