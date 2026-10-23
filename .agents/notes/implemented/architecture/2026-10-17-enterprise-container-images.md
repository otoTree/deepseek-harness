# Agent Note: Enterprise services publish reproducible amd64 container images

Status: implemented

English | [中文](2026-10-17-enterprise-container-images.zh.md)

## Problem

The enterprise Admin and API applications had local development commands but no repeatable container build or registry publication path. The API's loopback-only listener also could not accept traffic through a container port.

## Decision

The repository owns separate Dockerfiles for the Admin and enterprise API under `infra/enterprise/docker/`. `scripts/build-and-push-images.sh`, exposed as `pnpm run image:push`, selects `linux/amd64`, tags both images with the current commit and `latest`, and pushes them to a configurable registry prefix that defaults to `ccr.ccs.tencentyun.com/imags`. The [Admin runtime configuration decision](2026-10-19-admin-runtime-api-url.md) owns API URL delivery. The API accepts `0.0.0.0` through `ENTERPRISE_API_HOST`; the local default remains `127.0.0.1`.

## Alternatives considered

**Publish one combined image.** Separate images let the Admin and API scale, restart, and update independently while matching their separate application runtimes.

**Keep the API loopback-only and require host networking.** Host networking is platform-specific and prevents ordinary container networking. An explicit, validated bind address keeps local behavior safe while making the container listener usable.

## Consequences

The [runtime payload decision](2026-10-21-enterprise-container-runtime-payloads.md) owns isolated production artifacts and preserves the supported `dsh` profile launcher. Registry credentials stay outside the repository; the operator must authenticate Docker before running the publication command. `REGISTRY_PREFIX`, `IMAGE_TAG`, and `PLATFORM` control image publication without editing source files.

Database initialization is governed by the [container initialization decision](2026-10-20-enterprise-container-initialization.md).
