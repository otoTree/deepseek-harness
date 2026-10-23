# Agent Note: Admin API URLs are runtime configuration

Status: implemented

English | [中文](2026-10-19-admin-runtime-api-url.zh.md)

## Problem

Embedding the enterprise API URL in the Admin JavaScript bundle requires a separate image build for each deployment environment. Operators need to promote the same Admin image while changing its public API address at deployment time.

## Decision

The Admin server reads `ADMIN_API_URL` after Next.js `connection()` opts the root layout into request-time rendering. It validates an HTTP(S) URL, defaults to the local API for development, and renders only that public URL in a React-escaped meta element. JSON and binary requests read the meta value and preserve credentialed requests and loopback cookie-host alignment. Missing or invalid browser configuration fails before credentials are sent.

This decision supersedes the API URL build argument in the [container publication decision](2026-10-17-enterprise-container-images.md); that note continues to own separate images, registry publication, and the supported API launcher. Static build variants remain governed by the [client build environment decision](2026-08-18-client-build-environment.md).

## Alternatives considered

**Embed `NEXT_PUBLIC_*` during the build.** Next.js substitutes these values into client JavaScript, coupling a deployment address to the published image.

**Rewrite compiled JavaScript at container startup.** Text replacement depends on bundle output and escaping, while request-time rendering exposes one explicit public value without mutating artifacts.

## Consequences

Image publication needs no API address. Changing the deployment variable requires restarting the Admin server and reloading the page; the browser must be able to reach the configured URL, and API browser-origin settings must allow the Admin origin. Dynamic page rendering requires a running Next.js server and gives up static HTML caching. API and model credentials are never included in the meta configuration. Verification covers configured JSON and binary destinations, invalid configuration rejection, and production serving with different runtime values from one build.
