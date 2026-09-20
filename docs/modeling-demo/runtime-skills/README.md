# 运行期业务 Skill 模板

四个目录为正文与本项目自定义 manifest 模板，需要 T06/T09 按固定版本接入受控 SkillProvider 或 runtime-only .dsh/skills。不是 Codex 开发 Skill。

manifest 的 version/allowed_tools 是本项目设计，需要业务加载器实现；不是声称 Harness 自动识别该 JSON 并强制权限。工具权限必须由实际 preset/注册和服务端执行校验保证。

不要把开发仓库全量挂载为业务 workspace。发布时固定正文、schema/算子版本和 hash；不要直接覆盖历史发布文件。正文可编辑不代表允许用户导入可执行脚本。
