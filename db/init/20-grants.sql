-- Ensure application user has privileges on both runtime and test databases
-- Note: The user 'appuser' is created by the MariaDB image when MARIADB_USER is set
GRANT ALL PRIVILEGES ON appdb.* TO 'appuser'@'%';
GRANT ALL PRIVILEGES ON appdb_test.* TO 'appuser'@'%';
FLUSH PRIVILEGES;
