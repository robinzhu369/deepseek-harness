---
description: "Harness Web profile 的三列数据工作台。"
kind: "package-reference"
---

# @deepseek-ai/dsh-client-ui-data-agent

[English](README.md) | 中文

## 概述

可选插件占用左栏、具名主面板、右栏及管理弹窗。React Flow 展示版本化流程；PostgreSQL 与 Harness 会话日志仍是事实来源。

## 目录

- [使用本包](#use-this-package)
- [实现说明](#understand-the-implementation)
- [模型体验](#model-experience)
- [已知限制与后续工作](#known-limitations-and-deferred-work)
- [开发说明](#dev-note)

## Use this package

在 Web profile 之后加载[源码覆盖层](../../../deploy/data-agent/workbench.source.patch.yml)，明确配置领域服务与回环地址。默认 Web profile 不启用本插件。

Host 控制器必须配置 `pollIntervalMs`（至少 1000）和 `maxUploadBytes`（正整数）。浏览器凭证仅保存在内存，刷新后需重新连接；界面选择与流程草稿按账号保存在本地。


## Understand the implementation

三列共享注册的界面状态仓库，领域模型不依赖 React，通过框架钩子注入。读取结果按账号和请求代次隔离。历史 Run 快照只读，复制会创建独立流程身份；修改后的保存或提案不继承审批。

数据中心支持分片校验续传、不可变导入及有界预览任务。Skill 操作遵守后端生命周期门禁；停止模型回复、取消 Run、取消业务任务是三个独立操作。


Skill 阶段入口展示默认版本与最近评测；选定版本会创建新的规划会话，仍须审查具体提案。草稿证据可保留原提案的已发布引用。拖动既有分隔线后点击保存列宽，可在刷新后恢复布局。

<a id="dev-note"></a>

### 开发备注

不发布运行时 invariant 配套模块：本消费者没有需要对账的独立持久执行状态；模型竞态测试、图校验与真实 Web 装配回归负责验证。

## Model Experience

### Domain interaction

#### What the model sees

本包不直接提供模型内容。本包呈现或转发 `/v1/data/` 请求；领域 Harness 集成负责模型上下文和工具执行。

#### Token effect

本包不增加 token。显式提交的会话消息由领域集成渲染。

#### KV Cache effect

没有直接影响。提交的消息通过既有负责人扩展底层对话。

## Known Limitations and Deferred Work

- 界面轮询权威快照，读取失败时显示待同步。冷会话需显式恢复。导航最多返回 200 个 Run 与提案，事件界面展示已加载记录的最近 200 条。上传哈希计算会缓冲不超过配置限制的单个文件；高级算子参数和 Skill 包使用 JSON 编辑器。
