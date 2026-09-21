# 智模工作台 8～10 分钟演示指南

## 1. 启动环境（约 1 分钟）

操作：从仓库根目录运行 `scripts/modeling-demo-up.sh` 与 `scripts/modeling-demo-health.sh`，打开启动脚本输出的 `Harness Web:` 完整地址，保留 `?token=...` 查询参数。预期：API 200、Web 在鉴权前为 401 且 PID 存活，带令牌地址打开后 Harness 显示“智模工作台”。失败时检查 `.env`、DeepSeek credential 和 `${MODELING_DEMO_ROOT}/logs/`。

## 2. 上传 Demo Dataset（约 30 秒）

操作：创建新 Session，在数据中心上传受支持的合成 CSV。预期：状态 `uploaded → profiling → ready`，显示有限 Preview。失败时检查 CSV UTF-8、表头、重复列、上传上限及 Session ID 是否一致。

## 3. 输入精确 Prompt（约 1 分钟）

操作：粘贴：`请分析数据集 <dataset_id>，针对 label 生成二分类建模方案。依次加载 data-analysis、data-cleaning、feature-engineering、model-training；只提出方案，不自动执行；明确排除字段、缺失值处理、类别编码、60/20/20 切分和逻辑回归；等我确认并完成运行后，再加载 model-evaluation，基于真实结果解释指标、混淆矩阵和阈值。` 预期：规划阶段加载前四个 Skill 并调用 `modeling_get_dataset_profile` 与 `modeling_propose_plan`；运行成功后加载 model-evaluation 并调用 `modeling_get_run_result`。失败时检查 Provider、credential、Dataset Session 归属与 Profile 状态。

## 4. 查看 Profile 与 proposed Plan（约 1 分钟）

操作：切换到建模工作台。预期：真实样本/列数、缺失摘要、计算范围、Plan revision/hash、`proposed` 与待确认状态；此时没有 Run。失败时点击刷新并检查 Modeling API。

## 5. 修改一个参数（约 30 秒）

操作：点击“修改方案”，把逻辑回归 `C` 从 1 改为 0.5，保存新 revision。预期：revision/hash 改变，页面列出 Train → Evaluate → Result 失效；当前实现如实说明会完整重算。失败时检查 revision 冲突并刷新后重试。

## 6. 人工确认并观察时间线（约 1 分钟）

操作：点击“确认并执行”。预期：只有此时创建 Run，状态经过 queued/running/succeeded，节点事件来自真实 Worker。失败时检查单并发、timeout、Worker 日志和 Plan 是否仍为 proposed。

## 7. 查看结果（约 1 分钟）

操作：查看 ROC-AUC、AP、F1、阈值、混淆矩阵与样本数；让 Agent 依次调用 run status/result 解释。预期：Agent 区分排序能力与阈值 0.5 的分类表现，不美化 F1=0。失败时确认 Run 已 succeeded。

## 8. 下载 Artifact（约 30 秒）

操作：通过 Artifact ID 下载 `metrics.json` 或模型产物。预期：只下载 completed 产物，下载文件 SHA-256 与 manifest 一致。失败时检查 Artifact 是否属于当前 Session；客户端路径不是合法下载参数。

## 9. 修改模型参数并 Rerun（约 1 分钟）

操作：选择“调整方案并重跑”，把 `C` 改为 1.5，保存并再次人工确认。预期：创建新的 revision 与独立 Run，旧 Run 保留，`rerun_of` 指向旧 Run。失败时检查幂等键、revision 与当前 Run 状态。

## 10. Run History 与 Skill Center（约 1 分钟）

操作：打开运行记录与技能中心。预期：历史页同时显示两个 succeeded Run；技能中心仅显示五个建模 Skill 及其发布版本，“技能自检”与模型评估 Skill 含义不同。失败时确认仍处于同一 Session，点击刷新。
