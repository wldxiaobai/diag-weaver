---
name: git-commits
description: 执行或编写 Git commit（含 AGENTS.md 原子功能自动提交节奏）、备份、存档、暂存改动时使用；涵盖暂存安全、Conventional Commits 信息格式与受保护分支。
---

# Git 提交规范

## 提交前

- 提交节奏遵循 AGENTS.md「Git 提交节奏」：每完成一个可独立验收的最小改动立即自动 commit，禁止积攒；范围不明确（改动边界模糊或混有无关改动）时，先列出改动并确认范围；不得越权提交无关改动。
- 同时检查 `git status`、暂存与未暂存差异、当前分支及近期提交信息；不得覆盖或顺带提交用户的无关改动。
- 将改动按功能边界分组。一个 commit 应能独立 review、revert 和 cherry-pick，并保持项目可编译、逻辑完整。
- 同一功能跨多个文件可以作为一个 commit；互不相关的功能必须拆分，并按“基础数据/设施 → 逻辑 → 表现与集成”的依赖顺序提交。

## 暂存与安全

- 按明确文件暂存；混合工作区中禁止使用 `git add .` 或 `git add -A`。
- 不得提交构建产物与本地垃圾：`dist/`、`node_modules/`、`coverage/`、`smoke-result.json`、个人 IDE 配置（`.vscode/`、`.idea/`、`.cursor/`）。
- 改动 MCP 工具面后，将 `src/mcp-server.ts`、对应测试与 README 中的工具说明同一次提交；禁止只改文档不改契约，或只改契约不补测试。
- 提交前检查密钥、密码、令牌、连接字符串、内网地址和本地环境配置（含 `.mcp.json`、`.cursor/mcp.json`）；疑似敏感文件不得提交。
- 不修改 Git 配置，不跳过 hooks。hook 失败后先修复并创建新 commit，不因失败而 amend。
- 分支管理（`main` 仅用户操作 / `dev` 禁止直接提交功能与修复但允许维护仓库类 / 功能·修复基于 `dev` 建 `feature/<name>`、`fix/<name>` 分支走 PR/MR）以 AGENTS.md「分支管理」为唯一准绳。

## Commit 信息

使用 Conventional Commits：

```text
<type>(<scope>): <subject>
```

- 常用 `type`：`feat`、`fix`、`docs`、`style`、`refactor`、`perf`、`test`、`chore`、`revert`。
- `scope` 使用实际模块，如 `mcp`、`editor`、`host`、`store`、`xml`、`web`、`test`、`docs`、`build`。
- `subject` 使用中文命令式短语，建议不超过 50 个字符，结尾不加句号；准确描述提交目的，不罗列文件名。

## 提交后

- 检查 `git status` 并报告 commit 摘要及仍未提交的改动。
- 自动提交只覆盖本地 commit；**推送（push）仍仅在用户明确要求时执行**，提交不等于推送。
