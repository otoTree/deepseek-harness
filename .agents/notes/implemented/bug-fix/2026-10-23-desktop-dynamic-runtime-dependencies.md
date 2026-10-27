# Agent Note: Desktop dynamic plugin dependency closure

Status: implemented

English | [中文](2026-10-23-desktop-dynamic-runtime-dependencies.zh.md)

## Problem

The native desktop loads Host plugins outside the CLI's static dependency closure. A development bundle can build its executable while omitting a plugin peer, then fail the isolated import check with a missing session-persistence package.

## Decision

The [runtime builder](../../../../apps/electrobun/scripts/build-runtime.ts) selects the desktop's published dependencies and their workspace peers for both development and installer builds. It materializes the selected packages into the runtime tree and removes the temporary deployment hook after deployment. The API server remains outside the desktop runtime dependency selection.

This complements the [installer protection decision](../architecture/2026-10-19-local-desktop-installer-protection.md); its protection, native launcher and official Node distribution choices remain active.

## Alternatives considered

**Add only the missing session-persistence package.** This treats one missing peer while leaving the same failure possible for every other dynamically loaded Host plugin.

**Skip the isolated import verification.** A successful build would conceal an application that cannot load its shipped plugin composition.

## Consequences

Development staging includes the same published Host dependency closure as installer staging. The existing [build verifier](../../../../apps/electrobun/scripts/verify-build.ts) imports the copied enterprise Host entry with plain Node outside the checkout and rejects missing or escaping dependencies. The reproduced development build fails before the selection change and passes afterward; native Windows acceptance remains a separate requirement.
