# 离线 SDK bundle

[English](README.md) | 中文

这些归档是样例开发包使用的公共 SDK 产物，来自同一平台发行版。它们让外部作者无需 Harness checkout 或 SDK registry 就能执行 `pnpm install`。

| 归档 | SHA-256 |
| --- | --- |
| `deepseek-ai-dsh-plugin-protocol-0.1.3-alpha.4.tgz` | `7457cbb5ec13548cf1d06238a3cd445488c227aa03a004aff7013a8335923673` |
| `deepseek-ai-dsh-plugin-sdk-0.1.3-alpha.4.tgz` | `f62b6583332ca7e7d00d82d6ddffa18a95c90099d6eca0f42997fdc4ad7b54bb` |
| `deepseek-ai-dsh-plugin-runtime-0.1.3-alpha.1.tgz` | `309922effd2eb172e6092faea03e3ab3e7b0851a51e76a3c6ac4e05a87367d0d` |

样例 `package.json` 从这些本地归档安装 protocol 和 SDK。Runtime 供 fixture 作者和本地生命周期测试使用；生产平台负责 target 装载，发布插件不需要打包 runtime 辅助代码。
