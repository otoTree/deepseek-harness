# Agent Note: Enterprise windows use an application-owned title bar

Status: implemented

English | [中文](2026-10-05-enterprise-application-window-chrome.zh.md)

## Problem

Native title-bar close behavior varies across desktop environments and can bypass the lifecycle handling needed by enterprise and independent plugin windows. The independent window bridge also needs its controls to remain unavailable until the WebView bridge has been installed.

## Decision

Trusted workspace windows and declared independent plugin windows hide the native title bar and render a shared Web title bar. The workspace is marked with `dshWindowChrome=1`; plugin windows use their existing `dshPluginWindow=1` marker and a narrow `__dshWindowChrome` bridge. The three controls call only native close, minimize, and maximize/restore operations, and stay disabled until the corresponding bridge-ready event.

The account window remains native-framed because it loads an unauthenticated page and does not receive either bridge.

## Alternatives considered

**Keep the native title bar.** This preserves platform defaults but leaves close and window-state behavior outside the enterprise host lifecycle and varies across desktop environments.

**Expose the full native bridge to plugin pages.** This would let independently loaded plugin content invoke unrelated host capabilities instead of receiving only the three window operations it needs.

## Consequences

Window lifecycle operations now pass through explicit host-owned RPC handlers. The browser shell has one title-bar implementation for workspace and plugin windows, while untrusted account pages retain the platform frame.
