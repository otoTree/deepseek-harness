CREATE TABLE "enterprise_auth"."desktop_code" (
	"id" text PRIMARY KEY NOT NULL,
	"account_id" text NOT NULL,
	"organization_id" text NOT NULL,
	"challenge" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"consumed_at" timestamp with time zone,
	"runtime" jsonb NOT NULL
);
--> statement-breakpoint
ALTER TABLE "enterprise_auth"."desktop_code" ADD CONSTRAINT "desktop_code_account_id_user_id_fk" FOREIGN KEY ("account_id") REFERENCES "enterprise_auth"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "enterprise_auth"."desktop_code" ADD CONSTRAINT "desktop_code_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "enterprise"."organization"("id") ON DELETE no action ON UPDATE no action;