CREATE TABLE enterprise_auth.subscription_plan (
  code text PRIMARY KEY, name text NOT NULL, description text NOT NULL DEFAULT '',
  seats integer NOT NULL CHECK (seats BETWEEN 1 AND 100000),
  price_micros_cny bigint NOT NULL DEFAULT 0 CHECK (price_micros_cny >= 0),
  resource_policy jsonb, enabled boolean NOT NULL DEFAULT true,
  version integer NOT NULL DEFAULT 1 CHECK (version > 0)
);
INSERT INTO enterprise_auth.subscription_plan (code, name, seats)
  SELECT plan, plan, max(seats) FROM enterprise.subscription GROUP BY plan;
INSERT INTO enterprise_auth.subscription_plan (code, name, seats)
  VALUES ('team', 'team', 1), ('enterprise', 'enterprise', 1), ('private', 'private', 1) ON CONFLICT DO NOTHING;
ALTER TABLE enterprise.subscription ADD CONSTRAINT subscription_plan_reference
  FOREIGN KEY (plan) REFERENCES enterprise_auth.subscription_plan(code) ON DELETE RESTRICT;
GRANT SELECT, INSERT, UPDATE, DELETE ON enterprise_auth.subscription_plan TO enterprise_app;

--> statement-breakpoint
-- Historical admission departments are unknown; never infer them from present assignments.
INSERT INTO enterprise.billing_attribution (id, organization_id, account_id, membership_id, month, time_zone, department_ids, created_at)
  SELECT u.id, u.organization_id, u.account_id, coalesce(m.id, 'historical:' || u.account_id),
    to_char(coalesce(u.request_started_at, u.created_at) AT TIME ZONE 'Asia/Shanghai', 'YYYY-MM'),
    'Asia/Shanghai', '[]'::jsonb, coalesce(u.request_started_at, u.created_at)
  FROM enterprise.model_usage u LEFT JOIN enterprise.membership m
    ON m.organization_id = u.organization_id AND m.account_id = u.account_id
  ON CONFLICT (id) DO NOTHING;
