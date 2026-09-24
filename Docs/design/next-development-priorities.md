# 下一阶段开发优先级（已完成）

> 2026-09-23 拟定，2026-09-24 在分支 `fix/xml-safety-and-autosave` 落地。
> 第一期已有：精简 MCP 工具面（7 工具）、BrowserHost 活画布、快照存储、全局 `pnpm run link`。
> 下面三项都已实现。png / svg 导出没有对着活画布跑过 `node scripts/smoke-embed.mjs`，不能据此声称画布导出可用。

## 第一优先级：正确性与健壮性修复

### 1.1 多页图安全

- `diagram_read` 的 summary 按页分组（`summary.pages`），另保留跨页平铺的 `cells`。
- `diagram_patch` 只改一页。多页图必须显式传 `page`（1 起的页号，或页 name / id）；单页可省略。
- 指定的 `id` 按原样写入。冲突只看目标页：本页已有该 id 则报错；另一页的同名 id 不占名额。同一批操作里先删掉的 id 可以再加回来。

### 1.2 autosave 原子写与串行化

- `current.drawio` 与快照、导出都是同目录临时文件 + `rename`。
- 连续 autosave 按入队顺序串行落盘。

### 1.3 WebSocket 桥加固

- `/bridge` 握手：带 Origin 时只接受本机 `127.0.0.1` / `localhost` / `[::1]`，且端口必须是本次编辑器端口。无 Origin 的非浏览器客户端放行。
- socket 断开或被新连接顶替时，进行中的请求立即失败。

## 第二优先级：功能补全（不扩张工具面）

### 2.1 `diagram_patch` 的 `remove_node` / `remove_edge`

- 删节点会配对切除整个元素（含嵌套的子 `mxCell`），并级联 `parent` 指向被删节点的子孙，以及挂在这些 cell 上的边。
- `remove_*` 不触发重排，保留用户手工布局。

### 2.2 `diagram_export` 的 `format: drawio | png | svg`

- 显式路径才写工作区。缺省按扩展名推断：`.png` / `.svg` 为图片，其余为 `.drawio` XML。
- png / svg 由当前活画布渲染，**不接受 `page`，导出的是画布上正在看的那一页**。画布未连接时直接失败，不会先建目录。
- 解码与写路径有单测。embed 桥未改，活画布冒烟未做。

## 第三优先级：工程配套

### 3.1 CI

- push 到 `main` / `dev` 以及 pull request 会跑 `pnpm install --frozen-lockfile`、`pnpm test`、`pnpm build`。

### 3.2 「懒启动」口径对齐

- 进程启动只接 stdio。首次 `editor_ensure` 或 `diagram_replace` 才监听本机端口并打开浏览器。
- 握手 / `tools/list` 仍不建目录、不写 Agent cwd。

## 本次范围之外（第二期方向提醒）

- 第二个 `EditorHost` 实现（Webview / MCP Apps：画布直接嵌入聊天 UI 而非外开浏览器）。MCP 工具名在此过程中不得改变。
