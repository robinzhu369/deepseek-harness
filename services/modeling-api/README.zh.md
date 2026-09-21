# 建模 Demo API Worker

[English](README.md) | 中文

## 概述

本服务校验有界建模计划，使用 SQLite 保存数据集和任务状态，在后台分析上传的 CSV，并在独立 Python 进程中运行确定性逻辑回归 Pipeline。数据集文件和已完成的运行产物保存在配置的服务根目录下。

## 运行 HTTP 生命周期

从仓库根目录选择新的输出目录，验证上传、分析、审批、执行和结果查询：

```sh
T05_DIR="$(mktemp -d /private/tmp/modelx-t05.XXXXXX)"
python3 services/modeling-api/run_t05_demo.py --output-root "$T05_DIR/output" --rows 1200 --seed 20260920
```

运行器拒绝覆盖已有输出根目录。其摘要列出 Worker 持久化的数据集、计划 revision、run、指标、模型和 manifest。

## 直接运行 G1

只需验证固定数据科学 Pipeline 时，使用直接运行器：

```sh
G1_DIR="$(mktemp -d /private/tmp/modelx-g1.XXXXXX)"
python3 services/modeling-api/run_g1_demo.py --output-root "$G1_DIR/output" --rows 1200 --seed 20260920
python3 services/modeling-api/verify_g1_artifacts.py "$G1_DIR/output/run"
```

验证器检查产物 hash、切分隔离、模型重新加载，以及基于已保存测试集预测的指标复算。

## 测试

运行 Python 协议、Pipeline、上传、Profile、审批、持久化、取消和产物测试，然后编译并检查浏览器安全的 TypeScript 记录：

```sh
python3 -m pytest services/modeling-api/tests -q
pnpm exec tsc --project services/modeling-api/tsconfig.json
pnpm exec oxlint services/modeling-api/contracts --deny-warnings
```

## 运行保证

上传以有界分块读取，按 UTF-8 CSV 校验并计算 hash，且不信任文件名或 MIME 类型。Profile 响应标识数据集及其 SHA-256，使模型能提出绑定版本的计划；除此之外只含汇总统计和不超过配置上限的预览，不包含完整数据集。

审批要求幂等键、当前计划 revision 和 hash。提案计划保留由 Host 计算的运行时 Skill 版本与摘要快照。SQLite 负责 run 状态及有序事件，同一时间只运行一个建模进程；取消会先记录 `run.cancelling`，再终止所属进程组；服务仅在 Worker 发布并校验完整输出后登记产物。输入包含有效 `record_id` 时 Pipeline 使用该列，否则创建确定性的内部行 ID；两者均不会进入模型特征。节点失败时，其结构化错误会成为 Run 错误，不会被通用 Worker 退出消息覆盖。结果记录包含有界的切分与特征摘要，以及 ROC-AUC、平均精确率、F1、精确率、召回率、混淆矩阵、阈值和带证据的诊断与建议代码，不返回训练记录标识。

Skill API 只管理五个运行时建模 Skill。草稿归属于一个 Session；校验限制 frontmatter、大小、工具名与请求的能力；发布先写入不可变版本，再将其设为活动版本。已有计划与 run 记录保留原 Skill 快照，新计划使用活动版本。

编辑计划会创建 proposed revision，并记录该变更在语义上影响的下游阶段。当前 Worker 不复用阶段缓存，因此每次接受的重跑都会如实重新计算完整 Pipeline。重跑要求精确的 revision、hash、来源 run 和幂等键；它总是创建新的 run ID，同时保留之前的 run。

`GET /v1/workspace` 恢复一个 Session 所属的最新数据集、计划、run、节点事件、结果、警告和已完成产物元数据。它移除存储键与 Worker 进程字段，查询不会创建或恢复任务。

## 已知限制

该私有服务不暴露 agent 工具或浏览器界面。实验性建模 Host 适配器提供受信会话 header，并让 API 源不出现在模型参数中；API 没有单独的服务令牌，因此部署必须把私有源限制为仅 Host 可访问。Worker 限制单任务并发和墙钟超时，但尚未应用操作系统级 CPU 或内存配额。百万行容量检查仍是独立验证任务。
