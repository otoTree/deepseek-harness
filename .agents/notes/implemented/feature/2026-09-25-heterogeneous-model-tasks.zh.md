# Agent Note: 异构模型任务与外部插件消费方

Status: implemented

[English](2026-09-25-heterogeneous-model-tasks.md) | 中文

## 问题

图片、视频、音频和向量 Provider 暴露不同的请求、状态、结果和用量字段。浏览器轮询无法可靠地推进或结算 Provider 任务。

## 决策

Enterprise API 负责供应商无关的媒体任务、版本化 Adapter 与价格快照、CNY 钱包冻结、最终结算和每三十分钟运行的对账扫描。Client 查询任务和扫描使用同一查询路径。扫描只领取已创建超过三十分钟、到达查询时间且账务未完成的任务；只有 Provider 查询返回终态和完整用量时才结算。

媒体插件在 Harness 源码工作区之外独立维护和打包。Enterprise 运行时通过公共 Plugin SDK 和模块系统加载其声明的 Host 与 Client target。停用会释放贡献、使模块记录失效并删除插件拥有的样式，之后同一 ID 才能再次启用。Client 与 Host target 的失败在协调过程中彼此隔离，下一次 Host 协调前会重试清理。Workbench 提供通用面板与标签插槽；平台仓库不包含媒体插件源码或构建引用。

## 备选方案

**把媒体操作放入文本 LLM 流。** 否决，因为异步 Provider 任务和有类型的媒体结果需要独立的执行与账务生命周期。

**任务达到三十分钟时直接结算。** 否决，因为任务年龄只触发 Provider 查询；处理中任务继续冻结，终态但用量不完整的任务保持未决。

**由画布插件调用 Provider 或修改钱包余额。** 否决，因为 Enterprise API 负责 Provider 凭据、任务快照、预扣和结算。

## 后果

外部插件和 Agent 通过 Plugin SDK 消费供应商无关的任务 API。插件拥有的存储和展示逻辑保留在平台仓库之外。市场设备操作会在一个事务中更新插件声明的全部 target；运行时租约仍按 target 保存，任一 target 失败时会撤销该设备上的其他租约。卸载会立即撤销 target 租约，下一次读取设备 target 时会把过期的 stopping 行标记为 disabled，因此运行时丢失不会永久阻塞安装。激活错误会持续显示在插件市场卡片中。Adapter 配置和版本发布仅限平台管理后台。
