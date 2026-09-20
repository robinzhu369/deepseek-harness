---
name: modelx-harness-extension
description: Use for adding modeling tools, Host/Remote adapters, session context,
  React Slots and task integration in the existing DeepSeek Harness repository. Do
  not use to replace its runtime.
---

# Harness 建模扩展

## 先查再写
读取适用上游 AGENTS、架构、Web Client、Slots、Tools 和一个相邻实现。核对 commit、依赖及生成器，记录实际 API、工具上下文字段和渲染扩展点。不得把本包建议路径当成现有源码。

## 边界
- 复用 Harness Agent、会话、模型、认证和通信。
- 新增领域 Controller/adapter、客户端模型和 UI 插槽，不修改核心 Loop。
- 展示组件只接收 props/hooks/callbacks；不向 React 注入宿主 ctx，不跨 feature 直接引组件。
- 仅注册四个业务工具；session 归属从可信上下文取得。执行确认是用户接口，不向模型提供审批工具。
- Python 业务库是任务真值；一个客户端模型负责轮询、revision 去重和会话解绑。
- 上传/下载使用上游真实扩展方式及授权；大文件流式转发，不复制到多个内存 Buffer。
- 运行 preset 收窄能力，并验证开发 Skills 不可见。

## 验证
最小工具 smoke→候选计划→人工确认→真实 run→刷新/切会话→结果卡。未知接口先查源码，不写猜测 API。遵守上游类型/构建/测试与包边界。

## 参考
- [架构](../../../docs/modeling-demo/01-architecture-and-functions.md)
- [协议](../../../docs/modeling-demo/03-api-and-data-contracts.md)
- [部署](../../../docs/modeling-demo/08-deployment-and-security.md)
