# Development Method

English | [中文](development-method.zh.md)

## Summary

DeepSeek Harness is developed as a tree of replaceable Cordis plugins. A feature normally joins the tree through a service, provider, consumer, or event listener, and a profile composes those pieces into a runnable application. Durable facts live in the Session log, while live behavior uses Agent and capability events. This guide gives contributors a repeatable path from a requirement to verified code.

## Table of Contents

- [Start with ownership](#start-with-ownership)
- [Choose the extension point](#choose-the-extension-point)
- [Design a capability seam](#design-a-capability-seam)
- [Record model-visible facts](#record-model-visible-facts)
- [Compose the application](#compose-the-application)
- [Handle client and cloud plugins](#handle-client-and-cloud-plugins)
- [Implement and document](#implement-and-document)
- [Verify the change](#verify-the-change)
- [Further Exploration](#further-exploration)
- [Dev Note](#dev-note)

-----

<a id="start-with-ownership"></a>
## Start with ownership

Read [the architecture](../architecture.md), the owning package README, and the nearest tests before editing code. Classify the requirement as a capability, provider, consumer, policy, protocol adapter, durable state change, or presentation change. Put behavior in the package that owns that responsibility; use a new package only when an existing group cannot own it.

<a id="choose-the-extension-point"></a>
## Choose the extension point

Prefer a documented extension point over a change to the agent loop. Register model tools with `ctx.tools`, model providers with `ctx.llm`, shell implementations with `ctx.shell`, and UI or protocol adapters through `ctx.agents` and Session events. Intercept requests and tool execution with the corresponding `agent/*` or `tools/*` events. Waterfall listeners must call `next()` when they delegate.

<a id="design-a-capability-seam"></a>
## Design a capability seam

A swappable capability has three roles: a Service Definition owns the stable vocabulary and `ctx` key, a Provider implements the capability, and a Consumer uses it. Separate the roles into packages when they evolve independently. Keep consumers dependent on the definition rather than a concrete provider, and make every registration reversible through Cordis effects.

<a id="record-model-visible-facts"></a>
## Record model-visible facts

The Session log is the source of the context sent to the model. If new input, state, or tool output can reach a model request, add the corresponding durable event and derive the model view from that log. Use live Agent events for transient progress, such as assistant stream chunks; use Session events for replay, recovery, UI reconstruction, and telemetry.

Keep the lifecycle vocabulary precise: a step is one model request and its tool executions, a turn drains admitted input and may contain several steps, and a round belongs to an outer policy such as goals or Ralph. Store counters and limits at the level that owns them.

<a id="compose-the-application"></a>
## Compose the application

Applications launch through `dsh` profiles. Add a plugin to a bundle or profile patch, then inspect the resulting tree with `dsh --profile <name> --dump-config`. Keep deployment-varying choices in validated configuration. Do not add a package bin, demo launcher, or inline application tree that bypasses the supported profile entry.

<a id="handle-client-and-cloud-plugins"></a>
## Handle client and cloud plugins

Keep the user's local Host runtime distinct from a cloud Server Plugin runtime. The current dynamic runner loads a Host half in the local process and a Browser half in the Client page; it does not yet download a cloud plugin from object storage. A future cloud resolver should obtain and verify a published Client artifact, then hand it to `dsh-cordis-client-runner`, whose existing evaluator, guard, Loader mount, and disposer lifecycle remain responsible for loading and unloading it.

A pure cloud Server Plugin has a corresponding local plugin in the user's composition. The local plugin owns the Agent-facing tool, prompt, or UI registration and calls the cloud plugin through the repository's typed Remote and Connection mechanisms. The cloud gateway dispatches that call to the matching Server Plugin; the Agent receives neither the Server Plugin code nor its credentials. If an Agent runs in the cloud, the corresponding server-side plugin can register the tool there instead. In either location, the tool call and result remain Session facts and must pass the normal `tools/*` pipeline.

The local pair is required for a local Agent to reach a pure cloud plugin. A cloud release by itself does not add a tool to any local Agent; the local plugin must be installed, mounted, and granted to that Agent before its capability can appear in the next model request.

Treat a plugin's running state and an Agent's capability grant as separate decisions. Mounting a Client Plugin does not automatically expose every tool to every Agent. Register tools and prompt contributions in the intended Agent scope or preset, and remove them through the same Cordis disposer when the plugin is stopped.

<a id="implement-and-document"></a>
## Implement and document

Keep public contracts explicit in TypeScript and JSDoc. Update the owning README with purpose, configuration, extension points, model-visible behavior, and known limitations. Update Session events, SDK projections, and bilingual documentation whenever the change affects those surfaces. Non-trivial changes also require an Agent Note that records the accepted design and its verification requirements.

<a id="verify-the-change"></a>
## Verify the change

Select checks from the changed surface. Run focused unit tests for local logic, a Loader-based real-composition test for product-visible plugins, snapshots for model-, protocol-, or human-visible output, and built-artifact smokes for published entry points. Use real-API e2e tests when credentials are available. At minimum, run the relevant `pnpm run typecheck`, `pnpm run lint`, `pnpm run test:docs`, `pnpm run doc-sync`, or `pnpm run build` checks required by the change; finish with `git diff --check`.

Verify the world outside the component under test: re-read files, replay the session, or invoke the built profile. A green mock test is not evidence that the shipped composition loads or that durable output is correct.

## Further Exploration

- [Architecture](../architecture.md) — composition, lifecycle, seams, and extension points.
- [Development guide](../development.md) — repository setup, TypeScript projects, and daily commands.
- [Testing](../testing.md) — test tiers, snapshots, and real-entry verification.
- [Extension cookbook](../cookbook/extension-cookbook.md) — worked plugin patterns.
- [Glossary](../glossary.md) — canonical terms for turns, scopes, goals, and seams.

## Dev Note

None.
