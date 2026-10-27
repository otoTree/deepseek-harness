# Agent Note: 关闭时的会话投影检查点

Status: implemented

[English](2026-10-23-session-cache-shutdown.md) | 中文

## Problem

会话重命名后可能在投影缓存的间隔计时器触发前关闭。日志保留了修改，但随后冷列表会显示较早的标题。独立的清理 effect 还可能在检查点等待日志持久化时关闭存储域。

## Decision

[投影缓存](../../../../packages/session/session-projection-cache/src/index.ts) 在同一个异步 disposer 中负责最终脏检查点、在途写入完成和存储域关闭。它清除间隔计时器、为剩余脏会话写入检查点、等待已准入写入，然后关闭存储域。写入保持日志先于缓存的持久化顺序，并将失败收敛为警告；缓存写入失败后仍需通过权威日志折叠恢复。

Session Controller 在接受显式重命名时也会等待可选列表检查点，使随后的冷列表能保留标题而不依赖清理顺序。检查点失败会记录警告，不会撤销已提交的重命名。

[缓存测试](../../../../packages/session/session-projection-cache/tests/cache.spec.ts) 覆盖未达到间隔阈值的最终修改，以及阻塞于日志持久化的检查点。[Arivo 打包回归](../../../../apps/electrobun/tests/arivo-runtime.test.ts) 检查真实工作区 ID、实时和冷列表标题、账号隔离及恢复后的权限。[浏览器场景](../../../../apps/web/tests/arivo-startup.e2e.ts) 使用正常 OS 工作区和会话界面对已结束的本地历史 fixture 重命名，并在完整替换 Host 后重新打开。该 fixture 不发起 Provider 请求，不构成真实账号、流式模型或原生窗口验收。

## Alternatives considered

- 关闭前等待配置的间隔。这会增加不必要的延迟，且关闭早于间隔时仍会失败。
- 为冷列表折叠每个会话日志。这会取消有界列表读取，并增加大量历史下的启动工作量。
- 使用独立的写入和存储域关闭 effect。Cordis 清理不会串行等待它们的异步续体，因此写入可能与关闭竞争。

## Consequences

缓存 disposer 在实时投影仍可用时等待检查点写入；显式重命名检查点不依赖整个 Host 的清理顺序来保留冷标题。进程突然丢失或存储写入失败仍可能留下陈旧列表提示；打开会话会从权威日志恢复投影。会话格式、Agent 执行及账号归属规则保持不变。
