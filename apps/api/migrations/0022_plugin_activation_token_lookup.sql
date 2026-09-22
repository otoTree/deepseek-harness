CREATE POLICY activation_token_lookup ON "enterprise"."plugin_activation"
FOR SELECT
USING (
  token_hash = current_setting('enterprise.plugin_activation_hash', true)
  AND revoked_at IS NULL
  AND expires_at > CURRENT_TIMESTAMP
);
