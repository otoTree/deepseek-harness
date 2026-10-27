# Agent Note: Arivo 项目对话自动选择模型

Status: implemented

[English](2026-10-26-arivo-project-model-defaults.md) | 中文

## 问题

全局空间、计费项目和模型表单阻断项目对话，也可能暗示与当前文件夹无关的计费归属。

## 决策

[启动外壳](../../../../apps/electrobun/src/distribution/arivo-shell/client/index.ts)不注册全局模型设置页面，Host 不暴露全局手动选择 RPC。原生创作插件解析文件夹的不可变云归属，验证已保存的项目模型偏好；没有偏好时按在线目录顺序选择第一个支持工具的模型，不保存偏好。原对话模型菜单承接明确改选。

[Session Controller](../../../../packages/api/session-controller/src/agent.ts)允许部署注册一个默认模型解析器。首次 prompt 准入只为没有待用选择和历史请求模型的 Session 记录精确结果。发现后重验取消、注册所有权、活动 Agent 身份及持久选择；已有选择和用户并发改选优先。没有解析器的部署沿用原默认策略。

本决策部分替代[原生适配器决策](../architecture/2026-10-23-arivo-language-adapter.zh.md)中的全局模型控件段落；其请求、工具、停止、恢复和计费规则继续有效。

## 考虑过的替代方案

折叠全局表单仍重复选择计费项目。切换项目时修改全局默认值可能让新对话使用另一文件夹的归属。在 Agent 循环中改写请求路由会绕过持久选择的所有者。项目解析器继续使用原 Session 命令和请求链路。

## 影响

账号切换、在线目录不可达和项目偏好改变均在模型执行前拒绝。自动发现不创建生成或积分预留。已受理调用保留原路由。独立构建的插件继续拥有本机数据，Harness 只消费其公开发布产物；没有数据库迁移或第二个 Agent 循环。

## 测试

[Session 测试](../../../../packages/api/session-controller/tests/session-models.host.spec.ts)覆盖未配置全局 provider 的首次 prompt、用户并发改选、重复发现、已有请求、取消和解析器卸载。原生插件测试使用实际 Worker 存储，覆盖跳过纯文本模型的分页、账号切换与修订冲突。[打包项目流程](../../../../apps/web/tests/arivo-project-creation.e2e.ts)无模型配置直接打开对话，检查模型名称、可发送状态、设置入口移除和重开。[原 Agent 录制回放](../../../../apps/electrobun/tests/arivo-language-snapshot.mjs)断言项目发现与请求保留部署默认模型。产品夹具不调用真实付费 Provider，原生窗口与发布验收仍独立保留。
