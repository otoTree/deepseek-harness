---
description: "在企业桌面插件市场安装和发布 Client、Host 插件。"
kind: "user-guide"
---

# 企业桌面插件市场

[English](enterprise-plugin-market.md) | 中文

企业桌面 profile 会在侧边栏增加“插件市场”。打开市场会保留当前会话，并把主内容切换为市场；点击“返回会话”即可恢复。

首期接受包含构建后 Client 和/或 Host bundle 的标准 `.dsh-plugin.zip`。Cloud target 暂不支持。选择版本可以查看版本号、target、权限和可见范围。安装会先下载并校验包；启用 target 需要单独确认。

私有上传只有创建者可见和可安装。组织上传进入组织 owner 或 administrator 的审核队列。平台上传进入 platform administrator 的审核队列。公开版本只有审核通过后才会进入目录，被撤销后不可继续安装。

账号同步会保存选中的版本、普通配置、target 状态和启用状态，使插件可以换设备恢复。Keychain 凭据、API key、操作系统权限、本地路径和 Shell 权限只保留在各设备。新设备可以显示已安装但等待本地授权，用户授予所需权限后才能启用。
