# Agent Note: 可续办的 macOS 发布公证

Status: implemented

[English](2026-10-21-macos-release-notarization.md) | 中文

## 问题

Apple 公证可能在安装包构建结束后仍处于处理中。命令超时后重新构建或上传会创建无关提交；附加票据又会改变桌面更新元数据认证的文件字节。ad-hoc 应用签名不能建立 Developer ID 或 Gatekeeper 信任。

## 决策

[发布构建器](../../../../apps/electrobun/scripts/build-installer.ts)要求显式配置 Developer ID 身份、团队和钥匙串配置名。[签名器](../../../../apps/electrobun/scripts/macos-signing.ts)不跟随符号链接，先签名普通 Mach-O 代码，再签名嵌套 framework 和应用，最后签名外层应用。代码使用 hardened runtime 和时间戳；JIT 与原生库权限支持 Node、Bun 和 CEF，不开放调试访问。受保护应用的打包 profile 通过后才签名 DMG。

[公证实现](../../../../apps/electrobun/scripts/macos-notarization.ts)在不可变的版本化发布旁记录提交文件哈希和 Apple 提交 ID。联系 Apple 前先独占创建上传意图记录。上传结果不确定时，需要通过历史记录恢复，不能自动重传。独立的查询命令续查该 ID，拒绝文件或团队变化，并通过目录锁串行完成收尾。持锁进程被终止后，运维人员必须先确认没有收尾进程存活，再移除锁。

接受后保存审核日志，并对私有副本附加票据。Developer ID 校验、票据验证、DMG 完整性检查，以及 DMG 和复制安装后的应用的 Gatekeeper 检查，均先于发布文件替换。跟踪记录在替换过程中保留提交与最终哈希。只有通过校验的最终文件才获得最终校验和；更新元数据在此后签名。被拒绝的提交保留日志并停止轮询。Apple 处理时间和服务端取消不受此工具控制。

[本机安装包决策](../architecture/2026-10-19-local-desktop-installer-protection.zh.md)继续负责混淆、暂存及不带发布者身份的本机构建。[更新决策](../architecture/2026-10-20-signed-desktop-updates.zh.md)继续负责 Ed25519 发布认证与发布顺序。平台信任不取代这两项决策。

## 考虑过的替代方案

**每次超时都重新提交。** 超时不会取消 Apple 的任务。保存并查询同一个 ID 可避免重复排队，并保留与准确提交文件的关联。

**使用递归 --deep 签名。** 显式从内到外签名，可为需要的可执行文件分配运行权限，并验证每个组件的团队、时间戳和发布配置。

**附加票据前签署更新元数据。** 该元数据会认证另一个安装包。最终校验和与更新签名必须在附加并验证票据后生成。

## 影响

发布人员把密码和私钥保存在钥匙串中，置于仓库和产物输入之外。无需 Apple 凭据也能继续使用本机 ad-hoc 构建。测试固定上传意图持久化、重复查询处理中任务、团队与哈希拒绝、拒绝日志和最终文件跟踪。单元 fixture 不能证明 Apple 接受或 Gatekeeper 信任；真实发布流程必须完成这些检查后才能报告成功。脚本不上传生产环境、不执行定时调度，也不承诺全新机器上的原生模块可移植性。
