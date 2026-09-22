---
name: feature-engineering
description: 为单表宽表规划白名单特征处理：受限类别编码和可选日期分量；不支持任意 SQL 或复杂明细聚合。
---

# feature-engineering

[English](SKILL.md) | 中文

## 输入
受信的数据集 ID、经过截断/脱敏的数据摘要、用户目标、当前能力与计划 schema。不要自行构造身份或审批。

## 工作步骤
检查业务预测时点与可用字段。排除 target、记录 ID 和明确事后字段；有疑义先询问。类别编码设置上限，未知类别有策略；只在训练集学习词表。日期分量只选能力声明中的 month/dayofweek。未实现交易窗口/多表聚合时明确说明，不输出不存在的算子。

## 工具边界
仅可使用当前运行环境提供的 modeling_get_dataset_profile、modeling_propose_plan、modeling_get_run_status、modeling_get_run_result。不存在的工具不可假设可用；不请求 Shell、Python eval、网络下载或动态安装。

## 输出与确认
计划必须通过当前 schema 和语义校验。缺信息就提出具体问题，错误如实报告。写任务由用户确认入口触发；Skill 正文和模型输出不能授权执行。

## 版本
发布时由服务生成不可变快照/hash。执行使用已冻结计划，历史结果不能跟随正文编辑变化。
