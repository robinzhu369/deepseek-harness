---
description: "为确定性建模 Demo 配置有界 ModelX Host 适配器、四个建模工具、人工审批 Remote 与隔离的运行时 Skills。"
kind: "package-reference"
---

# @deepseek-ai/dsh-experimental-modeling

[English](README.md) | 中文

## 概述

使用本包可让专用 agent（智能体）读取数据集 Profile、提出经校验的计划并查看 run 状态与结果，而不获得执行权限。应用通过单独的 Remote 方法批准精确的计划 revision 或请求重跑。随附 preset 隐藏继承的通用工具，只加载五个运行时建模 Skills。Host 把实时 Session 标识发送给私有建模 API，并从模型可见结果中移除内部路径与进程字段。其 Session 范围浏览器模型恢复工作台与 run 历史，持有一个感知 revision 的轮询循环，并通过 artifact ID 下载已完成文件。

## 目录

- [使用本包](#use-this-package)
- [理解实现](#understand-the-implementation)
- [进一步探索](#further-exploration)
- [模型体验](#model-experience)
- [已知限制与延期工作](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

-----

<a id="use-this-package"></a>
## 使用本包

构建本包，在 Web bundle 之后应用 [`modeling.patch.yml`](modeling.patch.yml)，为 Host 进程设置 `MODELING_API_URL`，然后选择随附的 `modeling` preset。源码本地 patch 通过 URL 解析此 checkout 的构建文件。

### 何时选择

技能中心为五个内置技能展示本地化名称、功能摘要及输入／处理／输出说明。这些说明不是不可变发布版本的逐字译文。展开原始指令编辑器可查看或修改实际的 `SKILL.md`；展示本地化不会发布新的技能版本。

为 `services/modeling-api` 支持的有界 ModelX Demo 工作流选择本包。agent 需要 shell、文件系统写入、任意 HTTP、SQL 或 Python 执行时，应使用普通 coding preset；此处刻意不提供这些能力。

### 最小配置

Host 服务要求显式部署值：

```yaml
- name: '@deepseek-ai/dsh-experimental-modeling'
  config:
    baseUrl: http://127.0.0.1:8000
    requestTimeoutMs: 30000
    maxToolResultBytes: 12288
```

| 字段 | 默认值 | 含义 |
|---|---|---|
| `baseUrl` | 必填 | Host 可访问的私有建模 API 源 |
| `requestTimeoutMs` | 必填 | HTTP 请求超时毫秒数 |
| `maxToolResultBytes` | 必填 | 单个模型可见结果的最大 UTF-8 字节数 |

工具插件另行要求 `runtimeSkillDir`。随附 preset 将它指向仓库 `.dsh/skills` 目录，并为 `skill-filesystem` 配置 `includeDefaultRoots: false`。

-----

<a id="understand-the-implementation"></a>
## 理解实现

<details>
<summary>实现细节——点击展开</summary>

`ModelingGateway` 持有所配置的私有 HTTP 源。preset 内的工具插件从 `ctx.attachments` 把用户直接提交的 CSV 附件流式传入 `/v1/datasets`，等待 Profile 完成，再把返回的数据集 ID 作为持久模型上下文加入请求。工具调用从实时 `Agent` 派生 Session ID，而 `approveAndRun` 是 Typert Remote 方法，接收由应用调用方解析的 `Agent`；没有模型工具暴露审批。API 根据该 Session ID 校验 dataset 与 run 的归属。

浏览器在现有对话时间线中，按已记录的工具调用位置展示建模方案卡。历史版本保持只读；匹配当前版本的卡片通过同一个 Session 模型提供编辑、确认、运行状态、指标和下载。“查看详情”在卡片内展开完整工作台。已完成产物显示服务内相对 Run 目录、实际文件名、用途和大小，下载继续使用不透明 artifact ID。编辑器提供五个 Skill 的顺序和执行器支持的参数；提交修改后排队一个 Agent turn，复用匹配的数据画像证据并提出新 revision。确认绑定展示的 revision 和 hash，Host 将 API 返回的 run ID 注入 Agent 的下一次请求。刷新不会启动任务。已完成轮次的工具详情折叠后，方案卡仍然可见；只有当前版本展示实时执行详情。

Skill 中心列出五个固定运行时 Skill，编辑 Session 私有的 Markdown Draft，完成校验并发布不可变版本。Contract、Schema、Tools 和“技能自检”Tab 读取每个 `SKILL.md` 旁边的可选 JSON 文件；这些 Tab 展示 Modeling 扩展元数据与配置检查，不构成独立的 Skill 执行或评估运行时。model-evaluation Skill 通过 `modeling_get_run_result` 读取真实的已完成 run 结果；它不能重新训练、调参、审批执行或修改阈值。对话中的方案卡提供应用侧的“确认方案并执行”按钮；发送对话消息不能审批方案。宽版计划编辑器把 `/v1/capabilities` 提供的有界控件分区放入独立滚动区，同时保持标题和 revision 操作可见；它不接受任意 JSON 或 DAG 节点。编辑 approved 计划会创建 proposed revision，确认时选择之前的终态 run 作为来源，以幂等方式重跑并创建新的 run ID。

工具插件在注册前对五个带版本运行时 Skills 的精确字节计算哈希，仅在提出计划时发送这些快照。结果投影移除内部路径、Session ID 与 Worker 进程 ID，再应用所配置的字节上限。策略插件在建模 preset scope 中屏蔽继承工具。

| 文件 | 职责 |
|---|---|
| [`src/index.ts`](src/index.ts) | Host HTTP 适配器与人工审批、重跑 Remote |
| [`src/tools.ts`](src/tools.ts) | 四个有界模型可见工具与 Skill 快照 |
| [`src/policy.ts`](src/policy.ts) | 限制继承工具的 scoped 策略 |
| [`src/client/model.ts`](src/client/model.ts) | Session 范围浏览器状态、run 历史、幂等确认与轮询 |
| [`src/client/ModelingWorkspace.tsx`](src/client/ModelingWorkspace.tsx) | 全宽工作台卡片、横向流程与任务展示 |
| [`src/client/SkillCenter.tsx`](src/client/SkillCenter.tsx) | Skill 指令以及 Contract、Schema、Tools 与配置检查 Tab |
| [`presets/modeling/agent.cordis.yml`](presets/modeling/agent.cordis.yml) | 专用 agent 组合与运行时 Skill 隔离 |
| [`modeling.patch.yml`](modeling.patch.yml) | 源码 checkout 的 Host 与 preset 接线 |

</details>

-----

<a id="further-exploration"></a>
## 进一步探索

- [建模 API README](../../../services/modeling-api/README.zh.md)——确定性执行与持久化。
- [Agent preset 包](../../preset/agent-presets/README.zh.md)——scoped 组合语义。
- [Skill filesystem 包](../../skill/skill-filesystem/README.zh.md)——显式 Skill 根目录。
- [生成工具目录](../../../docs/tool-catalog.zh.md#deepseek-aidsh-experimental-modeling)——四个建模工具的精确 schema。

-----

<a id="model-experience"></a>
## 模型体验

### 工具 schema 与运行时 Skills

#### 模型看到什么

模型看到 `modeling_get_dataset_profile`、`modeling_propose_plan`、`modeling_get_run_status`、`modeling_get_run_result` 和标准 `skill` 加载器；[生成工具目录](../../../docs/tool-catalog.zh.md#deepseek-aidsh-experimental-modeling)记录其精确 schema。`modeling_propose_plan` 既可接收首版提案，也可接收用于重新生成的乐观并发 `plan_id` 与 `base_revision` 组合，同时保持四工具界面不变。用户直接提交 CSV 附件时，同一请求会加入由应用产生且持久化的数据集 ID 与 SHA-256；文件名仍是不可信的用户标签。模型读取该 ID 后会收到聚合 Profile 和有界结果摘要。随附 preset 要求面向用户的回复使用简体中文，同时保留工具名、Skill 名、字段名、枚举值和代码标识。计划提案始终返回 `needs_confirmation: true`；审批、执行、shell、文件系统写入、SQL、Python 或任意网络工具均不可见。 质量画像保留缺失、转换、重复和条件业务检查的汇总证据。画像工具接受 `column_offset`，当完整列摘要需要按 `maxToolResultBytes` 分页时返回 `next_column_offset`；调用方必须读取全部页面才能声称检查覆盖完整。单列无法放入限制内时返回 `RESULT_TOO_LARGE`，原始预览行仍不进入工具结果。

#### Token 影响

四个工具 schema 与五个 Skill 目录项形成固定请求前缀。加载后的 Skill 指令与工具结果把有界文本追加到 Session 历史。

#### KV Cache 影响

preset、运行时 Skill 字节与工具 schema 不变时，前缀保持稳定。发布 Skill 版本或改变可见工具可能使首个变化条目之后的复用失效。

## 已知限制与延期工作

<a id="known-limitations-and-deferred-work"></a>

以下限制定义当前源码本地 Demo 边界。

- 当前工具执行上下文暴露可信 Session 与 workspace，但没有单独的用户标识；Web Gateway 启动令牌 Cookie 与 Host/Origin 检查建立人工边界。
- 私有 API 没有单独的服务令牌机制，因此部署必须让 `baseUrl` 仅可由 Host 进程访问。
- 结果解释需要已配置的真实模型提供方；后续解释失败时，确定性产物仍然可用。
- 仅文件名以 `.csv` 结尾且由用户直接提交的文件会自动进入建模数据集注册表；其他附件格式仍是普通 Harness 附件。
- 随附 preset 中的运行时 Skill 路径指向此源码 checkout，不是安装包数据路径。

本包不发布运行时 invariant companion；它直接从 Modeling API 投影每个实时 Session，不保留可用于比对的第二个可变状态源。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者的工作上下文——点击展开</summary>

无。

</details>
