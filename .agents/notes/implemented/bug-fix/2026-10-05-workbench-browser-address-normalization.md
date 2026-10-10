# Agent Note: Workbench browser address normalization

Status: implemented

English | [中文](2026-10-05-workbench-browser-address-normalization.zh.md)

## Problem

The Workbench address bar passed a bare domain such as `baidu.com` directly to the native WebView. The WebView requires an absolute URL, so navigation could remain on a blank page without a visible failure.

## Decision

The browser panel normalizes trimmed address-bar input before either native or provider-backed navigation. Bare domains receive the `https://` scheme; `http://`, `https://`, and `about:blank` remain supported. Invalid or unsupported addresses produce a localized alert instead of being ignored.

## Alternatives considered

**Require users to enter a complete URL.** This preserves the lower-level API requirement but leaves a common address-bar input silently ineffective.

**Relax the BrowserService URL policy.** This would move presentation convenience into a shared capability and weaken the explicit absolute-URL contract used by other consumers.

## Consequences

Desktop and Web fallback navigation use the same normalized value. A successful bare-domain submission is reflected in the address bar as an HTTPS URL, while unsupported schemes fail before the WebView or Host provider is called.

## Testing

The browser panel Client spec covers bare-domain normalization in the native WebView and visible rejection of an unsupported scheme. Package typechecking and the `ui-workbench` bundle both pass.
