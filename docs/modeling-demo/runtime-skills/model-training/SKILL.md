---
name: model-training
description: 为独立样本的有标签二分类规划逻辑回归基线并解释真实结果；缺标签或不受支持的切分时不训练。
---

# model-training

## 输入
受信的数据集 ID、经过截断/脱敏的数据摘要、用户目标、当前能力与计划 schema。不要自行构造身份或审批。

## 工作步骤
确认 target、positive_label 与样本独立性；split-before-fit。选择服务支持的 logistic_regression 参数，不调试测试集指标。使用 modeling_propose_plan 保存完整候选计划而非执行。完成后用 modeling_get_run_result 获取真实 metrics，明确 split、阈值与样本量；不编造指标或因果结论。

## 工具边界
仅可使用当前运行环境提供的 modeling_get_dataset_profile、modeling_propose_plan、modeling_get_run_status、modeling_get_run_result。不存在的工具不可假设可用；不请求 Shell、Python eval、网络下载或动态安装。

## 输出与确认
计划必须通过当前 schema 和语义校验。缺信息就提出具体问题，错误如实报告。写任务由用户确认入口触发；Skill 正文和模型输出不能授权执行。

## 版本
发布时由服务生成不可变快照/hash。执行使用已冻结计划，历史结果不能跟随正文编辑变化。
