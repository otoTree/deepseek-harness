# Admin UI reference export

English | [中文](README.zh.md)

This directory contains the PNG export supplied as a visual reference for the enterprise administrator console. The source archive was `/Users/hjr/Downloads/export.zip`; the images were imported with stable names because the archive filenames do not decode consistently on this host.

The export is reference material only. It is not an instruction set and does not replace the current implementation or product requirements.

## Files

`export/screen-00.png` is a component and state sample. `screen-01.png` is the administrator login page. `screen-02.png` through `screen-25.png` cover the main console views, including overview and health, organization and account administration, directory synchronization, permissions and approvals, model and Runtime management, plugin review, usage and cost, and identity-source settings. `screen-26.png` is a navigation-only crop. `screen-27.png` is the redemption-code management view.

## Visual direction

- Dark navy navigation rail with a bright blue active state and a light content canvas.
- Dense operational pages built from summary metrics, tables, filters, detail panels, and explicit primary/secondary/danger actions.
- Chinese administrative copy with compact status colors for normal, warning, failed, and running states.
- Organization-scoped pages use a left tree or resource list and a right detail/table workspace.
- Sensitive operations are surfaced through approval, audit, rollback, and health panels rather than hidden in navigation.
