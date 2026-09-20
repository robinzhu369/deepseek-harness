# 06｜测试与验收

## 6.1 最低业务用例

| ID | 用例 | 预期 |
|---|---|---|
| E01 | 上传合法合成 CSV | 文件落盘，hash 稳定，Profile 与实际数据一致 |
| E02 | 空 CSV / 无表头 / 重复列名 / 非支持编码 | 明确拒绝，不产生可用假数据集 |
| E03 | 对话提出完整建模请求 | 真实调用领域工具，产生 schema 合法候选计划 |
| E04 | 没有选择目标列 | 停在待补充，训练不可启动 |
| E05 | 模型直接请求执行或夹带 approve 字段 | 被白名单/schema/权限拒绝 |
| E06 | 用户确认计划两次/网络重试 | 同一幂等请求只创建一个 run |
| E07 | 计划 revision 或数据 hash 已变化 | 409，用户需重新确认 |
| E08 | 正常运行 | 节点状态真实推进，输出真实文件和指标 |
| E09 | 切换会话与刷新 | 正确恢复当前会话，不重新执行、不串状态 |
| E10 | 取消运行/强制 Worker 失败 | cancelled/failed；下游 blocked，未完成文件不可下载 |
| E11 | 服务重启 | 原运行标记 interrupted，不假称续训/成功 |
| E12 | 修改模型参数重跑 | 新 run_id，旧结果保留，合法复用有证据 |
| E13 | 修改清洗/特征规则重跑 | 相关下游失效，不复用错误的预处理结果 |
| E14 | 发布 Skill 新版本 | 新计划使用新快照，旧计划不变化 |
| E15 | 手工配置模式/LLM 失败 | 明确标记，不被算作 Agent 实时闭环 |
| E16 | 访问另一会话 artifact / path traversal | 拒绝，无文件或 token 泄露 |

## 6.2 数据科学正确性用例

构造训练集与验证/测试集具有不同缺失统计值的可控数据，验证填充值来自训练集。Spy/Mock 或显式拟合行记录验证 fit 从未看到验证/测试行。目标和记录 ID 不进入特征。

测试 One-Hot 未知类别、高基数、全空列、数值 NaN/Inf、少数类不足、标签类型/positive_label 不匹配。Split manifest 中各集合不重叠且覆盖合法样本。报告中的指标能够由保存的预测/模型与测试数据重新计算一致。

对 prepare_dataset 路径同样检查拟合边界；禁止因为“暂不训练”就全量拟合后再把文件标记为训练/验证/测试。

## 6.3 前端验收

| 检查 | 标准 |
|---|---|
| 主色 | 主要操作、选中项均为 #0F4C9E 系列，非默认紫色 |
| 菜单 | 展开态每项 icon + 中文标签；选中态明确 |
| 按钮 | 业务按钮带 icon；主要操作保留文字；icon-only 有名称/提示 |
| 三栏 | 1440/1366 可用，右侧收起不影响中间 |
| 滚动 | 消息/侧栏分别滚动，无全页水平溢出 |
| 输入框 | 不覆盖最后消息，IME Enter 不误发 |
| 信息口径 | 总列/特征/目标分开；采样统计标识可见 |
| 状态 | 空、载入、确认、运行、失败、取消、完成均有下一步 |
| 键盘 | Tab/Shift+Tab 可达，焦点可见，弹窗可 Esc 退出并恢复焦点 |
| 性能 | 大表只预览和分页，不把百万行 JSON 传到浏览器 |
| 真值 | 不从 LLM 文案推断完成，指标来自后端 |

最少保存：workspace-empty、dataset-ready、plan-review、run-running、run-failed、run-succeeded 六类截图。桌面两种视口必测；1024/390 响应式验证优先级低于真实链路，但未验证需列出。

截图目录 `docs/modeling-demo/evidence/<date>/`。每张记录浏览器、视口、数据模式（fixture/live）、run_id（如有），不得让含密钥的 URL 或原始敏感记录进入截图。

## 6.4 建议测试结构

```text
services/modeling-api/tests/
  test_plan_validation.py
  test_split_and_leakage.py
  test_upload_profile.py
  test_approval_idempotency.py
  test_run_lifecycle.py
  test_artifact_security.py
  test_skill_versions.py
packages/modeling/.../tests/       # 实際路径由 T00 确认
  client-state.spec.ts
  modeling-tools.spec.ts
  modeling-ui.spec.tsx
tests/modeling-demo/
  happy-path.spec.ts
  failure-and-refresh.spec.ts
  visual-smoke.spec.ts
```

遵循上游测试与构建命令，不用猜出的 npm test。将实际命令写入 REPO_DISCOVERY；命令不存在就是失败，不静默跳过。

## 6.5 独立性能测试

百万行 × 百列测试记录硬件、数据类型/字符串基数、磁盘、文件字节、软件版本、每步 elapsed 和 peak RSS、是否全量、产物大小。Streaming 不表示所有算子都流式，部分操作可能回退到内存；大矩阵转换同样受内存限制。[S12]

默认不承诺“百万行几秒完成”或“8GB 一定够”。只报告实际测量。未做测试使用 `SCALE_NOT_RUN`；不能用 Profile 读完文件推断所有清洗/特征/训练已支持。

## 6.6 完成报告模板

```text
实现：F01/F02/…
真实业务验证：E01 PASS …
模型规划链路：LIVE_PASS / NOT_RUN / FAIL
视觉验证：视口、截图文件、修复内容
规模验证：实际数据规模和报告路径 / SCALE_NOT_RUN
构建与测试：命令、退出码、摘要
未实现/限制：明确列出
启动方式与演示步骤：可复制命令
```

最终不要求模型指标“好看”，要求结果真实、可解释、可复验；不将软件 Demo 说成生产级风控平台。
