---
name: modelx-demo-orchestrator
description: Use when starting or continuing the two-day DeepSeek Harness data-modeling
  Demo. Coordinate bounded implementation tasks, not general coding or production
  platform design.
---

# 智模 Demo 开发调度

先读取当前仓库适用 AGENTS/override，保留用户改动，再读取项目执行契约、任务表和 progress。文档包不是已完成系统。

## 执行
1. T00 查明实际源码版本、扩展点、构建与模型/浏览器能力，写 REPO_DISCOVERY。
2. 按 tasks.json 依赖顺序实施；没有 G0 不大改 UI，没有 G1 不接假计算。
3. 对扩展调用 modelx-harness-extension，对数据调用 modelx-data-pipeline，对页面调用 modelx-frontend-design，对 Skill 调用 modelx-skill-authoring，对验收调用 modelx-demo-qa。
4. 每次只加载当前任务需要的章节；分阶段测试，保存命令、退出码和证据后推进。
5. 限定两天 P0；不换基座、不叠第二套 Agent、不创建独立新前端、不引入无关云服务。
6. 阻塞时记录证据和最小解决方案；不擅自升级依赖/关闭权限/伪造成功。未经用户请求不 push。

## 交付
真实实现清单、测试证据、截图、启动与演示步骤、NOT_RUN/未实现项。Fixture/手动模式/实时 Agent 要分开。

## 参考
- [执行契约](../../../docs/modeling-demo/00-execution-contract.md)
- [任务顺序](../../../docs/modeling-demo/04-tasks-and-order.md)
- [进度](../../../docs/modeling-demo/progress.md)
- [可复制指令](../../../docs/modeling-demo/07-codex-prompts.md)
