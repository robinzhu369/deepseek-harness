# 反欺诈数据清洗验收（2026-09-18）

本次从真实工作台操作 `fraud_transaction_data.csv`，选择 `deepseek-v4-flash`，完成分析、清洗、编码和导出。最终业务任务状态为 completed；过程包含人工纠正与本地补齐导出，不能据此宣称全自动建模准备已通过验收。

## 前端与功能调整

先统一按钮高度、圆角、主次操作、危险操作和键盘焦点；下拉框保留原生交互，统一边框、箭头及间距，输入框避免双层边框。新任务标题限制长度。随后补充 replace_missing 和 cast_numeric 算子，模型参数错误反馈包含字段路径，并明确 skill、任务阶段、fit/transform 和证据引用约束。运行快照默认返回简短元数据，详细schema按需读取。

## 实测问题

- 原始数据700行、38列，导入后全部为String；无重复行，但三个类别字段用问号表示缺失：collision_type 123、property_damage 259、police_report_available 247。
- 第一份模型提案只有fit而没有transform，不能完成实际填补或编码；人工检查后由DeepSeek修订为11个正确连接的节点，并补入policy_deductable数值转换。
- 独立inspect未进入任务分析链路，处理阶段报STAGE_ORDER；通过审批并执行任务analysis后恢复。模型还曾误用source_run_id，修正为null后成功运行processing。
- 模型重复读取大体积快照并误解证据引用，最终上下文溢出。简短快照和更准确的工具说明已实现，但未重新完成一轮无人工介入的DeepSeek验收。
- 自动审批拒绝了新会话向DeepSeek发送产物元数据。最终导出提案依据已发布元数据在本地生成，在页面审批和提交，没有再次外发元数据。

## 数据结果

| 分区 | 行数 | fraud=0 | fraud=1 |
|---|---:|---:|---:|
| 训练 | 489 | 363 | 126 |
| 验证 | 104 | 77 | 27 |
| 测试 | 107 | 79 | 28 |

分层比例参数70%/15%/15%，seed=0；按类别取整后得到上述行数。全部700行保留，三个分区行标识互不重叠。12个数值字段转换为Float64，17个类别字段展开为142个UInt8特征，共154个预测特征。众数填补和onehot均仅在训练集拟合，三分区使用相同变换器。独立校验确认特征无缺失、无非有限数值、字段一致，导出manifest中的所有文件哈希通过。

原始日期、邮编、标识和四个理赔金额字段未作为预测特征。此为测试中的保守选择；实际业务仍需确认预测时点及可用字段。原始数据未改动，没有训练模型。

## 产物与追溯

- 业务任务：cb94ab5c-30de-4f8d-9ab6-f8ac0e58c9bf。
- 分析运行：9bdb8c08-3d36-45a7-8a1c-aa5109ae56d5。
- 处理运行：acd61d8d-f0d1-46ff-af76-f6107f01d41f。
- 导出运行：c9ea24a0-f9dc-458e-9eda-524970973937。
- ExportRef：a25ff9f1-2132-4f4b-bcfe-eb000a7d4ddc。
- 本机产物目录：`.artifacts/modeling-acceptance-2026-09-18/`，未纳入版本控制。

`agent-export.zip` 保留三份Parquet、字段字典、处理配方、变换器和质量报告；Parquet保留追溯字段，训练时应按quality.json的feature_columns选择特征。另提供 `fraud-model-ready.zip`：三个CSV仅含154个预测特征和整数0/1标签fraud，附独立verification.json，便于直接训练。

## 验证

Python算子测试15项通过，TypeScript合约测试6项通过。真实Web快照更新后回放通过。GUI首轮375个文件通过、6个失败；修正3处中性边框宽度并解除本机端口沙箱限制后，失败的6个文件共51项全部通过。TypeScript检查和定向lint通过。以上为本机验收，不等于企业部署或完全自主Agent验收。
