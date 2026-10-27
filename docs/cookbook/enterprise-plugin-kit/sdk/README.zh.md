# 离线 SDK bundle

[English](README.md) | 中文

这些归档是样例开发包使用的公共 SDK 产物，来自同一平台发行版。它们让外部作者无需 Harness checkout 或 SDK registry 就能执行 `pnpm install`。

| 归档 | SHA-256 |
| --- | --- |
| `deepseek-ai-dsh-plugin-protocol-0.1.3-alpha.5.tgz` | `880fe005fab217daaf7560b7a6dd2eddd09b836a59f0f13d2037dde6b2cd362b` |
| `deepseek-ai-dsh-plugin-sdk-0.1.3-alpha.5.tgz` | `6830f9e5ea715527a40c5fea842b5bc9b41bfdc2edee9e043342b23092769c9e` |
| `deepseek-ai-dsh-plugin-runtime-0.1.3-alpha.1.tgz` | `309922effd2eb172e6092faea03e3ab3e7b0851a51e76a3c6ac4e05a87367d0d` |

样例 `package.json` 从这些本地归档安装 protocol 和 SDK。Runtime 供 fixture 作者和本地生命周期测试使用；生产平台负责 target 装载，发布插件不需要打包 runtime 辅助代码。
