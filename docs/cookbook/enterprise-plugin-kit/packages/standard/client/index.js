// src/client.ts
var name = "acme-enterprise-report-client";
var inject = ["slots"];
function apply(ctx) {
  ctx.slots.inject("settings.section", () => ctx.slots.register({
    name: "settings.section",
    id: "acme-report-settings",
    order: 80,
    label: "Acme report"
  }, () => "Acme report plugin is installed and active."));
}
export {
  apply,
  inject,
  name
};
