# 真实 Skill 复测外发内容确认

目标：`https://api.deepseek.com`，模型 `deepseek-v4-flash`。通过现有 dsh Profile 的官方模型适配器执行，只评测，不发布 Skill。

拟发送内容：

- 四个 0.1.1 候选的 Skill 指令、manifest、输入/输出 JSON Schema：`skill-packages/data-analysis`、`data-cleaning`、`feature-engineering`、`numeric-quality-review`。
- 工作流/节点 JSON Schema 和白名单算子的输入端口、输出端口、参数 Schema；不发送 TypeScript/Python 实现源码。
- 固定的合成表格、合成字段角色及引用、合成业务问题和输出格式要求；无客户或业务数据。
- 合成策略/环境标识与模型生成的本次会话历史。基线不加载 Skill；候选加载对应完整文本包。

规模：四个 Skill × 三个规划用例 × 基线/候选各三次，共 72 个规划会话；另有一次既有诊断提交回归。每个规划会话最多等待 60 秒，模型单次最大输出 2048 token。完整 Session 和评测结果留存在本地，不调用发布接口获得发布资格。

不外发：源码文件内容、源码 SHA-256 清单、数据库凭据、真实数据、其他项目文件。API 密钥仅由适配器用于网关认证，不进入提示词、源码或评测报告。

本轮修改：候选从 0.1.0 升为 0.1.1，明确结果只含 Schema 允许字段，并要求所有数据修改方案列出确认项。此前已暴露的留出集转为开发证据，复测使用新的五行合成留出表。业务人工标注验收仍不具备，正式发布继续关闭。
