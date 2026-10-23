# Agent Note: Enterprise runtime images carry production artifacts

Status: implemented

English | [中文](2026-10-21-enterprise-container-runtime-payloads.zh.md)

## Problem

Copying `/workspace` from a build stage makes each service image contain every workspace dependency, development tool, source tree and local artifact admitted by the build context. Desktop installer outputs can add gigabytes even though neither service loads them. The runtime payload depends on unrelated local work and makes registry publication and deployment unnecessarily expensive.

## Decision

The Admin build enables Next.js standalone output with the repository as its tracing root. Its runtime image copies only the traced server and static assets and executes `apps/admin/server.js` with Node. `ADMIN_API_URL` remains a runtime value. Changes to the browser application are outside this packaging decision.

The API build uses pnpm's production deployment with a hoisted, portable dependency tree. A [deployment hook](../../../../infra/enterprise/docker/api-deploy.pnpmfile.cjs) includes the supported CLI in the API dependency selection without adding it to the API's source manifest. The workspace's `link:` overrides for Cosmokit and Schemastery are omitted by legacy deploy, so the runtime explicitly copies their manifests, licenses and compiled libraries. The runtime copies the deployed dependency tree and explicitly named CLI/API build outputs, API migrations and patch, startup initialization script, prepared profile and shell entrypoint. It retains the supported `dsh --profile enterprise-api` launch path and automatic database initialization.

The Docker context excludes desktop build and installer outputs, Web distribution outputs and documentation build caches. Runtime stages copy selected artifacts into the Node image; deleting unwanted files after copying the workspace would leave their bytes in earlier image layers.

The [image publication decision](2026-10-17-enterprise-container-images.md) retains registry naming, platform selection and independent service images. The [initialization decision](2026-10-20-enterprise-container-initialization.md) retains database startup behavior. Neither decision requires a full workspace in a runtime image.

## Alternatives considered

**Copy the workspace and delete development files in a later layer.** Docker retains those files in the copied layer, so downloads remain large. An explicit runtime selection avoids both the layer cost and accidental inclusion of local installers.

**Bundle the API into a new direct Node server entrypoint.** The supported application launch uses a dsh profile. Replacing it would change lifecycle and plugin-loading behavior to solve a packaging problem. A production dependency deployment preserves that entrypoint.

**Change the base image to Alpine.** A smaller base does not remove workspace artifacts, and switching libc changes native dependency compatibility. The Debian Node base remains consistent with the build runtime.

## Consequences

Image contents are independent of local desktop installers. The Admin runtime needs neither pnpm nor the full Next.js build cache. The API retains the CLI's production dependencies, including packages used by other CLI modes; further reduction requires a separate decision about launcher dependency ownership. Build stages still need development tooling and workspace sources. Native dependencies are deployed inside the target Linux build, never copied from the operator's host.

## Testing

Validation builds the Admin standalone output and target-platform runtime images, inspects runtime payloads and sizes, and exercises HTTP pages, static assets and runtime API URL selection. The Backend smoke uses the real entrypoint and supported profile against isolated PostgreSQL, checking initial migrations, administrator login, authenticated reads and preservation across restart.
