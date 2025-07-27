-- Database initialization script for Todo App
-- This script sets up the database with proper extensions and initial configuration

-- Enable UUID extension for generating UUIDs
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- Enable pgcrypto extension for additional cryptographic functions
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- Create application user with limited privileges (optional, for production)
-- DO $$
-- BEGIN
--     IF NOT EXISTS (SELECT FROM pg_catalog.pg_user WHERE usename = 'todo_app_user') THEN
--         CREATE USER todo_app_user WITH ENCRYPTED PASSWORD 'secure_password';
--         GRANT CONNECT ON DATABASE todo_app TO todo_app_user;
--         GRANT USAGE ON SCHEMA public TO todo_app_user;
--         GRANT CREATE ON SCHEMA public TO todo_app_user;
--     END IF;
-- END
-- $$;

-- Set timezone to UTC for consistency
SET timezone = 'UTC';

-- Create a function to update updated_at timestamp automatically
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = CURRENT_TIMESTAMP;
    RETURN NEW;
END;
$$ language 'plpgsql';

-- Create indexes for better performance (will be created by migrations, but good to have as reference)
-- These will be created by the migration files, but documented here for reference

-- Performance settings for development (adjust for production)
-- ALTER SYSTEM SET shared_buffers = '256MB';
-- ALTER SYSTEM SET effective_cache_size = '1GB';
-- ALTER SYSTEM SET maintenance_work_mem = '64MB';
-- ALTER SYSTEM SET checkpoint_completion_target = 0.9;
-- ALTER SYSTEM SET wal_buffers = '16MB';
-- ALTER SYSTEM SET default_statistics_target = 100;

-- Enable logging for development
-- ALTER SYSTEM SET log_statement = 'all';
-- ALTER SYSTEM SET log_duration = on;
-- ALTER SYSTEM SET log_min_duration_statement = 100;

-- Reload configuration
-- SELECT pg_reload_conf();

-- Show current database information
SELECT
    current_database() as database_name,
    current_user as current_user,
    version() as postgresql_version,
    current_timestamp as initialized_at;
