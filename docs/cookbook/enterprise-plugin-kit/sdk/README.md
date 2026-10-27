# Offline SDK bundle

English | [中文](README.zh.md)

These archives are the public SDK artifacts used by the sample kit. They are copied from one platform release and are provided so an external author can run `pnpm install` without a Harness checkout or an SDK registry.

| Archive | SHA-256 |
| --- | --- |
| `deepseek-ai-dsh-plugin-protocol-0.1.3-alpha.5.tgz` | `880fe005fab217daaf7560b7a6dd2eddd09b836a59f0f13d2037dde6b2cd362b` |
| `deepseek-ai-dsh-plugin-sdk-0.1.3-alpha.5.tgz` | `6830f9e5ea715527a40c5fea842b5bc9b41bfdc2edee9e043342b23092769c9e` |
| `deepseek-ai-dsh-plugin-runtime-0.1.3-alpha.1.tgz` | `309922effd2eb172e6092faea03e3ab3e7b0851a51e76a3c6ac4e05a87367d0d` |

The sample `package.json` installs protocol and SDK from these local archives. Runtime is included for fixture authors and local lifecycle tests; the production platform owns target loading and does not require a plugin to bundle runtime helpers.
