# Agent Note: 企业目录同步工作区

Status: implemented

[English](2026-10-06-enterprise-directory-sync-reference-alignment.md) | 中文

## 问题

管理端目录同步路由之前使用通用资源表，操作员无法在对齐参考图的工作区内编辑脚本、查看运行、审核批次或执行回滚。

## 决策

管理端使用一个包含四个路由标签的同步工作区：同步脚本、任务与 Webhook、差异审批、历史与回滚。每个视图读取现有同步资源并在客户端聚合指标。脚本保存使用版本递增的 `PATCH /v1/organizations/:organizationId/sync-scripts/:id` 接口，运行响应增加脚本名称和版本，供详情面板展示。任务与 Webhook 视图提供明确的触发器管理，使用 `POST` 创建、`PATCH` 编辑和 `DELETE` 归档；归档会保留历史运行记录。

## 后果

操作员保留原有预览、审批、发布、批次审批和回滚操作，同时获得统一的双栏布局和移动端展示。持久化 Webhook 配置尚未创建前，Webhook 指标保持为零，配置面板展示现有运行触发方式。归档触发器不会再出现在管理列表中，但历史运行仍可查看。
