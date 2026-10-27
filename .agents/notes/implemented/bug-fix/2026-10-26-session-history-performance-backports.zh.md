# Agent Note: v2 运行时中的有界 Session 历史处理

Status: implemented

[English](2026-10-26-session-history-performance-backports.md) | 中文

## 问题

长 Session 和大量本地历史会重复执行与已保留数据量成正比的工作。已完成的 Assistant 流分配逐 token 状态，随后又被最终内容覆盖；终端追加重新扫描已保留输出；列表行序列化未使用投影；请求再次遍历已冻结历史；元数据观察复制未使用事件。串行 header 读取和不间断的摘要组装还会延迟其他 Host 请求。智域OS 与 Arivo 都使用这些共享包。

## 决策

将上游性能机制移植到现有 v2 运行时，保留 Session 代际以及产品专属的授权和隐藏会话规则。

| 操作 | 处理的工作 | 上游修复 |
|---|---|---|
| 已完成的 Assistant | 直接读取最终内容；为时间、用量、可见性、图片或文本扫描压缩记录；保留失败尝试的呈现 | [`165cc31eb8`](https://github.com/deepseek-ai/deepseek-harness/commit/165cc31eb8) / [`84c11c7243`](https://github.com/deepseek-ai/deepseek-harness/commit/84c11c7243) |
| 终端保留 | 增量字节与换行统计、有界分块、保持码点完整的淘汰、自有底层存储，以及不组装文本的状态 getter | [`cea837e065`](https://github.com/deepseek-ai/deepseek-harness/commit/cea837e065) / [`68f9708e02`](https://github.com/deepseek-ai/deepseek-harness/commit/68f9708e02) |
| Session 列表 | 选择注册的摘要视图，排除 `turnOutline`、`sessionStats`、`todos` 和 `imageLimits`；保留完整 follow/control 基线 | [`92f9e79fac`](https://github.com/deepseek-ai/deepseek-harness/commit/92f9e79fac) / [`8e2dd67de8`](https://github.com/deepseek-ai/deepseek-harness/commit/8e2dd67de8) |
| Client 列表核对 | 每次快照仅建立一次会话 ID 索引；清理缓存行和检查所选会话时不重复扫描列表，保留未变更行的身份 | [`53046b21b4`](https://github.com/deepseek-ai/deepseek-harness/commit/53046b21b4) |
| 请求冻结 | 每个 Agent 用 `WeakSet` 记录成功深冻结的消息身份；完整冻结每次 header 和新身份 | [`73edce1ae7`](https://github.com/deepseek-ai/deepseek-harness/commit/73edce1ae7) |
| 列表调度 | 后端列表 I/O 共享 `listConcurrency`，默认 3；摘要行处理达到 `listWorkSliceMs` 后在完整行之间让出，默认 16 | [`6aa157a05a`](https://github.com/deepseek-ai/deepseek-harness/commit/6aa157a05a) / [`4402fa47e4`](https://github.com/deepseek-ai/deepseek-harness/commit/4402fa47e4) |
| 实时观察 | 获取时捕获游标；首次读取 `events` 时物化并共享固定事件前缀 | [`5b91dbfba0`](https://github.com/deepseek-ai/deepseek-harness/commit/5b91dbfba0) |
| 历史跳转 | 缓冲成功的跳转页面，结束时统一前插；保留实时追加，替换流时丢弃缓冲页面 | [`3d360e7fdb`](https://github.com/deepseek-ai/deepseek-harness/commit/3d360e7fdb) |
| 轮次导航 | 使用 TanStack React Virtual 3.14.9 虚拟化固定间距标记；保留焦点邻居及指针、焦点预览 | [`f89cd786aa`](https://github.com/deepseek-ai/deepseek-harness/commit/f89cd786aa) / [`d53c305224`](https://github.com/deepseek-ai/deepseek-harness/commit/d53c305224) |
| 活跃轮次定位 | 二分查找自然布局中的外层行；空 Seat 保留零高度布局框 | [`19e5af7ded`](https://github.com/deepseek-ai/deepseek-harness/commit/19e5af7ded) |
| 工具与命令行 | 复用未变化的属性、本地化终端模型和回调；仅在展开时创建详情并分发图片插槽 | [`bcd14d776c`](https://github.com/deepseek-ai/deepseek-harness/commit/bcd14d776c) |

压缩读取函数要求记录已通过校验。持久化 Session 准入仍校验流记录；严格展开解码器保留带索引的诊断。取消信号保持可变。冻结失败的身份不会加入集合，替换后的消息身份接受新的完整遍历。

现有的部分 `SessionProjectionHints` wire 表示通过注册表的 `wire.summary` 策略携带摘要 key。客户端列表刷新按投影 key 逐项应用，保留已打开 Session 的完整存储。Session 事件、存储代际和投影状态版本均不变。

现有的 [v2 流决策](../architecture/2026-09-01-v2-embedded-assistant-streams.zh.md)、[不可变消息决策](../architecture/2026-07-28-identified-immutable-message-values.zh.md)、[观察所有权决策](../architecture/2026-08-25-session-observations-and-projection-owned-client-state.zh.md)和[缓存存储决策](../architecture/2026-08-19-projection-cache-per-session-files.zh.md)保留各自独立的格式、身份、读取切点与持久性理由。这些优化细化其实现，不取代这些决策。

兼容的核心算法以已核对的上游 `22ddee3792402c3e70ec5f86a63c3e3e895a2f60` 为基线。该版本的工厂插槽和分组渲染 API 需要另行迁移接口；本次适配保留当前 Conversation 定义、Arivo 配色、本地化字典与精简界面。消息 DOM 继续挂载，以保留浏览器搜索、展开状态、语义锚点及宽表格布局；虚拟化仅应用于导航栏。[历史阅读](../architecture/2026-10-26-chat-history-reading.zh.md)与[离屏渲染](../architecture/2026-10-25-chat-offscreen-rendering.zh.md)决策继续约束滚动和搜索行为。

## 考虑过的替代方案

**整体替换上游文件或升级 Session 格式。** 新版控制器、持久化后端和客户端类型包含额外 API。整体替换还会改变与历史重复工作无关的代际迁移和产品专属行为。

**在消除已完成流重放时丢弃失败尝试。** v2 使用保留的尝试内容呈现中断回复与重试。按压缩记录组装可在保留这些回复的同时避免逐 token 状态分配。

**跳过所有通过 `Object.isFrozen` 的对象。** 浅冻结消息仍可能包含可变子对象。只有成功完成完整遍历才能证明身份可安全复用；弱引用避免保留被替换的历史。

**发送全部投影并在浏览器过滤。** 这仍保留 Host 校验、序列化、传输和冷客户端存储开销。摘要选择发生在视图物化与校验之前，精确打开仍保留完整基线。

## 影响

历史处理工作量随新准入消息、压缩记录、新到终端文本和选中摘要字段增长。并发数与工作时间片预算是经过校验的部署配置。即使首次读取事件发生在追加之后，实时观察租约仍保留同一游标。文件系统结果按遍历顺序处理，取消一次列表读取不会清空另一次读取共享的队列。

回归测试覆盖压缩与标量呈现、重试与中断、Unicode 保留、请求身份复用与取消、延迟观察切点、被排除视图的工作量、并发列表、确定性的调度让出，以及选择期间有界的缓存行读取。[手动浏览器基准](../../../../apps/web/tests/complex-history.perf.ts)在 256 个侧栏会话及已加载 24 或 500 轮对话的场景下，区分首次打开与反复切换会话的耗时。计时用于诊断；普通测试断言输出与有界工作量，不使用依赖机器速度的阈值。
