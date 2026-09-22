# 智模工作台部署与启动

[English](DEPLOYMENT.md) | 中文

本页是本地 Demo 的唯一启动入口。所有命令均从仓库根目录执行。

## 前置条件

- macOS 或 Linux；本次冻结环境为 macOS 26.6.2 arm64、10 核、24 GiB RAM。
- Node.js 26.9.0、pnpm 11.7.0、Python 3.10.20。
- 已执行 `pnpm install --frozen-lockfile`，Python 环境包含 FastAPI 0.128.8、Uvicorn 0.51.0、Polars 1.0.0、scikit-learn 1.4.0。
- DeepSeek 官方 API credential。模型 Provider 为 `deepseek-official`，模型 ID 为 `deepseek-flash`（界面显示 DeepSeek-V41-Flash）。

## 配置

复制 `.env.example` 为 `.env`，在本机填写 `DEEPSEEK_API_KEY`；不要提交 `.env`。可选变量包括 `DEEPSEEK_BASE_URL`、`MODELING_DEMO_ROOT`、`MODELING_DEMO_HARNESS_HOME`、API/Web 端口、上传上限、分块大小、预览上限、Worker 超时与取消宽限期。命令行环境中显式传入的 Demo 目录和端口优先于 `.env`，可用于隔离启动或临时避开端口冲突。默认上传上限为 100 MiB；百万行容量测试使用独立的 2 GiB 测试配置，不改变 Demo 默认值。

## 启动与健康检查

```bash
scripts/modeling-demo-up.sh
scripts/modeling-demo-health.sh
```

脚本启动 Harness Web/Host、Modeling API 与 API 内的单并发后台 Worker。启动脚本最多等待 10 秒，直到 Harness 写出认证地址，再执行服务健康检查；任一步失败都会停止本次启动的进程。请打开启动脚本输出的 `Harness Web:` 完整地址，不要删除 `?token=...` 查询参数；API OpenAPI 地址默认为 `http://127.0.0.1:8000/openapi.json`。健康输出中 API 应为 200，未携带令牌的 Web 探测允许 401；两个 PID 都必须存活。日志位于 `${MODELING_DEMO_ROOT}/logs/`。

## 停止

```bash
scripts/modeling-demo-down.sh
```

## 数据目录与重置

默认数据位于 `.artifacts/modeling-demo/runtime/`：`service/` 保存 SQLite、Dataset 与 Run 产物，`harness-home/` 保存本地 Harness Session，`logs/` 与 `pids/` 保存运行证据。先运行 down 脚本；确认无需保留历史证据后，人工移动整个 runtime 目录到备份位置即可得到空环境。启动脚本不会自动删除数据。

## 常见错误

- `MISSING_CREDENTIAL`：在根目录 `.env` 设置 `DEEPSEEK_API_KEY`，或通过 Harness credential 页面配置 DeepSeek 官方 Provider，然后重启。
- PID 文件已存在：先运行 down；若进程已异常退出，核对 PID 与日志后再人工清理对应 PID 文件。
- 端口已被占用：启动脚本会在创建进程前报告冲突端口及可识别的占用进程。`modeling-demo-down.sh` 会回收当前仓库中命令行与端口均匹配的遗留 Demo 监听进程，但不会终止其他目录或其他命令启动的服务；也可通过 `MODELING_API_PORT`、`MODELING_WEB_PORT` 选择其他端口。
- 找不到认证地址：检查 `logs/harness-web.log`；这表示 Web 在输出认证地址前异常退出。启动脚本会停止本次创建的 API 与 Web 进程，不会把其他端口监听者视为本次启动成功。
- `dsh web authentication required`：打开 `modeling-demo-up.sh` 输出的完整 `Harness Web:` 地址。直接打开不带 `?token=...` 的根地址会返回 401，这不是服务未就绪。
- Dataset not found：Dataset 按完整 Harness Agent ID 隔离，上传时 `X-Session-Id` 必须与 Agent ID 完全一致，包括 `session-` 前缀。
- 上传过大：调整本机 `.env` 中的 `MODELING_API_MAX_UPLOAD_BYTES` 后重启；不要绕过服务端限制。
- Run 未启动：只有界面的“确认并执行/重新执行”可以审批；Agent 工具不含审批能力。
