# Runtime Business Skill Templates

English | [中文](README.zh.md)

The four directories contain the main content and project-specific manifest templates. T06/T09 must integrate controlled `SkillProvider` or runtime-only `.dsh/skills` using fixed versions, not as Codex-developed Skills.

The `version/allowed_tools` fields in the manifest are designed by this project and require implementation by business loaders; they do not imply that Harness automatically identifies this JSON and enforces permissions. Tool permissions must be validated by actual presets, registration, and server-side execution checks.

Do not mount entire development repositories as business workspaces. During release, fix main content, schema/operator versions, and hashes; never overwrite historical release artifacts directly. Editable main content does not permit users to import executable scripts.
