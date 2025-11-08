-- Apply base schema to runtime database
USE appdb;
SOURCE /docker-entrypoint-initdb.d/schema.sql;
