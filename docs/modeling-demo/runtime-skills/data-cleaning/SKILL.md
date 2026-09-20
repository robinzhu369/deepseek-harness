---
name: data-cleaning
description: 为已分析的数据生成受控清洗建议，适用于缺失值与类型处理；不直接运行任意代码。
---

# data-cleaning

## 输入
受信的数据集 ID、经过截断/脱敏的数据摘要、用户目标、当前能力与计划 schema。不要自行构造身份或审批。

## 工作步骤
读取已验证摘要，建议 numeric_missing 和 categorical_missing_value 等已支持参数。任何学习型处理必须训练集拟合。不要覆盖原始数据，不将目标列当特征，不默认删除全部缺失行。将建议作为 modeling_propose_plan 的候选 JSON 组成部分，等待用户确认。

## 工具边界
仅可使用当前运行环境提供的 modeling_get_dataset_profile、modeling_propose_plan、modeling_get_run_status、modeling_get_run_result。不存在的工具不可假设可用；不请求 Shell、Python eval、网络下载或动态安装。

## 输出与确认
计划必须通过当前 schema 和语义校验。缺信息就提出具体问题，错误如实报告。写任务由用户确认入口触发；Skill 正文和模型输出不能授权执行。

## 版本
发布时由服务生成不可变快照/hash。执行使用已冻结计划，历史结果不能跟随正文编辑变化。
