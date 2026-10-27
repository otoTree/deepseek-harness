# Agent Note: Arivo project folders bind original Harness workspaces

Status: implemented

English | [中文](2026-10-25-arivo-project-folder-binding.zh.md)

## Problem

Account-wide creative tools and independently selected Workbench projects let a conversation edit content outside its folder. Creators need a project-centered entry while preserving the original Harness Agent and workspace ownership.

## Decision

The [native folder adapter](../../../../apps/electrobun/src/distribution/arivo-shell/host/project-folders.ts) checks the verified plugin account scope before the original in-app directory browser opens and revalidates that scope when the shell submits its selected path. The verified plugin owns unified creation: choose a parent for a named folder or adopt an existing folder, then create or authorize one cloud project and persist the immutable local/cloud mapping. Cancellation before selection creates nothing. A durable original command resumes disk or network interruptions; recovery never opens another chooser. The plugin also binds existing local projects to one canonical directory. The original Workspace Registry owns directory registration; interrupted registry acknowledgement is repaired by retrying the same binding.

The project conversation action uses a stable conversation UUID to create an original Harness Session in that registered workspace. Its tool-capable online model and immutable cloud billing IDs come from the project settings, verified again before creation and selected through the original Session model-selection command. Existing nonblank conversations and accepted model steps keep their selections. Newly assembled requests are checked against the folder project’s cloud billing IDs; mismatches refuse rather than silently changing billing scope. The [tool adapter](../../../../apps/electrobun/src/distribution/arivo-shell/host/studio-tools.ts) derives its project from trusted Session header.cwd. Workbench resolves the current Session through header-validated registry membership and opens the exact project. Missing bindings fail visibly. The iframe and model cannot supply filesystem paths.

The startup Client opens the project center while retaining original conversations, Skills/MCP, presets, marketplace and Workbench. The independent plugin routes creative SQLite and originals through its project-folder storage and records cloud identity separately without credentials. The Harness consumes only the built release; account credentials, ordinary conversation journals and registry ownership remain outside project folders. Portable moves and content synchronization are separate work.

## Alternatives considered

**Implicit current project.** Reusing the last visible project permits cross-project edits when a conversation changes folders. The native directory binding supplies explicit authority.

**Immediate storage relocation.** Moving existing SQLite, media and receipts without project-level migration and recovery would risk existing work. Folder registration is additive and names its storage mode.

## Consequences

Folder-selected conversations and Workbench share project identity without introducing a second Agent loop. The plugin owns account and project validation; the OS owns sessions and its directory browser. Enterprise composition and dependency versions remain unchanged. Creation opens content after folder, cloud identity and original Workspace registration succeed; interrupted registration retries the same command. Online project membership is checked by the plugin. Project model choices and existing local project cloud ownership live in Project settings; general model defaults remain available in shell Settings. Portable moves remain separate unfinished work.

## Testing

Native selection tests cover unified creation, recovery after registry failure without another chooser, cancellation, account replacement, registry interruption, bound Workbench lookup conversation registration, verified model inheritance and foreign/missing billing-scope refusal. Original tool-registry tests verify Session-derived authority, missing folders and sanitized acquisition failures. Packaged product acceptance exercises folder selection, an original Session and the matching Workbench project. Recorded Agent replay checks project billing scope before every model request while preserving local tool execution and handle disposal. Windows and formal release acceptance remain separate.
