# diag-weaver

图编辑器为核，MCP 为手。用户继续用 Cursor / Claude Code 里已经在用的 Agent；本项目只提供 **活画布 + 少量 tools + 简单快照**。

```
用户 ──UI──┐
            ├──► 图编辑器 ──autosave / snapshot──► 版本库
Agent ──MCP┘
```

不做独立对话 Agent，不内嵌 LLM，不扫整个工作区当第二个大脑。

## 第一期形态

- **真源**：draw.io XML / 画布（官方 [embed mode](https://www.drawio.com/doc/faq/embed-mode)：`embed=1&proto=json`，`autosave`，`layout`，Mermaid `descriptor`）。
- **编辑器宿主**：本机 `127.0.0.1` HTTP 页里的 iframe。接口是 `EditorHost`；第一期是 `BrowserHost`。以后换成 IDE Webview / MCP Apps 时 **不改 MCP 工具名**。
- **存储**：用户数据目录下的 `current.drawio` + `snapshots/<时间>-<标签>.drawio`。默认 Windows `%APPDATA%\diag-weaver`。进程握手、`tools/list`、空 `diagram_read` **不会 mkdir**，也不会在 Agent cwd 建 `graph-store`。
- **工具面刻意少**：`editor_ensure`、`diagram_replace`、`diagram_read`、`diagram_patch`、`diagram_snapshot`、`diagram_restore`、`diagram_export`。
- **多页图安全**：`diagram_read` 的 summary 按页分组（`summary.pages`，另有跨页平铺的 `cells`）；`diagram_patch` 始终只作用于一个页，多页图必须显式传 `page`（1 起的页号或页名），补丁查找与插入都限定在目标页内，跨页同名 id 不会误伤。
- **结构化补丁**：`diagram_patch` 支持 `add_node` / `add_edge` / `set_label` / `remove_node` / `remove_edge`。删节点会级联删掉挂在其上的边；删元素请用 `remove_*` 而不是整图 `diagram_replace`，以保留用户手工布局。

社区复用：画布用官方 embed.diagrams.net，不自研 mxGraph，不把 lgazo 的 30+ 格子级工具暴露给 Agent。lgazo / 官方 `@drawio/mcp` 负责「遥控格子 / 打开看看」；这里负责同一张图的本地生命周期（可见、可手改、可快照、不污染工作区）。

## 安装与 MCP 配置

用 pnpm（生成物在 `dist/`，不入库）。测 MCP 时走「构建 + 注册到全局 bin」，pnpm 12 已去掉 `pnpm link --global`，用 `pnpm add -g .` 达到同样效果：

```bash
pnpm install
pnpm test
pnpm run link
```

`pnpm run link` = `pnpm build` + `pnpm add -g .`。之后本机任意目录都能调 `diag-weaver`。卸掉：`pnpm run unlink`。若命令找不到，先 `pnpm setup` 并把 `pnpm bin -g` 加进 PATH。

Cursor MCP 配置（全局注册之后）：

```json
{
  "mcpServers": {
    "diag-weaver": {
      "command": "diag-weaver"
    }
  }
}
```

不想装全局时，先 `pnpm build`，再用仓库脚本启动（把路径换成你的绝对路径）：

```json
{
  "mcpServers": {
    "diag-weaver": {
      "command": "pnpm",
      "args": ["--dir", "D:/Projects/diag-weaver", "start"]
    }
  }
}
```

改源码后跑 `pnpm build` 即可，全局 bin 是 link 到本仓库的。改了 `package.json` 的 `bin` 或依赖再 `pnpm run link`。开发时可 `pnpm dev`（tsx 跑源码）。接上浏览器后可用 `node scripts/smoke-embed.mjs` 走一遍 Mermaid → 活画布。环境变量：

| 变量 | 作用 |
|------|------|
| `DIAG_WEAVER_STORE` | 覆盖快照根目录（仍默认不在 cwd） |
| `DIAG_WEAVER_PORT` | 编辑器 HTTP 端口，默认 `47821` |
| `DIAG_WEAVER_NO_BROWSER` | 设为 `1` 时不自动打开浏览器 |

编辑器是懒启动的：进程启动只建立 MCP stdio 通道，不绑端口、不建目录；首次 `editor_ensure` 或 `diagram_replace` 才监听本机 HTTP 页、在 stderr 打印编辑器 URL 并打开浏览器。用户在画布上拖节点后，Agent 再 `diagram_read` 应能看到新位置。

只有 `diagram_export` 在被明确给出路径时才往工作区写文件：默认导出 `.drawio` XML；也支持活画布渲染的 `png` / `svg` 图片（需要画布已连接，`format` 可显式指定，缺省按扩展名 `.png` / `.svg` 推断），方便把架构图直接插进 README / 文档。

## 明确不做

- 编辑器内聊天窗口 / 自配 API Key
- Draft / Stage / Commit、游标、`graph_nudge_*`
- 把 Graph JSON 当真源再 roundtrip
- 第一期绑死某个 IDE 的 Webview

## 许可

MIT。draw.io 编辑器由 iframe 加载官方 embed 服务，不 vendoring 其源码。
