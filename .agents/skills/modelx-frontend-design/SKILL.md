---
name: modelx-frontend-design
description: 'Use for designing, implementing or polishing the three-column data-modeling
  workbench: #0F4C9E theme, icon/text menus, icon buttons, cards, task state and responsive
  browser review. Not for marketing pages.'
---

# Model X 风格工作台设计与实现

## 开始前
读 UI 规范和参考截图；查看现有 React/Slots/primitives/icon/theme。按仓库实际边界实现，不初始化新框架。外部设计 Skill 仅辅助，不能覆盖主色和工作台任务。

## 设计约束
1. 主色 #0F4C9E；白色面板/浅灰蓝背景；三栏 248 / 自适应 / 320（桌面）。
2. 菜单 icon+中文；所有业务按钮带 icon，主要动作保留文字；紧凑按钮带 Tooltip 与 aria-label。
3. 单一 SVG icon 体系，不用 emoji。系统中文字体，不用 CDN/远程字体。
4. 对话、计划、数据和任务为核心；没有大 Hero、营销卡片墙、紫色渐变或装饰性假指标。
5. 中栏独立消息滚动与布局内 Composer，不遮挡最后消息。表格仅内部横向滚动。
6. 实现空、载入、待确认、运行、失败、取消、断线、完成状态。无数据用“—”，不编造 AUC。
7. 业务状态来自 ModelingClientModel，不能从 LLM 文案推导完成。fixture 显式标记并与真实模式分开。
8. 键盘焦点、按钮命名、IME、表单错误、禁用原因、Tooltip 都必须可用。

## 工作循环
Tokens→骨架→组件状态→API 联调→真实浏览器截图→记录问题→修复→新截图。
优先 1440×900 / 1366×768；再检查 1024 和窄屏。无浏览器时报告 VISUAL_NOT_RUN，不能拿概念图冒充。
不要一次调用多套审美 Skill；可用 frontend-design 帮助校准，但不扩大工作范围。

## 参考
- [完整 UI 规范](../../../docs/modeling-demo/02-ui-design.md)
- [tokens](../../../docs/modeling-demo/ui/design-tokens.css)
- [离线布局原型](../../../docs/modeling-demo/ui/modeling-workspace-preview.html)
- [用户参考截图](../../../docs/modeling-demo/reference/modelx-reference.png)
- [验收](../../../docs/modeling-demo/06-tests-and-acceptance.md)
