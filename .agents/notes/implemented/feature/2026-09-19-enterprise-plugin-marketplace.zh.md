# Agent Note：企业桌面插件市场

状态：已实现

[English](2026-09-19-enterprise-plugin-marketplace.md) | 中文

## 问题

企业桌面用户需要一种可跨设备安装且可审核的 Client 和 Host 插件方式。发布包不能包含源码，公开可见性必须经过管理员审核。

## 决策

首期市场只接受包含 `client` 和/或 `host` target 的 `.dsh-plugin.zip`。API 在写入不可变对象存储 key 前校验 ZIP 路径、大小限制、manifest 字段、target 入口、SHA-256 完整性记录和包摘要；`cloud` 与未知 target 直接失败。

发布可见范围为 `private`、`organization` 或 `platform`。私有版本对创建者立即发布；组织版本进入组织审核；平台版本进入平台审核。目录只返回当前组织可见、已发布且未撤销的版本。账号级安装记录保存选中的版本、配置、target 状态和启用状态。

桌面布局维护 `MainNavigation` 和 `main.surface` 槽位。企业插件提供侧边栏底部入口和市场页面，市场状态不依赖会话生命周期。安装与启用分离；Client 通过已认证的 Host bridge 请求上传和账号级操作。

## 结果

新设备可以下载并校验插件包，而不会上传 Keychain 或操作系统权限。公开发布仍需要管理员明确决定。旧版 JSON 插件记录继续通过兼容 API 和校验器读取。

## 验证

包解析器测试覆盖双 target 包、拒绝 cloud、拒绝路径遍历和完整性记录。API、Electrobun 校验器、布局和企业 Client 包均完成 TypeScript 检查。

## Alternatives considered

继续把 ZIP 作为普通 JSON artifact 保存会丢失跨设备安装所需的完整性信息，因此采用标准 ZIP、不可变对象存储 key、包摘要和文件摘要。发布签名要求用户或部署方管理发布密钥，却不会改变谁可以上传、审核、下载或安装 release，因此首期市场不采用发布签名。让公开上传立即进入目录会绕过组织和平台管理员责任，因此公开版本保留审核状态。
