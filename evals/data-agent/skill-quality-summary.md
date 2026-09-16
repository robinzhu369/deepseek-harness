# Skill 0.1.1 真实合成评测

**结论：72 个规划会话已完成，候选通过 30/36 次；四个 Skill 均未达到全用例通过要求，未发布。**

| Skill | 候选 | 无 Skill 基线 | 冻结计算 | 剩余失败 |
|---|---:|---:|---|---|
| data-analysis | 7/9 | 7/9 | 通过 | MODEL_TIMEOUT, NO_RESULT |
| data-cleaning | 7/9 | 8/9 | 通过 | INVALID_RESULT |
| feature-engineering | 8/9 | 6/9 | 通过 | NO_RESULT |
| numeric-quality-review | 8/9 | 7/9 | 通过 | NO_RESULT |

## 方法与证据

- 使用 `deepseek-v4-flash`，目标为用户授权的 `https://api.deepseek.com`；每个 Skill 有回归、独立合成留出、保护规则三个规划用例，基线与候选各重复三次。完整 Schema 与相同任务配置同时提供给两组。
- 候选为 0.1.1，明确禁止额外状态字段，并要求数据修改方案列出确认项。0.1.0 的失败记录保留，旧留出数据归入开发证据；未将旧结果改写为通过。
- 确定性 Python 校验验证 120 行数据的统计、合法值保持、标签对齐、固定公式、切分复现、仅训练拟合与未知类别宽度。冻结通道不证明开放规划质量提升。
- 评分器允许正确的补充行数统计与合法的只读验证节点。修正只在本地重放原始响应，保留原报告；没有通过新增模型尝试替换失败样本。
- 原始结果：[skill-quality-real.json](skill-quality-real.json)；本地复核：[skill-quality-real-rescored.json](skill-quality-real-rescored.json)；汇总与 token 用量：[skill-quality-summary.json](skill-quality-summary.json)；源码指纹仅本地保存在 [skill-quality-local-components.json](skill-quality-local-components.json)。完整会话位于 `skill-quality-real-sessions/`。

## 仍未满足的条件

- `MODEL_TIMEOUT`：规定的 60 秒内未完成结果提交；`NO_RESULT`：模型没有调用结果工具；`INVALID_RESULT`：不符合严格结果或工作流 Schema。候选共六次规划失败，质量门禁保持关闭。
- 本轮是小规模合成任务评测；各组三次重复不足以证明一般性收益，不能据此声称 Skill 优于基线。
- 未取得人工标注业务案例或审核人签收；保护用例主要验证拒绝状态与 Schema，没有完整评价自由文本理由。
- 未验证目标内网、容量、容器全链路、业务任务链或工作台交互。模型快照未固定，金额成本未知，记录为 null。
- 当前接口拒绝用合成套件发布 Skill，即便套件全部通过也不解除业务评测要求。
