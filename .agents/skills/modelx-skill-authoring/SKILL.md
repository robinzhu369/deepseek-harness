---
name: modelx-skill-authoring
description: Use when authoring, editing, validating or publishing the four runtime
  modeling Skills. Preserve version snapshots, planner/executor separation and minimal
  evaluations; not for an autonomous skill marketplace.
---

# 业务 Skill 编写与校验

开发期本 Skill 属于 Codex；运行期业务 Skill 属于数据建模 Agent，不能混装。

## 流程
1. 读取 runtime-skills 模板、领域工具及计划 schema；明确触发/不触发场景。
2. Skill 描述策略与规则，实际计算必须由已实现的算子承担。不能只加 Markdown 就宣称支持新算法。
3. 每个 Skill 有 name/description、输入、允许工具、规划步骤、输出约束、拒绝情况。
4. 草稿→结构校验→有限测试→人工发布不可变版本。记录版本/hash；历史计划固定快照。
5. 最小评测包括合法计划、缺目标、未知字段/算子、注入命令、目标泄漏、同实体/时间切分不支持。
6. 没有真实模型测试时标 NOT_RUN；schema smoke 不等于业务效果已经评测。
7. 不执行导入脚本，不改系统 Prompt 或权限白名单，不自动联网安装插件。

## 隔离
Harness 可发现 .agents 目录，运行 workspace/preset 必须不加载 Codex 开发 Skills。仅目录命名不同不是隔离证据。

## 参考
- [Skill 与工具](../../../docs/modeling-demo/05-skills-and-tools.md)
- [运行模板](../../../docs/modeling-demo/runtime-skills/README.md)
- [协议](../../../docs/modeling-demo/03-api-and-data-contracts.md)
