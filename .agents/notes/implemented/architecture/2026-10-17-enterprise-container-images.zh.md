# Agent Note：企业服务发布可复现的 amd64 容器镜像

Status: implemented

[English](2026-10-17-enterprise-container-images.md) | 中文

## Problem

企业 Admin 和 API 只有本地开发命令，没有可重复的容器构建与镜像仓库发布路径。API 只监听回环地址，也无法通过容器端口接收流量。

## Decision

仓库在 `infra/enterprise/docker/` 下分别维护 Admin 和企业 API 的 Dockerfile。`scripts/build-and-push-images.sh` 通过 `pnpm run image:push` 暴露，固定选择 `linux/amd64`，用当前提交和 `latest` 为两个镜像打标签并推送到可配置的镜像仓库前缀，默认前缀为 `ccr.ccs.tencentyun.com/imags`。[Admin 运行时配置决策](2026-10-19-admin-runtime-api-url.zh.md)负责 API 地址传递。API 通过 `ENTERPRISE_API_HOST` 接受 `0.0.0.0`；本地默认值仍为 `127.0.0.1`。

## Alternatives considered

**发布一个合并镜像。** 分离镜像可以让 Admin 与 API 独立扩缩容、重启和升级，也符合两个独立应用运行时的结构。

**保持 API 只监听回环并要求 host 网络。** host 网络依赖平台，且无法使用普通容器网络。显式且经过校验的监听地址既保留本地安全默认值，也能让容器监听器可用。

## Consequences

[运行产物决策](2026-10-21-enterprise-container-runtime-payloads.zh.md)负责独立的生产产物，并保留受支持的 `dsh` profile 启动器。镜像仓库凭据不进入仓库；执行发布命令前必须先登录 Docker。`REGISTRY_PREFIX`、`IMAGE_TAG` 和 `PLATFORM` 控制镜像发布，无需修改源码。

数据库自动初始化由[容器初始化决策](2026-10-20-enterprise-container-initialization.zh.md)定义。
