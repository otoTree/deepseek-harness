# Agent Note: 智域OS 桌面品牌与稳定安装身份

Status: implemented

[English](2026-10-21-zhiyu-desktop-brand.md) | 中文

## Problem

桌面应用名、安装包文件名和平台图标独立于本地化界面标识产品。若技术身份随可见名称一起改变，品牌更名可能断开已安装凭据或使经过认证的更新元数据失效。

## Decision

[桌面品牌](../../../../apps/electrobun/src/brand.ts)将应用命名为「智域OS」，安装包产物前缀为 `zhiyu-os`。原生构建将该名称用于应用包、Windows Setup 元数据和 DMG 卷标。[处理后的 PNG](../../../../apps/web/public/favicon.png)提取[产品原图](../../../../logo.png)中的银色标志，去掉文字和展示示例。桌面构建将其同步为 Windows PNG 和原生图标集，Admin 保存相同的 PNG。账号页面的图片请求仅限公开的 favicon 文件；特权账号操作仍校验令牌与 Origin。官方客户端构建标题使用「智域OS」。

已发布的应用标识、签名密钥信任、启动代理标签和数据目录保持稳定。[凭据服务迁移](2026-10-23-enterprise-upgrade-and-administration.zh.md)保留匹配账号凭据。上游包名和许可证署名保留其技术与法律含义。Windows 验证器接受明确列出的当前和旧安装包名，要求元数据名称与可执行文件名一致，并保留应用标识校验。

[安装包保护决策](2026-10-19-local-desktop-installer-protection.zh.md)继续负责构建与混淆理由，[签名更新决策](2026-10-20-signed-desktop-updates.zh.md)继续负责原生更新认证与安装交接理由。展示名称不会取代这两项决策。[中性客户端界面](../simplification/2026-09-17-neutral-enterprise-client-chrome.zh.md)独立保留纯文本侧栏和 New Session 首屏的决策。

## Alternatives considered

**替换所有上游标识和存储路径。** 这会断开现有账号凭据与工作区，并改变已部署更新客户端认证的身份。可见产品名称不需要这种迁移。

**只修改界面文案。** Finder、Dock、Windows Setup 和下载文件名仍使用独立的构建元数据与图标资源，界面文案无法完成产品品牌修正。

## Consequences

macOS 首次安装品牌版会在不同名称的旧应用旁创建 `智域OS.app`。用户退出旧应用，安装并验证品牌版后移除旧应用包。旧 Windows 更新器的验证器固定使用旧包名，因此需要手动安装品牌版。后续品牌版 Windows 客户端接受两个明确支持的包名，同时保留签名、身份和字节校验。

安装包验证检查挂载后应用的名称。Windows 夹具覆盖品牌包、旧包及名称或身份不匹配情况。桌面数据路径测试保持已发布的位置。更名后的安装包仍需要更高的语义版本和重新签名的发布清单；Apple 公证和 Windows 发布者信任继续属于独立的发布要求。
