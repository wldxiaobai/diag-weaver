# diag-weaver

本文档是本仓库 Agent 的常驻项目指令。Git 提交与历史安全见 `.agents/skills/`。

## 项目概览

diag-weaver 是 **图编辑器为核、MCP 为手** 的绘图工具：用户用手改画布，宿主 Agent（Cursor / Claude Code 等）用少量 MCP tools 改同一张图。不做独立对话 Agent，不内嵌 LLM，不扫工作区当第二个大脑。

- 真源：draw.io XML / 活画布（官方 embed：`embed=1&proto=json`，`autosave`，`layout`，Mermaid `descriptor`）。注入后禁止 roundtrip 回旧仓 Graph JSON。
- 编辑器宿主：`EditorHost` 接口；第一期 `BrowserHost`（本机 `127.0.0.1` HTTP + iframe `embed.diagrams.net`）。后续 Webview / MCP Apps **不改 MCP 工具名**。
- MCP 契约：`src/mcp-server.ts` 注册的精简工具面（`editor_ensure`、`diagram_replace`、`diagram_read`、`diagram_patch`、`diagram_snapshot`、`diagram_restore`、`diagram_export`）。不要扩张成格子级几何 API。
- 版本库：用户数据目录下 `current.drawio` + `snapshots/<时间>-<标签>.drawio`。进程启动、握手、`tools/list` **不得 mkdir、不得写 Agent cwd**。只有 `diagram_export` 在显式路径下才往工作区写文件。

## 常用验证命令

```sh
npm test
npm run build
```

活画布冒烟（需本机浏览器能打开编辑器页）：`node scripts/smoke-embed.mjs`。改 MCP 工具或存储行为后，至少跑 `npm test`；改 `web/editor.html` / embed 桥后应做一次画布冒烟，不得只凭单测声称「画布可用」。

- **不要**在 Agent cwd 自动创建 `graph-store` 或其它仓库目录。
- **不要**把 `dist/`、`node_modules/`、`coverage/`、`smoke-result.json` 入库（见 `.gitignore`）。
- stdout 是 MCP JSON-RPC 通道；诊断日志只写 stderr。

## 架构与关键数据流

入口 `src/index.ts`：stdio MCP + 懒启动的本地 HTTP 编辑器。`WeaverApp` 编排 `SnapshotStore` 与 `EditorHost`。用户拖拽与 Agent `load`/`replace` 共用一份 XML；autosave 进 `current`（空白图且尚无 current 时不落盘）。恢复 = 快照 copy 成 current 再 `load`，没有 Draft/Stage/Commit。

布局交给 draw.io（embed `layout` / Arrange），不要与自研几何双写。`diagram_patch` 只允许结构化补丁（加框、连线、改字），坐标交给编辑器。

## 重要工程约束

- 保持工具面精简；禁止再暴露 cursor、stage、`graph_nudge_*`、table_* 或 30+ 格子级工具。
- 禁止在编辑器内做聊天侧栏、自配 API Key、自带会话记忆。
- 新增/修改 MCP 工具必须同步 `src/mcp-server.ts`、对应测试与 README 工具说明。
- 默认存储根在用户数据目录（`DIAG_WEAVER_STORE` 可覆盖）；相对 cwd 路径仅用于显式 `diagram_export`。
- 新增注释与文档用中文；代码标识符、MCP 名称、报错字符串及第三方原文保留原语言。
- 不把 `// 新增开始` 一类临时展示标记写入仓库文件。
- 不 vendoring draw.io 源码；画布复用官方 embed。

## 交互与输出规范

- 默认中文回复；先改完再一两句说明非显而易见的权衡。
- 回复标明涉及文件路径；展示代码只给相关片段。
- 明确区分「已完成」「已验证」「未验证」；未实际运行测试/冒烟不得声称通过。
- 新增/重写文本文件用 UTF-8，遵循仓库换行与现有风格。

## Git 提交节奏

- **原子功能完成即提交**：每完成一个可独立验收的最小改动**立即自动 commit**，禁止积攒；提交后检查 `git status`。
- 一次提交只含一个原子功能及其配套（代码、测试、直接相关文档）。
- 提交信息、暂存安全、受保护分支细则见 `.agents/skills/git-commits/` 与 `.agents/skills/git-history-safety/`。
- **分支管理**：`main` 真正受保护，仅用户操作；`dev` 为代码集散地，功能开发与 bug 修复基于 `dev` 创建 `feature/<name>` / `fix/<name>` 分支并走 PR，禁止直接提交 `dev`；文档修缮、agent 配置、版本递增等维护仓库操作可直接在 `dev` 上提交。若尚无 `dev`，先从 `main` 创建本地 `dev`，**不要**往 `main` 提交。

## 按需技能

- `.agents/skills/git-commits/`：暂存、Conventional Commits、自动提交节奏。
- `.agents/skills/git-history-safety/`：merge/rebase、冲突、回退、强制推送。
