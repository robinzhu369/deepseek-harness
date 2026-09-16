---
description: "连接 Data Agent 领域服务的认证 Web Remote 适配器。"
kind: "package-reference"
---

# @deepseek-ai/dsh-api-data-agent-controller

[English](README.md) | 中文

## 概述

可选服务通过既有 Harness 浏览器通道转发有界 JSON 命令和二进制传输。领域服务对每项操作校验用户凭证及项目成员权限。

## 目录

- [使用本包](#use-this-package)
- [实现说明](#understand-the-implementation)
- [模型体验](#model-experience)
- [已知限制与后续工作](#known-limitations-and-deferred-work)
- [开发说明](#dev-note)

## Use this package

通过[工作台源码覆盖层](../../../deploy/data-agent/workbench.source.patch.yml)挂载本服务。浏览器同时需要 Harness 连接授权，领域凭证不能绕过通道认证。

必需配置：`endpoint` 为精确的 `http://127.0.0.1:port` 源；`timeoutMs`、`maxBodyBytes`、`maxResultBytes` 是正数限制；`pollIntervalMs` 和 `maxUploadBytes` 限制浏览器轮询及上传缓冲。JSON 请求只接受 `/v1/data/` 路径，禁止重定向。


## Understand the implementation

自动生成的 `dataAgent.request` Remote 保留领域 HTTP 状态和 JSON 正文。精确的 `/api/data-agent/bytes` Fetch 路由只允许上传分片和产物下载，不提供任意代理目标。

凭证通过 Remote 参数或二进制凭证头传递，本适配器不持久保存。上传大小、票据、摘要及权限由领域服务强制校验。


<a id="dev-note"></a>

### 开发备注

不发布运行时 invariant 配套模块：适配器没有独立领域状态。领域仓库与连接通道负责权限，转发行为通过请求与销毁测试验证。

## Model Experience

### Domain interaction

#### What the model sees

本包不直接提供模型内容。本包呈现或转发 `/v1/data/` 请求；领域 Harness 集成负责模型上下文和工具执行。

#### Token effect

本包不增加 token。显式提交的会话消息由领域集成渲染。

#### KV Cache effect

没有直接影响。提交的消息通过既有负责人扩展底层对话。

## Known Limitations and Deferred Work

- 领域服务必须运行于同一主机。已接受的业务命令可能在浏览器断开后完成；客户端应读取快照对账，不能假定断开等于取消，也不能自动重试写入。
