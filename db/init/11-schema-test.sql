-- Apply base schema to test database
USE appdb_test;
SOURCE /docker-entrypoint-initdb.d/schema.sql;
