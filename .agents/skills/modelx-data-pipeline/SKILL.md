---
name: modelx-data-pipeline
description: Use for implementing deterministic CSV profiling, preprocessing, feature
  engineering, scikit-learn training, plan validation, job execution and artifacts
  for the modeling Demo. Never for unrestricted model-generated code.
---

# 数据计算与建模实现

## 固定协议
读取计划 schema、API 和测试章节。先写非法字段/未知算子/目标泄漏/审批缺失等失败用例，再实现白名单 Pipeline。

## 正确性
- LLM 只输出候选 JSON；拒绝代码、Shell、SQL 与未知键。
- 先切分，任何学习型填充/编码/缩放只在训练集 fit；保存预处理器并对其他集 transform。
- 目标/ID 不进入特征，记录 seed/split/data hash/plan/Skill snapshot。
- 无目标/单类别/少数类不足明确报错。涉及实体或时间依赖但未支持切分时不能假设 IID。
- 指标来自真实预测；测试集不用于选模型/阈值，不承诺高分。

## 执行
子进程运行受信入口，shell=False；单并发，真实超时/取消、非 root、有限资源。API 持久化状态，Worker 只写受控目录/事件。原子完成文件后登记 artifact。
上传分块落盘；Polars 可惰性处理但不假定所有操作都 streaming；大稀疏矩阵不能强行 densify。训练可只用明确标注的受限样本，但不得伪称全量。

## 验证
合成数据固定种子；测试 fit 行集合、特征名、checksum、幂等/取消/重启、下载权限。先产生真实 metrics/manifest，再给 UI 连接。

## 参考
- [API/语义](../../../docs/modeling-demo/03-api-and-data-contracts.md)
- [计划 schema](../../../docs/modeling-demo/contracts/modeling-plan.schema.json)
- [测试](../../../docs/modeling-demo/06-tests-and-acceptance.md)
