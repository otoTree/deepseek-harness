ALTER TABLE enterprise.organization ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE enterprise.organization FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY organization_scope ON enterprise.organization USING (id = current_setting('enterprise.organization_id', true)) WITH CHECK (id = current_setting('enterprise.organization_id', true));
--> statement-breakpoint
ALTER TABLE enterprise.org_unit ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE enterprise.org_unit FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY tenant_scope ON enterprise.org_unit USING (organization_id = current_setting('enterprise.organization_id', true)) WITH CHECK (organization_id = current_setting('enterprise.organization_id', true));
--> statement-breakpoint
ALTER TABLE enterprise.unit_assignment ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE enterprise.unit_assignment FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY tenant_scope ON enterprise.unit_assignment USING (organization_id = current_setting('enterprise.organization_id', true)) WITH CHECK (organization_id = current_setting('enterprise.organization_id', true));
--> statement-breakpoint
ALTER TABLE enterprise.role_binding ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE enterprise.role_binding FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY tenant_scope ON enterprise.role_binding USING (organization_id = current_setting('enterprise.organization_id', true)) WITH CHECK (organization_id = current_setting('enterprise.organization_id', true));
--> statement-breakpoint
ALTER TABLE enterprise.subscription ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE enterprise.subscription FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY tenant_scope ON enterprise.subscription USING (organization_id = current_setting('enterprise.organization_id', true)) WITH CHECK (organization_id = current_setting('enterprise.organization_id', true));
--> statement-breakpoint
ALTER TABLE enterprise.model_grant ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE enterprise.model_grant FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY tenant_scope ON enterprise.model_grant USING (organization_id = current_setting('enterprise.organization_id', true)) WITH CHECK (organization_id = current_setting('enterprise.organization_id', true));
--> statement-breakpoint
ALTER TABLE enterprise.usage ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE enterprise.usage FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY tenant_scope ON enterprise.usage USING (organization_id = current_setting('enterprise.organization_id', true)) WITH CHECK (organization_id = current_setting('enterprise.organization_id', true));
--> statement-breakpoint
ALTER TABLE enterprise.audit ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE enterprise.audit FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY tenant_scope ON enterprise.audit USING (organization_id = current_setting('enterprise.organization_id', true)) WITH CHECK (organization_id = current_setting('enterprise.organization_id', true));
--> statement-breakpoint
ALTER TABLE enterprise.conversation ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE enterprise.conversation FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY tenant_scope ON enterprise.conversation USING (organization_id = current_setting('enterprise.organization_id', true)) WITH CHECK (organization_id = current_setting('enterprise.organization_id', true));
--> statement-breakpoint
ALTER TABLE enterprise.session_event ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE enterprise.session_event FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY tenant_scope ON enterprise.session_event USING (organization_id = current_setting('enterprise.organization_id', true)) WITH CHECK (organization_id = current_setting('enterprise.organization_id', true));
--> statement-breakpoint
ALTER TABLE enterprise.plugin_release ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE enterprise.plugin_release FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY tenant_scope ON enterprise.plugin_release USING (organization_id = current_setting('enterprise.organization_id', true)) WITH CHECK (organization_id = current_setting('enterprise.organization_id', true));
--> statement-breakpoint
ALTER TABLE enterprise.membership ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE enterprise.membership FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY tenant_scope ON enterprise.membership USING (organization_id = current_setting('enterprise.organization_id', true)) WITH CHECK (organization_id = current_setting('enterprise.organization_id', true));
--> statement-breakpoint
CREATE POLICY actor_read ON enterprise.membership FOR SELECT USING (account_id = current_setting('enterprise.account_id', true));
--> statement-breakpoint
ALTER TABLE enterprise.runtime ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE enterprise.runtime FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY tenant_scope ON enterprise.runtime USING (organization_id = current_setting('enterprise.organization_id', true)) WITH CHECK (organization_id = current_setting('enterprise.organization_id', true));
--> statement-breakpoint
CREATE POLICY actor_read ON enterprise.runtime FOR SELECT USING (account_id = current_setting('enterprise.account_id', true));
--> statement-breakpoint
ALTER TABLE enterprise.invitation ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE enterprise.invitation FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY tenant_scope ON enterprise.invitation USING (organization_id = current_setting('enterprise.organization_id', true)) WITH CHECK (organization_id = current_setting('enterprise.organization_id', true));
--> statement-breakpoint
CREATE POLICY invitee_read ON enterprise.invitation FOR SELECT USING (email = current_setting('enterprise.email', true));
--> statement-breakpoint
REVOKE UPDATE, DELETE ON enterprise.audit FROM enterprise_app;
--> statement-breakpoint
REVOKE UPDATE, DELETE ON enterprise.session_event FROM enterprise_app;
