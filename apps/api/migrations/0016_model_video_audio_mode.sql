ALTER TABLE enterprise_auth.model
  ADD COLUMN video_audio_mode text NOT NULL DEFAULT 'visual-only';
--> statement-breakpoint
ALTER TABLE enterprise_auth.model
  DROP CONSTRAINT model_capability_values_supported;
--> statement-breakpoint
ALTER TABLE enterprise_auth.model
  ADD CONSTRAINT model_capability_values_supported CHECK (
    protocol IN ('openai-completions', 'openai-responses', 'anthropic-messages')
    AND file_input_policy IN ('unsupported', 'inline', 'provider-files')
    AND video_audio_mode IN ('visual-only', 'visual-and-audio')
    AND (video_audio_mode = 'visual-only' OR input_modalities ? 'video')
  );
