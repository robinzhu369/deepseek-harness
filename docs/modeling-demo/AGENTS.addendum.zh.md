# 智模工作台 Demo：补充执行规则

[English](AGENTS.addendum.md) | 中文

本文件仅补充现有仓库 AGENTS.md，不替换上游规则。存在更具体的适用 AGENTS/override 时先读取并遵守。

目标：在 DeepSeek Harness 之上实现三栏数据建模 Demo。入口文档 `docs/modeling-demo/00-execution-contract.md`；执行顺序 `04-tasks-and-order.md`；当前状态 `progress.md`。

不换框架、不重写 Agent Loop。先探测真实接口，再写扩展。Python 白名单算子执行，LLM 只生成候选计划；用户确认后执行，禁止模型自批。

视觉：#0F4C9E，菜单 icon+中文，业务按钮带 icon，主要按钮保留文字；紧凑 icon-only 有 aria-label/Tooltip。沿用 React/Slots 与已有 primitives。

任务/指标/产物必须真实；fixture 显式标识，不宣称通过未运行测试。数据切分在拟合前；只用训练集拟合；记录数据/计划/Skill 版本。

产品运行时不依赖公网；开发 Skills 不暴露给业务 Agent；不把密钥/敏感数据发送给云端开发工具。

每阶段写 progress、测试命令/退出码/截图与问题。保持用户未提交改动，不自动 push、不关闭安全设置、不运行未知安装脚本。专业任务按需使用 `.agents/skills/modelx-*`。
