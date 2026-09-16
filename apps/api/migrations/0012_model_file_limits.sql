ALTER TABLE enterprise_auth.model
  ADD COLUMN max_file_bytes integer NOT NULL DEFAULT 10485760,
  ADD COLUMN max_request_bytes integer NOT NULL DEFAULT 33554432,
  ADD COLUMN files_ttl_seconds integer NOT NULL DEFAULT 604800;
--> statement-breakpoint
ALTER TABLE enterprise_auth.model
  ADD CONSTRAINT model_file_limits_positive CHECK (
    max_file_bytes > 0
    AND max_request_bytes >= max_file_bytes
    AND files_ttl_seconds > 0
  );
