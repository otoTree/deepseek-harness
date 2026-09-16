# Agent Note: Cross-engine JSON container recognition

Status: implemented

English | [中文](2026-09-16-cross-engine-json-containers.zh.md)

## Problem

Lossless JSON validation recognizes plain objects and arrays from another JavaScript realm by inspecting their intrinsic constructor. The native-function text was compared with Node's exact single-line rendering. JavaScriptCore and Bun render the same intrinsic with line breaks, so Web clients rejected ordinary objects received from Remote streams. Assistant history expansion then failed inside event-feed subscribers even though the persisted stream contained valid JSON.

## Decision

Intrinsic constructor recognition normalizes whitespace in `Function.prototype.toString` output before comparing it with the native `Object` or `Array` form. Constructor name and prototype identity checks remain required. User-authored bodies, comments containing `[native code]`, mismatched constructors, class instances, forged prototypes, and decorated containers remain invalid.

Enterprise development startup builds all Client bundles after the Host graph. The browser plugin roster contains several independent bundles that embed shared Client-safe utilities; rebuilding only session-controller can leave UI subscribers on an older implementation.

## Alternatives considered

**Accept every constructor with the expected name and prototype.** User code can forge both properties. Retaining the native-function source check preserves the distinction between intrinsic and authored constructors.

**Special-case Assistant stream chunks.** Remote frames, durable events, tools, and other browser inputs share the same JSON predicate. Bypassing it for one stream would retain the cross-engine defect everywhere else and weaken that stream's validation.

**Rebuild only the session-controller Client bundle.** UI chat, trajectory, and other plugin bundles can independently embed JSON and Assistant-stream helpers. A partial build does not make the running browser graph current.

## Consequences

Node, JavaScriptCore, and Bun plain containers pass the same lossless JSON rules. The accepted source variation is limited to whitespace, so the existing exotic-container rejection remains intact. Enterprise startup spends additional time rebuilding the complete Client bundle set, but every dynamically served browser plugin uses current shared code.
