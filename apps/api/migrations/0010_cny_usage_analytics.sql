ALTER TABLE enterprise_auth.model
  ADD COLUMN input_price_micros_cny_per_million bigint NOT NULL DEFAULT 0,
  ADD COLUMN cached_input_price_micros_cny_per_million bigint NOT NULL DEFAULT 0,
  ADD COLUMN output_price_micros_cny_per_million bigint NOT NULL DEFAULT 0;
--> statement-breakpoint
ALTER TABLE enterprise_auth.model
  ADD CONSTRAINT model_cny_prices_nonnegative CHECK (
    input_price_micros_cny_per_million >= 0
    AND cached_input_price_micros_cny_per_million >= 0
    AND output_price_micros_cny_per_million >= 0
  );
--> statement-breakpoint
ALTER TABLE enterprise.usage
  ADD COLUMN cached_input_tokens integer,
  ADD COLUMN uncached_input_tokens integer,
  ADD COLUMN reasoning_tokens integer,
  ADD COLUMN total_tokens integer,
  ADD COLUMN currency text,
  ADD COLUMN pricing_version integer,
  ADD COLUMN input_price_micros_cny_per_million bigint,
  ADD COLUMN cached_input_price_micros_cny_per_million bigint,
  ADD COLUMN output_price_micros_cny_per_million bigint,
  ADD COLUMN input_cost_micros_cny bigint,
  ADD COLUMN cached_input_cost_micros_cny bigint,
  ADD COLUMN output_cost_micros_cny bigint,
  ADD COLUMN total_cost_micros_cny bigint,
  ADD COLUMN request_started_at timestamptz,
  ADD COLUMN duration_ms integer,
  ADD COLUMN upstream_request_id text;
--> statement-breakpoint
ALTER TABLE enterprise.usage
  ADD CONSTRAINT usage_cny_complete CHECK (currency IS NULL OR (
    currency = 'CNY' AND pricing_version = 1
    AND input_tokens >= 0 AND cached_input_tokens >= 0 AND uncached_input_tokens >= 0
    AND output_tokens >= 0 AND reasoning_tokens >= 0 AND total_tokens >= 0
    AND cached_input_tokens + uncached_input_tokens = input_tokens
    AND total_tokens = input_tokens + output_tokens
    AND reasoning_tokens <= output_tokens
    AND input_price_micros_cny_per_million >= 0 AND cached_input_price_micros_cny_per_million >= 0
    AND output_price_micros_cny_per_million >= 0 AND input_cost_micros_cny >= 0
    AND cached_input_cost_micros_cny >= 0 AND output_cost_micros_cny >= 0
    AND total_cost_micros_cny = input_cost_micros_cny + cached_input_cost_micros_cny + output_cost_micros_cny
    AND request_started_at IS NOT NULL AND duration_ms >= 0
  ));
--> statement-breakpoint
CREATE INDEX usage_settled_time ON enterprise.usage (settled_at, id);
CREATE INDEX usage_org_settled_time ON enterprise.usage (organization_id, settled_at);
CREATE INDEX usage_model_settled_time ON enterprise.usage (model_id, settled_at);
CREATE INDEX usage_account_settled_time ON enterprise.usage (account_id, settled_at);
