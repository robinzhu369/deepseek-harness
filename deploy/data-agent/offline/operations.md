# 本地离线交付操作说明

## 适用范围

此交付器面向同平台的本地演练。本次包为 macOS arm64，包含独立 Node 24.14.1、完整应用依赖、Linux arm64 Worker/PostgreSQL 镜像和 amd64 Nginx 镜像。接收机仍需 Docker（本次含 amd64 仿真）、Python 3.10+ 标准库和浏览器；没有验证通用 Linux 安装或全新 Docker 主机。实际记录见 [T15 报告](../../../implementation/t15-operations.md)。

安装过程只复制包内文件并执行 `docker load`，不运行 pnpm/pip，不下载镜像。包内应用依赖来自已构建工作区；`Worker.offline.Dockerfile` 需要已有且已审查的依赖镜像，不能替代第一次联网制备依赖。

## 制备与完整性

`delivery.py package` 按固定目录白名单复制源码、构建产物、依赖和运行时，导出 `images.json` 中的不可变镜像 ID。`manifest.json` 记录每个文件的 SHA-256、长度、权限和内部符号链接，以及平台、版本和格式兼容清单。校验拒绝缺失、额外或被修改文件、外部符号链接和平台不符。制备失败的目录不能安装。

此 manifest 是完整性清单，不是数字签名。接收人必须通过受信渠道获得整包及 manifest；攻击者同时修改文件和 manifest 不在该校验的保护范围内。不要将带真实业务状态或凭据的工作区作为制备源。本次基线提交含工作区增量，精确交付内容以包内文件摘要为准。

本轮执行过的入口（从仓库根目录运行）：

```sh
python3 deploy/data-agent/offline/delivery.py package --repo "$PWD" --output "$PWD/.artifacts/data-agent-t15/bundle-v1" --node /Users/robinzhu/.nvm/versions/node/v24.14.1/bin/node --images evals/data-agent/t15/images.json --release local-t15-v1
python3 deploy/data-agent/offline/delivery.py install .artifacts/data-agent-t15/bundle-v1 .artifacts/data-agent-t15/install
```

`install` 先校验原包，复制到随机 staging 目录后再校验、加载镜像，成功后才移入版本目录。它不会自动激活版本。目标目录不能含同名版本。文件清单严格包含额外文件，因此启动 Python 监督器时使用 `python3 -B`，不在交付目录生成 pycache。应用状态、日志、配置和凭据放到版本目录之外。

## 启动与禁外联

包内 `run-dsh` 经独立 Node 启动官方 `dsh` profile。最后应用 `offline.patch.yml`，关闭公网搜索/抓取、遥测、在线包发现及业务不需要的编码工具。部署方仍须显式配置模型网关与私有 CA；本次评测使用合成模型，没有验证实际内网模型。

macOS 演练以 `sandbox-exec` 加载 `loopback-only.sb`，通过 `-D DOCKER_SOCKET=绝对路径` 只允许 loopback 和指定 Docker Unix socket。Docker socket 是受信监督器的能力，仅计算容器不能访问它。Worker 容器使用 `--network=none`。浏览器记录全部业务请求，禁止非入口来源。Nginx 使用只读根文件系统、受限 tmpfs、固定 upstream 和仅 loopback 发布端口；本机 Docker 内部网络不能发布端口，所以本次代理桥接网络的公网防火墙尚未验证。不能据此宣称整台主机已禁公网。

浏览器演练只信任本次证书的 SPKI；Node HTTPS 使用指定 CA。未信任证书必须报错。实际环境须使用正式域名、私有 CA 和正确证书链，不能采用关闭全局 TLS 校验的方式。

## 升级与回退

先停止应用与所有 Worker，等待计算容器退出，并确认不存在外部写入者。状态目录的 `app.pid`、`worker.pid` 用于阻止已登记进程运行时激活或备份；缺失 PID 文件不能证明其他进程已停止，运维人员必须核对服务管理器。每次激活均重新校验版本。`activate(destination, release, state)` 原子切换 `current`，保留旧版本；兼容字段不同时报 `INCOMPATIBLE_REQUIRES_RESTORE`。同一激活根的并发切换由文件锁拒绝。

本轮已验证 v1 → v2 → v1，并分别从 `install/current` 启动 TLS Web、读取恢复后的任务和下载导出。两版数据库 schema 均为 8；这是同格式应用包切换，不是跨数据库版本迁移验证。格式变化必须提供并演练专门迁移与恢复方案。

## 备份与恢复

停止所有写入者后，`backup(state, output, postgres_container, database, docker)` 保存 `objects/`、`harness/` 和 PostgreSQL custom dump，并生成完整性清单。它排除 `.credentials.yaml`、`.env`、`settings.yaml`、`session.lock`、`node_modules`；排除指定文件不等于扫描所有秘密。会话与业务数据仍属于敏感备份，交付前核对自定义配置是否含凭据，并限制目录权限。凭据及证书在独立受控渠道重新注入。

`restore(snapshot, fresh_state, postgres_container, empty_database, docker)` 要求新状态目录和空数据库，使用单事务 pg_restore；拒绝覆盖已有状态或非空库。恢复后必须校验对象摘要、任务引用、权限、Skill 快照与历史；备份后的新增数据不在该快照内。磁盘故障造成文件复制失败时不得启用恢复实例，应清理失败的演练目标并重新恢复。

本轮真实恢复和后续启动证据保存在 [recovery-result.json](../../../evals/data-agent/t15/recovery-result.json) 与 [restored-browser-result.json](../../../evals/data-agent/t15/restored-browser-result.json)。0.217 秒仅为小型合成快照的恢复函数耗时，不是生产 RTO；生产 RPO/RTO 尚未指定。
