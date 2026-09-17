ALTER TABLE enterprise_auth.model
  ADD COLUMN model_call_timeout_ms integer NOT NULL DEFAULT 300000;
--> statement-breakpoint
ALTER TABLE enterprise_auth.model
  ADD CONSTRAINT model_call_timeout_positive CHECK (model_call_timeout_ms > 0);
