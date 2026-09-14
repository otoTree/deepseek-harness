# Agent Note：Assistant 流诊断

Status：implemented

[English](2026-09-14-assistant-stream-diagnostics.md) | 中文

## 问题

客户端投影在重建会话时可能遇到格式错误的紧凑 Assistant 流记录。校验失败如果不包含记录在流中的位置，就难以定位受影响的持久事件。

## 决策

Assistant 流展开继续严格校验记录，并在错误中附加记录索引、记录类型和原始校验信息，同时保留原始错误作为 cause。

## 影响

会话投影日志可以定位具体的无效记录，不会接受格式错误的数据，也不会改变流重建语义。

## 测试

Assistant 流套件覆盖带索引的诊断及原有全部畸形记录断言。
