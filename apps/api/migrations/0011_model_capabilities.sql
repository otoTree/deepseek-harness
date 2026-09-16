ALTER TABLE enterprise_auth.model
  ADD COLUMN protocol text NOT NULL DEFAULT 'openai-completions',
  ADD COLUMN input_modalities jsonb NOT NULL DEFAULT '["text"]'::jsonb,
  ADD COLUMN file_input_policy text NOT NULL DEFAULT 'unsupported';
--> statement-breakpoint
ALTER TABLE enterprise_auth.model
  ADD CONSTRAINT model_capability_values_supported CHECK (
    protocol IN ('openai-completions', 'openai-responses', 'anthropic-messages')
    AND file_input_policy IN ('unsupported', 'inline', 'provider-files')
  );
