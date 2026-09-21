# 百万行 × 100 列容量报告

## 结论

T13 容量验证为 **PASS**。固定种子 `20260921` 以 5,000 行批次生成 1,000,000 行、100 列 CSV，没有先构造整表 DataFrame。文件为 403,872,329 字节，SHA-256 为 `c88fbab70bb6061edf17962d60bac084291e8105041783ad9f424b936b737bfc`。

## 环境与方法

环境为 macOS 26.6.2 arm64、10 CPU、24 GiB RAM、Python 3.10.20、Polars 1.0.0。峰值 RSS 使用 `resource.getrusage(RUSAGE_SELF).ru_maxrss` 测量；macOS 返回字节。服务使用正式 `DatasetService` 的分块写入、CSV 校验、SQLite 登记和后台完整 Profile。清洗/特征步骤仅用训练分片拟合中位数与类别词表，再流式导出 train/validation/test Parquet。

## 结果

| 阶段 | 耗时 | 阶段结束时进程峰值 RSS |
|---|---:|---:|
| 批量生成 CSV | 0.779 秒 | 100,352,000 B |
| 分块上传、登记、完整 Profile | 20.541 秒 | 556,580,864 B |
| 清洗、类别编码、prepared/manifest 导出 | 3.651 秒 | 2,865,119,232 B |
| 总计 | 24.971 秒 | 2,865,119,232 B（约 2.67 GiB） |

Profile 返回 1,000,000 行、100 列，`computation_scope = {kind: full_dataset, rows_scanned: 1000000, preview_rows: 20}`。prepared 切分为 train 800,000、validation 100,000、test 100,000；105 个输出特征。三个 Parquet 合计 189,683,020 字节，均记录 SHA-256。完整逻辑回归训练为 `NOT_RUN`，因为本容量 Gate 不强制训练。

初次 prepared 尝试真实暴露了 Polars 1.0 投影/行索引组合的列偏移；改用稳定的 `record_id` 派生分片后，同规格最终命令退出码 0。最终结构化证据位于 `evidence/2026-09-21/t13-capacity.json`，失败尝试未被冒充为最终结果。
