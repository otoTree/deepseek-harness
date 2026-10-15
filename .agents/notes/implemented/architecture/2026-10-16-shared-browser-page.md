# Agent Note: Workbench and Agent tools share one native Chromium page

Status: implemented

English | [中文](2026-10-16-shared-browser-page.zh.md)

## Problem

A native WebView and a separately launched Playwright page have separate DOM, cookies, and form state. URL synchronization cannot let Agent tools operate the user's visible page. Routing Workbench browser calls to a hidden capability Runtime also separates them from tools owned by the chat Session.

## Decision

The desktop embeds CEF Chromium guests and the browser provider attaches through loopback CDP to those exact pages. The chat Session owns the browser registry used by both Workbench Remotes and Agent tools; hidden Runtime ownership remains limited to terminal capabilities. This partially supersedes browser presentation and resource identity in the [Session-following Workbench decision](2026-09-19-session-following-workbench.md), while retaining persistent native storage isolation.

The provider issues an unguessable blank attachment URL before the Client mounts its native guest. Attachment waits for the exact URL in HTTP target discovery before opening a per-tab CDP connection, navigates once, and shares one readiness promise across concurrent operations. CEF does not reliably announce new native guests to existing CDP connections. An ambiguous or missing guest fails explicitly. The provider never creates a replacement automation page. Each persistent guest partition includes the organization Runtime identity and chat Session identity. Tools read the attached page's actual accessibility tree; native observations update tab metadata.

Workbench retains guests while switching panels, collapsing details, or reconnecting. Electrobun 2.0.1 can fail its first synchronous guest creation while a named CEF request context initializes; one configurable startup deadline allows a single recreation of an unready guest. Ready pages are never recreated by this deadline. Switching chat Sessions remounts the Session-scoped view and loses unsaved DOM state, while partition storage persists. Disposal disconnects CDP; the native view owns page destruction and the desktop owns the Chromium process. On macOS, Electrobun 2.0.1 emits an extra parent-window close request when removing a loaded CEF guest. The desktop tracks committed guest navigation and consumes one such request per removal, preserving later user window closes. The startup deadline begins on the first animation frame because WKWebView pauses native tag initialization while hidden.

Native guests start transparent with input passthrough. Electrobun ignores visibility methods until its asynchronous native creation assigns the tag id; CSS visibility does not hide the native surface. Workbench observes that id registration and synchronizes native visibility with the current panel and selected tab, independently of document readiness events. Hidden guests retain their live page without covering other panels or intercepting input.

The upstream [Electron guest host](https://github.com/deepseek-ai/deepseek-harness/blob/master/apps/desktop/src/browser-guests.ts) owns Chromium guest lifetimes and partitions, while its [native Stagehand provider](https://github.com/deepseek-ai/deepseek-harness/blob/master/packages/experimental/browser-use-stagehand-native/src/native.ts) attaches to an explicit CDP page target. Electrobun supplies the equivalent embedded Chromium renderer and the registry-issued attachment URL binds the guest to its provider tab.

## Alternatives considered

**Synchronize URLs and cookies between engines.** This does not reproduce live DOM, in-memory state, focus, or pending navigation and can duplicate requests.

**Display screenshots and forward input.** This loses native browser interaction, reflow, clipboard integration, and continuous media presentation. The desktop viewport renders the actual native guest.

## Consequences

Manual input and Agent actions share one document and authentication state within a mounted Session. The desktop ships CEF and exposes its debugging listener on loopback; ordinary Web deployments cannot embed this native viewport. Launch-mode browser settings apply only when the provider launches its own browser. A website may still require human verification based on its browser, account, or network checks.

Focused Client, browser service, provider, and Controller regressions cover native mounting, attachment ownership, concurrent readiness, tab lifecycle, metadata updates, and reconnection. The keyless [recorded Session](../../../../snapshots/session/browser-shared-page/snapshot.yml) verifies that Agent tools read and submit manual input without a second navigation.

A native CEF smoke verifies shared form input, Agent fill and submission, exactly one document load, and preservation of the host window and unrelated guests after removing the tested guest.
