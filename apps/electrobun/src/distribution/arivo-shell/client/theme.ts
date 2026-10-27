/** Product-owned token layer covers OS surfaces and body-mounted dialogs in both palettes. */
import type { ThemeTokenOverrides } from '@deepseek-ai/dsh-client-ui-theme/client'

declare const ARIVO_THEME_CSS: string

// Every OS surface resolves the same public Web palette; only semantic roles are mapped here.
const roles: Record<string, string> = {
  '--dsw-alias-bg-base': 'bg',
  '--dsw-alias-bg-layer-1': 'surface', '--dsw-alias-bg-layer-2': 'raised', '--dsw-alias-bg-layer-3': 'panel',
  '--dsw-alias-bg-overlay': 'raised', '--dsw-alias-bg-module-platform': 'surface', '--dsw-alias-bg-multi-select': 'panel',
  '--dsw-alias-border-l1': 'border', '--dsw-alias-border-l2': 'border', '--dsw-alias-border-l3': 'border',
  '--dsw-alias-border-l4': 'muted', '--dsw-alias-border-l2-darkmode-thin': 'border',
  '--dsw-alias-brand-primary': 'text', '--dsw-alias-brand-primary-invert': 'bg',
  '--dsw-alias-brand-primary-new-colorprimary-new-color': 'text', '--dsw-alias-brand-text': 'text',
  '--dsw-alias-button-elevated-fill': 'raised', '--dsw-alias-button-floating-fill': 'surface',
  '--dsw-alias-button-floating-hover': 'panel', '--dsw-alias-button-ghost-active-border': 'muted',
  '--dsw-alias-button-ghost-active-fill': 'panel', '--dsw-alias-button-ghost-active-hover': 'hover',
  '--dsw-alias-button-primary-fill': 'button-primary-bg', '--dsw-alias-button-primary-hover': 'button-primary-hover',
  '--dsw-alias-button-primary-dimmed': 'panel', '--dsw-alias-button-info-fill': 'text', '--dsw-alias-button-info-hover': 'text',
  '--dsw-alias-interactive-bg-active': 'panel', '--dsw-alias-interactive-bg-hover': 'nav-hover',
  '--dsw-alias-interactive-bg-hover-accent': 'panel', '--dsw-alias-interactive-bg-hover-solid': 'panel',
  '--dsw-alias-label-primary': 'text', '--dsw-alias-label-primary-bluish': 'text', '--dsw-alias-label-primary-dimmed': 'secondary',
  '--dsw-alias-label-secondary': 'secondary', '--dsw-alias-label-tertiary': 'muted', '--dsw-alias-label-caption': 'caption',
  '--dsw-alias-label-dimmed': 'caption', '--dsw-alias-label-primary-foreground': 'button-primary-text', '--dsw-alias-label-primary-inverted': 'bg',
  '--dsw-alias-link': 'text', '--dsw-alias-state-business-primary': 'text',
  '--dsw-alias-markdown-code-block': 'surface', '--dsw-alias-markdown-code-block-banner': 'raised', '--dsw-alias-markdown-inline-code': 'panel',
  '--dsw-specific-sidebar-fill': 'bg', '--dsw-specific-sidebar-nav-item-active': 'panel',
  '--dsw-specific-sidebar-nav-item-active-accent': 'panel', '--dsw-specific-shell-navigation-active': 'panel',
  '--dsw-specific-sidebar-nav-item-hover': 'nav-hover', '--dsw-specific-bubble': 'raised', '--dsw-specific-bubble-highlight': 'panel',
  '--dsw-specific-input-major': 'control', '--dsw-specific-login-input': 'control', '--dsw-specific-menu': 'raised', '--dsw-specific-selector': 'panel',
}

/** OS semantic roles follow the shared palette in either persisted appearance. */
export const arivoTokens: ThemeTokenOverrides = Object.fromEntries(
  Object.entries(roles).map(([name, role]) => [name, { light: `var(--arivo-${role})`, dark: `var(--arivo-${role})` }]),
)

/** These classes belong to the startup plugin; shared OS CSS remains unchanged. */
export const arivoStyles = ARIVO_THEME_CSS + `
body[data-arivo-shell]{--dsw-radius-control:var(--arivo-control-radius);--dsh-control-radius-sm:var(--arivo-control-radius);--dsh-control-gap:8px;--dsh-control-font-size:var(--arivo-button-font-size);--dsh-input-height:44px;--dsh-input-border-width:1px;--dsh-input-surface:var(--arivo-field-bg);--dsh-input-focus-shadow:var(--arivo-control-focus-ring);--dsh-shell-surface:transparent;--dsh-layout-column-transition:none;--dsh-context-tools-tint:var(--arivo-secondary);--dsw-font-family:var(--arivo-font-ui);--dsw-font-family-data:var(--arivo-font-ui);--ds-font-family-code:var(--arivo-font-code);font-family:var(--arivo-font-ui);background-color:var(--arivo-bg);background-image:var(--arivo-glow);background-position:clamp(-180px,-10vw,-88px) clamp(-130px,-7vw,-56px);background-size:clamp(760px,72vw,1120px) auto;background-repeat:no-repeat;background-attachment:fixed}

.arivo-model-settings{width:100%;max-width:760px;margin:0 auto;padding:32px;box-sizing:border-box;color:var(--dsw-alias-label-primary)}
.arivo-model-settings p{line-height:1.6}.arivo-model-hint{color:var(--dsw-alias-label-secondary);font-size:13px}
.arivo-model-field{display:grid;gap:8px;margin:20px 0}.arivo-model-field select{width:100%;padding:12px;border:1px solid var(--dsw-alias-border-l3);border-radius:var(--arivo-control-radius);background:var(--arivo-field-bg);color:inherit}
.arivo-model-settings button{padding:10px 18px;border:1px solid var(--dsw-alias-border-l3);border-radius:var(--arivo-control-radius);background:var(--dsw-specific-selector);color:inherit;cursor:pointer}
.arivo-model-settings button:disabled{opacity:.5;cursor:default}.arivo-model-settings :focus-visible{outline:2px solid var(--dsw-alias-label-primary);outline-offset:3px}
.arivo-model-settings .arivo-model-save{background:var(--dsw-alias-button-primary-fill);color:var(--dsw-alias-label-primary-foreground);margin-right:12px}
.arivo-rail-item{width:36px;height:36px;display:grid;place-items:center;border:0;border-radius:8px;color:var(--dsw-alias-label-caption);background:transparent;cursor:pointer}
.arivo-rail-item:hover{color:var(--dsw-alias-label-primary);background:var(--dsw-specific-sidebar-nav-item-hover)}
.arivo-rail-item[aria-pressed=true]{color:var(--dsw-alias-label-primary);background:var(--arivo-nav-active)}
.arivo-rail-item img{width:24px;height:24px;object-fit:contain}.arivo-brand-mark{object-fit:contain}
body:not([data-ds-dark-theme]) .arivo-brand-mark,body:not([data-ds-dark-theme]) .arivo-rail-item img{filter:invert(1)}
.arivo-topbar{height:48px;display:flex;align-items:center;gap:12px;padding:0 20px;border-bottom:1px solid var(--arivo-border);color:var(--arivo-text);background:transparent}
.arivo-topbar-logo{display:block;width:100px;height:auto;max-height:30px;object-fit:contain;flex-shrink:0}
body:not([data-ds-dark-theme]) .arivo-topbar-logo{filter:invert(1)}
.arivo-topbar-title{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--arivo-secondary);font-size:12px}
.arivo-topbar-session{display:flex;align-items:center;min-width:0}.arivo-topbar-local{margin-left:auto;flex-shrink:0;color:var(--arivo-caption);font-size:11px}
.arivo-topbar-icon{display:grid;place-items:center;width:32px;height:32px;flex-shrink:0;border:1px solid transparent;border-radius:var(--arivo-control-radius);background:transparent;color:var(--arivo-secondary);cursor:pointer}
.arivo-topbar-icon:hover,.arivo-topbar-icon[aria-pressed=true]{background:var(--arivo-panel);color:var(--arivo-text)}
.arivo-topbar :focus-visible{outline:2px solid var(--arivo-control-focus);outline-offset:2px}
.arivo-model-field{color:var(--arivo-secondary);font-size:12px}.arivo-model-field .arivo-control-button{justify-content:space-between;width:100%;height:44px;background:var(--arivo-field-bg);border-color:transparent;font-size:13px;text-align:left}.arivo-model-settings button.arivo-model-save{background:var(--arivo-button-primary-bg);color:var(--arivo-button-primary-text);border-color:transparent;border-radius:var(--arivo-control-radius)}
.arivo-model-popup{position:fixed;inset:auto;margin:0;box-sizing:border-box;z-index:1100;padding:6px;border:1px solid var(--arivo-border);border-radius:12px;background:var(--arivo-menu-bg);color:var(--arivo-text);box-shadow:0 16px 40px #0005;max-height:280px;overflow:auto;font-family:var(--arivo-font-ui)}.arivo-model-popup::backdrop{display:none}.arivo-model-popup button{display:flex;justify-content:space-between;gap:20px;width:100%;min-height:34px;border:0;border-radius:6px;background:transparent;color:var(--arivo-secondary);padding:8px 10px;text-align:left;font:inherit;font-size:12px;cursor:pointer}.arivo-model-popup button:hover,.arivo-model-popup button:focus-visible{background:var(--arivo-panel);color:var(--arivo-text);outline:0}.arivo-model-choice{position:relative;min-width:0}
@media(max-width:600px){.arivo-topbar{padding-inline:12px;gap:8px}.arivo-topbar-logo{width:78px}.arivo-topbar-local{display:none}}
/* Product settings share the shell backdrop; generic settings retain their default styling. */
body[data-arivo-shell] [data-settings-page]{background:transparent}
body[data-arivo-shell] [data-settings-nav]{width:196px;padding:24px 12px;background:transparent;border-right:1px solid var(--arivo-border)}
body[data-arivo-shell] [data-settings-section]{height:38px;padding:8px 10px;border-radius:8px;font-size:13px;color:var(--arivo-secondary)}
body[data-arivo-shell] [data-settings-section][aria-current=page]{background:var(--arivo-nav-active);color:var(--arivo-text)}
body[data-arivo-shell] [data-settings-header]{min-height:56px;padding:12px 28px 8px}
body[data-arivo-shell] [data-settings-options]{max-width:none;padding:0 28px 28px}
body[data-arivo-shell] [data-settings-options^="arivo."]{padding:0;overflow:hidden}
body[data-arivo-shell] [data-settings-options] .arivo-model-settings{max-width:840px;padding:20px 28px 32px}
@container(max-width:720px){body[data-arivo-shell] [data-settings-nav]{width:100%;padding:16px 20px 8px;border-right:0;border-bottom:1px solid var(--arivo-border)}body[data-arivo-shell] [data-settings-header]{padding:10px 20px}body[data-arivo-shell] [data-settings-options]:not([data-settings-options^="arivo."]){padding:8px 20px 24px}}
/* Startup creative slots occupy the center beside the permanent OS rail. */
body[data-arivo-pane] [data-main-page]{grid-template-columns:56px 0px minmax(0,1fr) 0px!important;transition:none!important}
.arivo-pane{width:100%;height:100%;min-height:440px;border:0;display:block;background:transparent}
.arivo-workbench-pane{min-height:0;height:100%}.arivo-workbench-open{border:0;border-radius:6px;padding:6px 10px;background:var(--arivo-panel);color:var(--arivo-text);font:inherit;cursor:pointer}
.arivo-pane-status{padding:32px;color:var(--dsw-alias-label-secondary)}
.arivo-pane-status button{padding:8px 16px;border:1px solid var(--dsw-alias-border-l3);border-radius:999px;background:var(--dsw-alias-button-primary-fill);color:var(--dsw-alias-label-primary-foreground)}

[data-arivo-shell] .arivo-story-rail{border-top:1px solid var(--dsw-alias-border-l3);padding:14px 8px;min-width:0;width:100%;max-height:42vh;display:flex;flex-direction:column;gap:12px;color:var(--dsw-alias-label-primary)}
[data-arivo-shell] .arivo-story-rail header{display:flex;align-items:center;gap:8px}
[data-arivo-shell] .arivo-story-rail h2{font-size:13px;font-weight:600;margin:0}
[data-arivo-shell] .arivo-story-rail header>button{margin-left:auto;font-size:20px}
[data-arivo-shell] .arivo-story-rail button{background:transparent;color:inherit;border:0;border-radius:8px;cursor:pointer}
[data-arivo-shell] .arivo-story-rail button:disabled{opacity:.45;cursor:default}
[data-arivo-shell] .arivo-canvas-rail-row{display:grid;grid-template-columns:minmax(0,1fr) 26px 26px;align-items:center;gap:3px}
[data-arivo-shell] .arivo-story-rail-list{overflow:auto;min-height:0;display:grid;gap:8px}
[data-arivo-shell] .arivo-story-episode{display:flex;flex-direction:column;align-items:stretch;text-align:left;width:100%;padding:9px 10px;gap:5px}
[data-arivo-shell] .arivo-story-episode span{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
[data-arivo-shell] .arivo-story-episode small{opacity:.6;font-size:11px}
[data-arivo-shell] .arivo-story-episode[aria-current=page],[data-arivo-shell] .arivo-story-episode:hover{background:var(--dsw-specific-sidebar-nav-item-active)}
[data-arivo-shell] .arivo-story-episode-actions{display:flex;gap:12px;padding:0 10px 4px;font-size:11px}
`
