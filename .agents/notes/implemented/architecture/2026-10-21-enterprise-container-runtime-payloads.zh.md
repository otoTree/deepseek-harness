# Agent Note: 企业运行镜像只携带生产产物

Status: implemented

English | [中文](2026-10-21-enterprise-container-runtime-payloads.md)

## Problem

从构建阶段复制 `/workspace`，会让每个服务镜像都包含构建上下文中的全部工作区依赖、开发工具、源码和本地产物。桌面安装包输出可能增加数 GB，即使两个服务都不会加载它们。运行产物依赖无关的本地工作，使镜像发布和部署成本过高。

## Decision

Admin 构建启用 Next.js standalone 输出，并将仓库设为追踪根目录。运行镜像仅复制追踪得到的服务与静态资源，通过 Node 执行 `apps/admin/server.js`。`ADMIN_API_URL` 仍在运行时提供。浏览器应用的变更不属于本打包决策。

API 构建使用 pnpm 生产部署，生成提升且可独立搬运的依赖树。[部署钩子](../../../../infra/enterprise/docker/api-deploy.pnpmfile.cjs)将受支持的 CLI 纳入 API 依赖选择，无需在 API 源码清单中添加依赖。旧版 deploy 会省略工作区中 Cosmokit 和 Schemastery 的 `link:` 覆盖，因此运行镜像显式复制它们的清单、许可证和编译后的库。运行镜像复制部署后的依赖树，以及明确列出的 CLI/API 构建输出、API 迁移与补丁、启动初始化脚本、已准备的 profile 和 shell 入口。它保留受支持的 `dsh --profile enterprise-api` 启动路径和数据库自动初始化。

Docker 上下文排除桌面构建与安装包输出、Web 分发输出及文档构建缓存。运行阶段向 Node 镜像复制指定产物；先复制工作区再删除无关文件，仍会在先前镜像层中留下这些字节。

[镜像发布决策](2026-10-17-enterprise-container-images.zh.md)继续负责仓库命名、平台选择和独立服务镜像。[初始化决策](2026-10-20-enterprise-container-initialization.zh.md)继续负责数据库启动行为。这两个决策都不要求运行镜像包含完整工作区。

## Alternatives considered

**复制工作区，再在后续镜像层删除开发文件。** Docker 在复制层中保留这些文件，因此下载体积仍然很大。显式选择运行产物可以同时避免镜像层成本和误打包本地安装包。

**将 API 打包为新的直接 Node 服务入口。** 受支持的应用启动使用 dsh profile。替换它会为了解决打包问题而改变生命周期和插件加载行为。生产依赖部署可以保留该入口。

**将基础镜像改为 Alpine。** 更小的基础镜像不会移除工作区产物，切换 libc 还会影响原生依赖兼容性。Debian Node 基础镜像继续保持构建和运行时一致。

## Consequences

镜像内容不受本地桌面安装包影响。Admin 运行时不需要 pnpm 或完整 Next.js 构建缓存。API 保留 CLI 的生产依赖，包括其他 CLI 模式使用的包；进一步减少它们，需要单独决定启动器依赖归属。构建阶段仍需要开发工具和工作区源码。原生依赖在目标 Linux 构建中部署，不从操作人员的主机复制。

## Testing

验证构建 Admin standalone 输出和目标平台运行镜像，检查运行产物与体积，并验证 HTTP 页面、静态资源和运行时 API 地址选择。Backend 冒烟测试使用真实入口和受支持的 profile 连接隔离 PostgreSQL，检查首次迁移、管理员登录、已认证读取和重启保留行为。
