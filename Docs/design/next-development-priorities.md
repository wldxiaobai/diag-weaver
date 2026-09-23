# 下一阶段开发优先级

> 2026-09-23，基于第一期完成后的代码库探查（`npm test` 12/12 通过、`tsc` 构建干净；画布冒烟因环境无浏览器未做）。
> 第一期已落地：精简 MCP 工具面（7 工具）、BrowserHost 活画布、快照存储、全局 `pnpm run link`。

## 第一优先级：正确性与健壮性修复

建议分支：`fix/xml-safety-and-autosave`（基于 `dev`，走 PR）。

### 1.1 多页图安全

- **现状**：`src/xml.ts` 的 `applyPatch` 把新单元格插在**最后一个** `</root>` 之前；`summarizeXml` 跨所有 `<diagram>` 页面平铺扫描。用户导入多页 `.drawio` 后，Agent 补丁会命中错误的页，且 id 可能跨页冲突。
- **方案**：`diagram_read` / `diagram_patch` / `diagram_replace` 明确按页操作——检测到多页时要求显式 `page` 参数（或在返回结构中按页分组、只允许补丁目标页）；`summarizeXml` 输出按页分组。
- **验收**：多页 XML 回归测试证明补丁命中目标页；单页行为不变。

### 1.2 autosave 原子写与串行化

- **现状**：`src/store.ts` 的 `writeCurrent` 直接 `writeFile`，进程中途被 kill 可能留下半截 `current.drawio`；`src/app.ts` 的 `persistAutosave` 是 fire-and-forget，连续拖拽可能并发写同一文件。
- **方案**：临时文件 + `rename` 原子写；autosave 写入走串行队列。
- **验收**：并发 autosave 场景下 `current.drawio` 始终完整可读（回归测试）。

### 1.3 WebSocket 桥加固

- **现状**：`src/browser-host.ts` 的 `/bridge` 不校验 Origin，本机任意网页都能连入并向画布注入 `load`；socket 被第二个标签页顶掉后，进行中的 `load` / `export` 要干等 60 秒超时。
- **方案**：握手时校验 Origin（仅接受本机编辑器页）；socket 关闭或被顶替时立即 reject 全部 pending waiters。
- **验收**：桥协议测试覆盖断连快速失败路径。

## 第二优先级：功能补全（不扩张工具面）

### 2.1 `diagram_patch` 增加 `remove_node` / `remove_edge` op

- **现状**：Agent 想删一个框只能整图 `diagram_replace`，会丢掉用户手工布局。
- **方案**：扩展 `src/mcp-server.ts` 的 `patchOpSchema` 联合类型与 `src/xml.ts` 的 `applyPatch`。这是结构化 op 的补全（加框、连线、改字、**删元素**），不违反「禁止格子级几何 API」红线。
- **验收**：补丁单测 + 同步 README 工具说明与 `src/mcp-server.ts` 描述。

### 2.2 `diagram_export` 支持 `format: drawio | png | svg`

- **现状**：只能导出 `.drawio` XML；「把架构图插进 README / 文档」需要图片是高频场景。
- **方案**：embed 的 `action:"export"` 原生支持 png / svg（base64 返回）；在 `src/browser-host.ts` 增加对应导出，解码后写盘。**红线不变：只在显式给出路径时才往工作区写文件。**
- **验收**：单测覆盖 base64 解码与路径写入；改完 `web/editor.html` / embed 桥后做一次画布冒烟（`node scripts/smoke-embed.mjs`），不得只凭单测声称可用。

## 第三优先级：工程配套

### 3.1 CI

- **现状**：仓库无 GitHub Actions 工作流，测试全靠本地手动跑。
- **方案**：push / PR 触发 `pnpm install && pnpm test && pnpm build`（linux）。
- **验收**：PR 上能看到红 / 绿示例。

### 3.2 「懒启动」口径对齐

- **现状**：`AGENTS.md` 称「懒启动的本地 HTTP 编辑器」，但 `src/index.ts` 在进程启动即 `host.listen()`（只绑端口、不建目录，行为无害，口径不符）。
- **方案**：二选一——改成真正懒启动（首次 `editor_ensure` 时再监听），或修订 `AGENTS.md` 表述。无论哪种，「握手 / `tools/list` 不得 mkdir、不得写 Agent cwd」红线保持不变。
- **验收**：文档与代码一致；`pnpm test` 通过。

## 本次范围之外（第二期方向提醒）

- 第二个 `EditorHost` 实现（Webview / MCP Apps：画布直接嵌入聊天 UI 而非外开浏览器）。建议放在第一优先级完成之后，否则多页缺陷会在每个新宿主里重现。MCP 工具名在此过程中不得改变。
