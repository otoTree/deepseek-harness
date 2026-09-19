CREATE TABLE "enterprise"."organization_wallet" (
	"organization_id" text PRIMARY KEY NOT NULL,
	"balance_micros_cny" bigint DEFAULT 0 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "organization_wallet_version_positive" CHECK ("enterprise"."organization_wallet"."version" > 0)
);
--> statement-breakpoint
CREATE TABLE "enterprise_auth"."redemption_code" (
	"id" text PRIMARY KEY NOT NULL,
	"batch_id" text NOT NULL,
	"code_hash" text NOT NULL,
	"code_hint" text NOT NULL,
	"amount_micros_cny" bigint NOT NULL,
	"note" text,
	"created_by" text NOT NULL,
	"expires_at" timestamp with time zone,
	"revoked_at" timestamp with time zone,
	"redeemed_at" timestamp with time zone,
	"redeemed_by" text,
	"redeemed_organization_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "redemption_code_code_hash_unique" UNIQUE("code_hash"),
	CONSTRAINT "redemption_code_amount_positive" CHECK ("enterprise_auth"."redemption_code"."amount_micros_cny" > 0)
);
--> statement-breakpoint
CREATE TABLE "enterprise"."wallet_ledger" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"amount_micros_cny" bigint NOT NULL,
	"kind" text NOT NULL,
	"usage_id" text,
	"redemption_code_id" text,
	"account_id" text NOT NULL,
	"runtime_id" text,
	"balance_after_micros_cny" bigint NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "wallet_ledger_usage_unique" UNIQUE("usage_id"),
	CONSTRAINT "wallet_ledger_redemption_unique" UNIQUE("redemption_code_id"),
	CONSTRAINT "wallet_ledger_kind_valid" CHECK (
		("enterprise"."wallet_ledger"."kind" = 'redemption_credit' AND "enterprise"."wallet_ledger"."amount_micros_cny" > 0 AND "enterprise"."wallet_ledger"."redemption_code_id" IS NOT NULL AND "enterprise"."wallet_ledger"."usage_id" IS NULL)
		OR ("enterprise"."wallet_ledger"."kind" = 'model_usage_debit' AND "enterprise"."wallet_ledger"."amount_micros_cny" <= 0 AND "enterprise"."wallet_ledger"."usage_id" IS NOT NULL AND "enterprise"."wallet_ledger"."redemption_code_id" IS NULL)
	)
);
--> statement-breakpoint
ALTER TABLE "enterprise"."organization_wallet" ADD CONSTRAINT "organization_wallet_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "enterprise"."organization"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "enterprise_auth"."redemption_code" ADD CONSTRAINT "redemption_code_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "enterprise_auth"."user"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "enterprise_auth"."redemption_code" ADD CONSTRAINT "redemption_code_redeemed_by_user_id_fk" FOREIGN KEY ("redeemed_by") REFERENCES "enterprise_auth"."user"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "enterprise_auth"."redemption_code" ADD CONSTRAINT "redemption_code_redeemed_organization_id_organization_id_fk" FOREIGN KEY ("redeemed_organization_id") REFERENCES "enterprise"."organization"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "enterprise"."wallet_ledger" ADD CONSTRAINT "wallet_ledger_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "enterprise"."organization"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "enterprise"."wallet_ledger" ADD CONSTRAINT "wallet_ledger_usage_id_usage_id_fk" FOREIGN KEY ("usage_id") REFERENCES "enterprise"."usage"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "enterprise"."wallet_ledger" ADD CONSTRAINT "wallet_ledger_redemption_code_id_redemption_code_id_fk" FOREIGN KEY ("redemption_code_id") REFERENCES "enterprise_auth"."redemption_code"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "enterprise"."wallet_ledger" ADD CONSTRAINT "wallet_ledger_account_id_user_id_fk" FOREIGN KEY ("account_id") REFERENCES "enterprise_auth"."user"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "enterprise"."wallet_ledger" ADD CONSTRAINT "wallet_ledger_organization_id_runtime_id_runtime_organization_id_id_fk" FOREIGN KEY ("organization_id", "runtime_id") REFERENCES "enterprise"."runtime"("organization_id", "id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
CREATE INDEX "redemption_code_batch" ON "enterprise_auth"."redemption_code" USING btree ("batch_id", "created_at");
--> statement-breakpoint
CREATE INDEX "wallet_ledger_org_time" ON "enterprise"."wallet_ledger" USING btree ("organization_id", "created_at", "id");
--> statement-breakpoint
INSERT INTO "enterprise"."organization_wallet" ("organization_id", "balance_micros_cny")
SELECT "id", 0 FROM "enterprise"."organization"
ON CONFLICT ("organization_id") DO NOTHING;
--> statement-breakpoint
ALTER TABLE enterprise.organization_wallet ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE enterprise.organization_wallet FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY tenant_scope ON enterprise.organization_wallet
USING (current_setting('enterprise.platform_admin', true) = 'true' OR organization_id = current_setting('enterprise.organization_id', true))
WITH CHECK (current_setting('enterprise.platform_admin', true) = 'true' OR organization_id = current_setting('enterprise.organization_id', true));
--> statement-breakpoint
ALTER TABLE enterprise.wallet_ledger ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE enterprise.wallet_ledger FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY tenant_scope ON enterprise.wallet_ledger
USING (current_setting('enterprise.platform_admin', true) = 'true' OR organization_id = current_setting('enterprise.organization_id', true))
WITH CHECK (current_setting('enterprise.platform_admin', true) = 'true' OR organization_id = current_setting('enterprise.organization_id', true));
--> statement-breakpoint
REVOKE UPDATE, DELETE ON enterprise.wallet_ledger FROM enterprise_app;
--> statement-breakpoint
ALTER TABLE enterprise.runtime NO FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION enterprise_auth.resolve_runtime_token(p_token_hash text)
RETURNS TABLE(id text, organization_id text, account_id text, email text, lease_until timestamptz, revoked_at timestamptz)
LANGUAGE sql
SECURITY DEFINER
SET search_path = pg_catalog, enterprise
AS $$
  SELECT runtime.id, runtime.organization_id, runtime.account_id, account.email, runtime.lease_until, runtime.revoked_at
  FROM enterprise.runtime
  JOIN enterprise_auth."user" account ON account.id = runtime.account_id
  WHERE runtime.token_hash = p_token_hash
  LIMIT 1
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION enterprise_auth.resolve_runtime_token(text) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION enterprise_auth.resolve_runtime_token(text) TO enterprise_app;
