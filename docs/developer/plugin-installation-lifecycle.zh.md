---
description: "可信企业 Cordis 插件当前的安装、激活、升级、禁用和卸载行为。"
---

# 插件安装与运行生命周期

[English](plugin-installation-lifecycle.md) | 中文

本文说明企业 API 为可信 Cordis 插件实现的生命周期。运行时沿用现有 Host 或 Client 进程；manifest 权限用于授权平台能力，不隔离同一进程中的恶意代码。

## 持久记录

平台分别保存不可变 release、安装记录、设备 target 记录、短期激活记录和生命周期状态。安装身份和数据空间在升级时保持稳定，并带有授权修订号。期望状态记录所有者的请求，实际状态记录设备的回报。

个人安装由账号本人管理。组织安装由组织所有者或管理员管理，成员选择自己的设备启用 target。组织安装对成员可见，也可以由管理员撤销。

## 控制面操作

`POST /v1/organizations/:organizationId/plugins/:id/install` 创建安装但不启用 target。`PATCH /plugins/installations/:id` 修改安装的期望状态。`PUT /plugins/installations/:id/devices/:deviceId` 修改一个设备 target，`POST /plugins/installations/:id/activate` 在设备请求已启用后签发短期激活凭据。

每次运行时请求都携带 `Bearer` 激活凭据，并重新检查激活、安装、release、设备 target、成员资格和授权修订。停用、卸载、release 撤销或组织成员资格变化都会使凭据失效。heartbeat 携带 activation ID，只有该激活仍与设备版本及授权修订一致时才能更新状态。为同一设备 target 签发替代 lease 时会撤销旧 lease。

升级采用维护窗口。API 要求目标 release 已发布；如果权限增加，还必须显式确认。旧激活先撤销，授权修订递增，设备回到准备状态。卸载先撤销激活并保留数据空间。导出、删除数据和重新授权是独立且有审计记录的操作。

## 运行 target

Host 和 Client 在加载器校验不可变包后获得安装作用域 SDK。桌面 Host 导入已校验的 Host target，浏览器则导入 Host 提供的 Client 源码并挂载其 module 和 slot。所有贡献都通过 Cordis effect 注册；禁用、升级、断开和卸载会等待 disposer 完成。Client 通过 Host bridge 访问 API，不接触平台或供应商凭据。

首版 SDK 提供当前使用者资料、文本模型目录和调用、对象存储、受限数据库查询和事务，以及命名空间缓存。SDK 不提供队列、worker、定时任务、后台任务、Cloud target，也不提供图片或视频生成。

## 恢复

设备在重启或重连后重新执行准备阶段。失败阶段会保留在安装和设备状态中，重复对应操作即可重试。即使本地 disposer 失败，服务端仍会撤销凭据；可信代码无法停止时，桌面运行时会报告需要重启 Host。
