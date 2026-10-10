# Agent Note：企业插件租约在重启和升级后收敛

Status: implemented

English | [中文](2026-10-05-enterprise-plugin-lease-reconciliation.md)

## Problem

浏览器 Client target 探测可能取消签发 activation lease 的 Host reconcile。同版本 Host target 在服务端撤销或轮换 activation 后也可能继续使用本地状态。升级事务还会把已停用安装显示为 `preparing`，导致重启后市场操作一直锁定。

## Decision

Client target 探测排队等待正在运行的 Host reconcile。Host 比较本地 activation id 与服务端 target 行，在服务端不再认可租约时重新激活。每个 activation 接口都会刷新设备租约。升级只在安装已启用时保持 `preparing`；已停用安装收敛到 `disabled`，读取接口还会修复旧事务留下的 disabled/preparing 状态。

## Alternatives considered

**每当 Client 请求 target 就取消 Host reconcile。** 否决，因为探测只是读取 Host 持有的状态，不能撤销仍在准备中的租约。

**永久信任所有同版本的本地 target。** 否决，因为 API 可以独立撤销或使桌面进程的 activation 过期。

**要求用户重新安装卡在准备中的已停用安装。** 否决，因为 API 可以在不删除插件数据的情况下修复这个无效状态。

## Consequences

重启和工作区重新加载不会再轮换有效的 Client lease 或让 target 卡在准备中。过期或被替换的租约会自动重新签发，无需重启客户端。已停用安装升级后仍可操作。

## Testing

企业 Host runtime、Client runtime、API identity lifecycle 和 package typecheck 测试覆盖了修改路径。
