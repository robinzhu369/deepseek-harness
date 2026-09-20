---
name: modelx-demo-qa
description: Use for end-to-end, correctness, visual, security and delivery verification
  of the modeling Demo. Require actual commands and screenshots, and distinguish live
  execution from fixtures or manual mode.
---

# 智模 Demo 验收

读取验收文档和实际启动/测试命令，保持上游测试规则，不删测试绕过失败。

## 必测
真实上传→Profile→LLM 工具/候选计划→人工确认→Python 计算→下载。另测非法输入、未确认执行、双确认、版本冲突、取消、Worker 失败、刷新/切会话、服务重启和越权下载。

检查 split-before-fit/目标排除/列顺序/预测指标可复算。检查运行期无开发 Skills、密钥不进日志、前端无外部 CDN，资源限制真实生效。

## 视觉
使用现有浏览器工具或 Playwright。至少 1440×900 和 1366×768，检查三栏、最后消息、输入框、icon、按钮标签、焦点、失败/空状态，保存修复后的截图。
截图不是业务断言；不要以截图中出现数字就证明真实训练成功。

## 交付纪律
命令+退出码+日志路径+截图+实际数据规模。未跑为 NOT_RUN，不能编造通过。明确 live/fixture/manual，百万行测试独立报告 SCALE_NOT_RUN 或实测。
最终提供启动、演示步骤、完成范围和限制，不自动 push/发 PR，不声称生产级风控可用。

## 参考
- [测试清单](../../../docs/modeling-demo/06-tests-and-acceptance.md)
- [部署与安全](../../../docs/modeling-demo/08-deployment-and-security.md)
- [演示脚本](../../../docs/modeling-demo/demo-script.md)
