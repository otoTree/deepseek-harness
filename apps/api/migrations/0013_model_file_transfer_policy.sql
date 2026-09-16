ALTER TABLE enterprise_auth.model
  ADD COLUMN file_upload_timeout_ms integer NOT NULL DEFAULT 120000,
  ADD COLUMN file_upload_max_retries integer NOT NULL DEFAULT 1,
  ADD COLUMN file_refresh_margin_seconds integer NOT NULL DEFAULT 60,
  ADD COLUMN file_quota_cleanup_batch integer NOT NULL DEFAULT 0;
--> statement-breakpoint
ALTER TABLE enterprise_auth.model
  ADD CONSTRAINT model_file_transfer_policy_valid CHECK (
    file_upload_timeout_ms > 0
    AND file_upload_max_retries >= 0
    AND file_refresh_margin_seconds >= 0
    AND file_refresh_margin_seconds < files_ttl_seconds
    AND file_quota_cleanup_batch >= 0
  );
