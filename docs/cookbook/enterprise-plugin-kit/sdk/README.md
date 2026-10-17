# Offline SDK bundle

English | [中文](README.zh.md)

These archives are the public SDK artifacts used by the sample kit. They are copied from one platform release and are provided so an external author can run `pnpm install` without a Harness checkout or an SDK registry.

| Archive | SHA-256 |
| --- | --- |
| `deepseek-ai-dsh-plugin-protocol-0.1.3-alpha.4.tgz` | `7457cbb5ec13548cf1d06238a3cd445488c227aa03a004aff7013a8335923673` |
| `deepseek-ai-dsh-plugin-sdk-0.1.3-alpha.4.tgz` | `f62b6583332ca7e7d00d82d6ddffa18a95c90099d6eca0f42997fdc4ad7b54bb` |
| `deepseek-ai-dsh-plugin-runtime-0.1.3-alpha.1.tgz` | `309922effd2eb172e6092faea03e3ab3e7b0851a51e76a3c6ac4e05a87367d0d` |

The sample `package.json` installs protocol and SDK from these local archives. Runtime is included for fixture authors and local lifecycle tests; the production platform owns target loading and does not require a plugin to bundle runtime helpers.
