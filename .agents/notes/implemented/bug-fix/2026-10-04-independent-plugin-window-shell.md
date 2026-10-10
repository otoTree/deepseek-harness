# Agent Note: Independent plugin windows use a plugin-owned shell

Status: implemented

English | [中文](2026-10-04-independent-plugin-window-shell.zh.md)

## Problem

An independent Client window reused the Web application's document and global shell styles. The URL identified the plugin window, but the parent navigation, session layout, and theme presentation remained visible around the plugin contribution.

## Decision

The native window broker marks every declared plugin window with `dshPluginWindow=1`. The Web boot kernel requires that marker together with the declared plugin identity and instance fields, clears the boot document, marks the document as plugin-window content, and leaves rendering to the mounted Client target. Plugin window content owns its title and local presentation styles after mounting.

## Alternatives considered

**Keep the parent Web shell and hide selected panels.** This leaves parent-owned layout and styles coupled to plugin windows and allows new shell changes to leak into independent surfaces.

**Create a second application entry for every plugin.** This duplicates the module boot and Client target lifecycle and would bypass the existing manifest-scoped window service.

## Consequences

Independent windows still use the shared authenticated Web runtime and Client target activation, while their document is cleared before the plugin contribution renders. A plugin must provide the visual shell for its declared window surface; the host supplies only the window frame and the authenticated page transport.
