\getenv migrator_password ENTERPRISE_PG_MIGRATOR_PASSWORD
\getenv app_password ENTERPRISE_PG_APP_PASSWORD
CREATE ROLE enterprise_migrator LOGIN NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE PASSWORD :'migrator_password';
CREATE ROLE enterprise_app LOGIN NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE PASSWORD :'app_password';
REVOKE ALL ON DATABASE dsh_enterprise FROM PUBLIC;
GRANT CONNECT ON DATABASE dsh_enterprise TO enterprise_migrator, enterprise_app;
GRANT CREATE ON DATABASE dsh_enterprise TO enterprise_migrator;
REVOKE CREATE ON SCHEMA public FROM PUBLIC;
CREATE SCHEMA enterprise AUTHORIZATION enterprise_migrator;
GRANT USAGE ON SCHEMA enterprise TO enterprise_app;
CREATE SCHEMA enterprise_auth AUTHORIZATION enterprise_migrator;
GRANT USAGE ON SCHEMA enterprise_auth TO enterprise_app;
CREATE SCHEMA drizzle AUTHORIZATION enterprise_migrator;
SET ROLE enterprise_migrator;
CREATE TABLE enterprise.installation (id text PRIMARY KEY CHECK (id = 'deepseek-enterprise-local'));
INSERT INTO enterprise.installation VALUES ('deepseek-enterprise-local');
GRANT SELECT ON enterprise.installation TO enterprise_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA enterprise GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO enterprise_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA enterprise_auth GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO enterprise_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA enterprise GRANT USAGE, SELECT ON SEQUENCES TO enterprise_app;
