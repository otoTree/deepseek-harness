ALTER TABLE enterprise.usage
  ADD COLUMN protocol text NOT NULL DEFAULT 'openai-completions',
  ADD COLUMN input_modalities jsonb NOT NULL DEFAULT '["text"]'::jsonb,
  ADD COLUMN file_upload_count integer NOT NULL DEFAULT 0,
  ADD COLUMN uploaded_bytes bigint NOT NULL DEFAULT 0,
  ADD COLUMN file_upload_failures integer NOT NULL DEFAULT 0,
  ADD COLUMN reconciliation_reason text,
  ADD COLUMN failure_reason text;
--> statement-breakpoint
ALTER TABLE enterprise.usage
  ADD CONSTRAINT usage_multimodal_dimensions_valid CHECK (
    protocol IN ('openai-completions', 'openai-responses')
    AND file_upload_count >= 0
    AND uploaded_bytes >= 0
    AND file_upload_failures >= 0
  );
