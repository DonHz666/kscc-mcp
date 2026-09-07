# kscc-mcp-server

把 [kscc](https://kscc.com) CLI 封装成 **stdio MCP server**，暴露两个工具，供 MCP 客户端（DSH、Claude Desktop、Cursor 等）把编码任务委派给 kscc。

> 设计文档：`docs/superpowers/specs/2026-09-07-kscc-mcp-server-design.md`

## ⚠️ 安全

`run_kscc_prompt` / `continue_kscc_session` 默认 `permissionMode=bypassPermissions`，即 kscc 不经确认即可执行文件写入 / 命令。**仅在受信任环境与受信任调用方使用。** 收紧方式：
- `permissionMode` 设为 `acceptEdits`（自动接受编辑但不自动跑命令）或 `plan`（只规划）。
- `allowedTools` 限定工具白名单（如 `["Read","Edit","Bash"]`）。
- `maxBudgetUsd` 限制单次花费。

## 工具

### run_kscc_prompt
一次性 headless 执行 kscc 编码任务。

| 参数 | 必填 | 说明 |
|---|---|---|
| prompt | ✅ | 编码任务 |
| cwd | ✅ | 目标项目目录（kscc 的 cwd） |
| model / effort | – | 模型别名或全名 / 努力等级 |
| allowedTools / disallowedTools | – | 工具白/黑名单 |
| appendSystemPrompt | – | 追加系统提示 |
| permissionMode | – | 默认 `bypassPermissions` |
| addDirs | – | 额外可访问目录 |
| outputFormat | – | 默认 `json`，可选 `text` |
| jsonSchema | – | 强制结构化输出 |
| maxBudgetUsd | – | 花费上限 |
| timeoutMs | – | 默认 600000，超时杀子进程 |
| noSessionPersistence | – | 不持久化会话 |
| mcpConfig | – | 透传给 kscc 的 MCP 配置 |

### continue_kscc_session
续接会话做多轮迭代。`sessionId`（`--resume`）优先；未给则用 `cwd`（`--continue`）续接该目录最近会话。`fork=true` 续接时开新 session id。其余参数同上。

### 返回
工具返回一个 text 块，内容为 JSON：
```json
{"session_id":"…","text":"…","tool_uses":[],"cost_usd":0.0,"duration_ms":0,"num_turns":0,"is_error":false}
```
`session_id` 用于后续 `continue_kscc_session`。

## 安装

```bash
git clone <repo> kscc-mcp-server
cd kscc-mcp-server
npm install
npm run build
```

## 给 DSH 接入（stdio）

DSH 的 MCP 配置指向本 server：
```json
{
  "mcpServers": {
    "kscc": {
      "command": "node",
      "args": ["/path/to/kscc-mcp-server/dist/index.js"]
    }
  }
}
```
或免安装：`"command": "npx", "args": ["-y", "kscc-mcp-server"]`（发布后）。

## 给通用 MCP 客户端接入（Claude Desktop / Cursor）

同上 stdio 配置格式。

## 前置要求

- 本机已安装 `kscc` CLI 且在 PATH，并已完成鉴权（`kscc` 交互登录或 `OWTFFSSENT_API_KEY`）。MCP server 进程继承此环境。
- Node ≥18。

## 开发

```bash
npm run dev      # tsx 直跑 src/index.ts
npm test         # vitest
npm run build    # tsc 产 dist/
```

集成测试（`test/index.test.ts`）用伪 kscc 脚本，无需真实鉴权。真实 kscc 联调手动：`node dist/index.js` 后用 MCP 客户端调 `run_kscc_prompt`。

## 演进（v2+，非本次范围）

- 长驻 stream-json 子进程多轮复用（降延迟）。
- 后台 agent 管理（`kscc --bg` / `kscc agents --json`）。
- HTTP 传输（多客户端 / 远程编排）。
