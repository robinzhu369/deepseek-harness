# T15 本地离线交付与运维验证

## 结论

2026-09-16，按用户“暂无目标环境，先完成本地离线演练；仍无业务标注，继续合成回归”的范围完成本地验证。正式发布保持关闭。操作与限制见 [离线说明](../deploy/data-agent/offline/operations.md)，签收项见 [T16](t16-signoff.md)。

## 已验证结果

| 项目 | 结果 | 证据 |
|---|---|---|
| Worker 失败分类 | 真实百万行宽表 OOM 保留 MEMORY_LIMIT；高基数拟合保留 DIMENSION_LIMIT；均无训练包发布 | [失败证据](../evals/data-agent/t15/failure-evidence.json) |
| 容器与失败恢复 | Python 40/40，无跳过；取消、过期凭据、重放和网络失败日志保留 | [Worker 测试](../evals/data-agent/t15/worker-tests.txt) |
| 离线目录安装 | 独立 Node、依赖及三个镜像导出；v1 文件大小合计 2,052,382,331 字节；校验后导入，无安装时下载 | [包清单](../evals/data-agent/t15/package.json)、[安装](../evals/data-agent/t15/install.json) |
| 完整业务链 | 新应用 home 与新浏览器经 Nginx TLS：上传 200 行、审批、三阶段、导出摘要、缓存重跑通过 | [业务链](../evals/data-agent/t15/business-chain-result.json) |
| 本地网络与证书 | 应用公网 TCP 被内核 EPERM 拒绝；Worker 无网络；163 个浏览器请求与 1 个 WebSocket 无外部来源；未信任证书被拒绝 | [策略](../evals/data-agent/t15/egress-policy.json)、[浏览器](../evals/data-agent/t15/offline-browser-result.json) |
| Skill 合成评测 | 18 个新 Web 评测会话完成；合成评测通过仍不能发布 | [业务链](../evals/data-agent/t15/business-chain-result.json) |
| 停服快照恢复 | 空库+新目录恢复；13 个产物共 35,141 字节逐项摘要/大小一致；任务完成、训练包可下载，无重复发布 | [恢复](../evals/data-agent/t15/recovery-result.json)、[恢复启动](../evals/data-agent/t15/restored-browser-result.json) |
| 升级与回退 | v1 → v2 → v1，两个兼容版本分别重新启动，保留任务与导出 | [版本切换](../evals/data-agent/t15/upgrade-result.json)、[升级](../evals/data-agent/t15/upgrade-browser.txt)、[回退](../evals/data-agent/t15/rollback-browser.txt) |
| 交付负例 | 4/4：篡改、缺文件/额外文件、外部链接、平台不符、运行中切换、格式不兼容、并发激活被拒绝 | [测试](../evals/data-agent/t15/delivery-unit.txt) |
| 领域合成回归 | 62/62，无跳过；包含审批拒绝不发布、不调度后代，权限、任务链和 Skill 发布限制 | [回归](../evals/data-agent/t15/synthetic-regression.txt) |

## 必须保留的边界

- 平台为本机 macOS arm64 + Docker Desktop；Docker daemon 已存在，未验证目标 Linux 主机和无镜像缓存的全新机器。包内确实包含完整镜像 tar，并执行了 load 与 ID 校验。
- Nginx 在独立桥接网络使用固定上游；代理自身的出口防火墙及全主机网络审计尚未验证。应用和 Worker 的隔离证据不能替代 AC-29 完整验收。
- 本次使用受控本地对象卷；RustFS/S3、企业认证、实际内网模型及目标证书未接入。
- 0.217 秒是 200 行合成状态的恢复函数耗时，不包含人工切换、启动和校验，也不是生产 RTO。快照后数据不包含在恢复范围内；生产 RPO/RTO 未指定。
- 两个演练版本使用相同数据库与产物格式；未进行跨 schema 升降级。失败分类实测与合成回归不构成人工业务签收。
- 历史真实模型结果仍为候选 30/36、基线 28/36；没有新增真实模型复测，没有人工标注数据，四个 Skill 候选保持未发布。

## 本地交付位置

完整离线包、安装目录和备份在仓库忽略目录 `.artifacts/data-agent-t15/`；不加入源码 Git 提交。可审查的脚本、镜像 ID、测试日志和报告位于版本管理目录。当前激活为 `local-t15-v1`，演练服务已停止后才完成签收资料整理。
