# kscc-mcp-server 设计文档

- 日期：2026-09-07
- 状态：已评审通过，待写实现计划
- 作者：DonHz / kscc

## 1. 目标

把 kscc CLI 的能力封装成一个 MCP（Model Context Protocol）server，暴露成 MCP 工具，
供 MCP 客户端驱动 kscc 作为编码子 agent。

主场景：DSH（本地主控 agent）遇到写代码 / 改代码的任务时，通过 MCP 把任务委派给 kscc，
拿结果回来。kscc 在后台作为被驱动的编码后端。

## 2. 范围

- v1 工具面：一次性 headless 执行 + 会话续接（多轮迭代）。不含后台 agent 管理。
- 传输：stdio。
- 实现语言：TypeScript（Node ≥18，ESM）。
- 驱动方式：薄封装 —— 每次工具调用 spawn 一个 `kscc -p` 子进程，收 stdout 解析返回。
  忠实暴露真实 CLI，自动继承 skills、AGENTS.md、MCP 配置、hooks、模型路由、权限系统，
  零重写，永远跟 CLI 行为一致。

## 3. 非目标（v1）

- 不用 Kscc Agent SDK 在进程内跑 agent loop（会偏离合「暴露 CLI」的目标）。
- 不做长驻 stream-json 子进程多轮复用（留作演进）。
- 不暴露后台 agent 管理（`kscc --bg` / `kscc agents`）—— 留作演进。
- 不把本 server 接回 kscc 自身消费（会递归：kscc → server → spawn kscc）。
  消费方是 DSH / 外部 orchestrator，不是 kscc。

## 4. 架构

```
DSH ─stdio JSON-RPC─▶ MCP server (Node) ─spawn─▶ kscc -p … --output-format json
                                                  │
              ┌──────── 返回 JSON ◀── 解析 stdout ┘
              ▼
            DSH 拿到结果（含 session_id 供续接）
```

数据流：MCP 客户端经 stdio 发 JSON-RPC 请求 → MCP server 解析参数 → spawn
`kscc -p <prompt> --output-format json [flags]`（cwd = 调用方指定目录）→ 收集 stdout
→ 解析为结构化结果 → 作为 MCP 工具返回文本块返回。

### 4.1 目录结构

```
kscc-mcp-server/
  package.json            # bin: "kscc-mcp-server"；type: module
  tsconfig.json
  src/
    index.ts              # stdio server 入口，注册 2 个工具
    tools/run.ts          # run_kscc_prompt 工具定义与处理
    tools/continue.ts     # continue_kscc_session 工具定义与处理
    kscc/invoke.ts        # spawn kscc + 收集输出 + 超时 kill
    kscc/parse.ts         # 解析 --output-format json 结果
    kscc/flags.ts         # 参数对象 → kscc argv 映射
    config.ts             # 默认值（permissionMode/timeout/outputFormat）
  test/
    flags.test.ts         # 参数 → argv 映射
    parse.test.ts         # 用样例 json fixture 解析
    invoke.integration.test.ts  # 起真实 kscc -p（需鉴权，opt-in）
    fixtures/             # kscc json 输出样例
  README.md
```

### 4.2 依赖

- `@modelcontextprotocol/sdk` —— MCP server SDK
- `zod` —— 工具输入校验
- `tsx`（dev）—— 直接跑 TS
- `vitest`（dev）—— 测试

无运行时除 SDK + zod 外依赖。通过 `npx -y kscc-mcp-server` 或 `node dist/index.js` 启动。

## 5. 工具定义

### 5.1 `run_kscc_prompt` —— 一次性 headless 执行

| 参数 | 映射 kscc flag | 必填 | 说明 |
|---|---|---|---|
| `prompt` | 位置参数 | ✅ | 要执行的任务 |
| `cwd` | spawn cwd | ✅ | 目标项目目录（作用域 + AGENTS.md 上下文） |
| `model` | `--model <m>` | – | fb/op/sn 别名或全名 |
| `effort` | `--effort <level>` | – | |
| `allowedTools` | `--allowedTools <…>` | – | 限定工具，收紧权限 |
| `disallowedTools` | `--disallowedTools <…>` | – | |
| `appendSystemPrompt` | `--append-system-prompt <s>` | – | 追加系统提示 |
| `permissionMode` | `--permission-mode <m>` | 默认 `bypassPermissions` | 非交互，避免卡住 |
| `addDirs` | `--add-dir <…>` | – | 额外可访问目录 |
| `outputFormat` | `--output-format <f>` | 默认 `json` | `text`/`json` |
| `jsonSchema` | `--json-schema <schema>` | – | 强制结构化输出 |
| `maxBudgetUsd` | `--max-budget-usd <n>` | – | 花费上限 |
| `timeoutMs` | 服务端 kill | 默认 600000 | 非 kscc flag，超时杀子进程 |
| `noSessionPersistence` | `--no-session-persistence` | – | 默认 false，便于续接 |
| `mcpConfig` | `--mcp-config <c>` | – | 透传，让 kscc 自带 MCP |

### 5.2 `continue_kscc_session` —— 续接会话多轮迭代

| 参数 | 映射 | 说明 |
|---|---|---|
| `prompt` | 位置参数 | ✅ 追问内容 |
| `sessionId` | `--resume <id>` | 与 cwd 二选一 |
| `cwd` | `--continue`（spawn cwd） | 与 sessionId 二选一，续该目录最近会话 |
| `fork` | `--fork-session` | 续接时开新 session id，不改原会话 |
| 其余执行参数 | 同 5.1 | model/effort/allowedTools/permissionMode/timeoutMs… |

校验：`sessionId` 与 `cwd` 至少给一个；都给时以 `sessionId` 为准。

### 5.3 返回结构（两工具统一）

MCP 工具返回一个 text content 块，内容为 JSON 字符串：

```json
{
  "session_id": "string | null",
  "text": "string",
  "tool_uses": ["…"],
  "cost_usd": 0.0,
  "duration_ms": 0,
  "num_turns": 0,
  "is_error": false
}
```

`session_id` 用于 DSH 做后续 `continue_kscc_session`。失败时 `is_error: true`，`text`
含错误信息。

## 6. 安全与默认值

- `cwd` 必填，把 agent 圈在一个目录。
- `permissionMode` 默认 `bypassPermissions`（非交互、不卡）。
  **README 显著提示风险**；调用方可改 `acceptEdits` / `plan` 收紧。
- 推荐双重约束：`allowedTools`（如只给 `Read`/`Edit`/`Bash`）+ `maxBudgetUsd`。
- `timeoutMs` 服务端兜底杀进程。
- 凭证：kscc 子进程继承 server 进程环境（`OWTFFSSENT_API_KEY` 或 OAuth/keychain）。
  本地 stdio 场景没问题；README 说明 server 须在 kscc 已鉴权的环境运行。

## 7. 输出解析与错误处理

- 解析 `--output-format json` 单条结果（含 `result`(文本)/`session_id`/`total_cost_usd`
  /`duration_ms`/`num_turns`/`is_error`）→ 映射到返回 JSON。
- kscc 退出码非 0 → `isError:true` + stderr / 退出码。
- `is_error:true` → 透传为错误结果。
- 超时 → kill 子进程，返回超时错误。
- spawn 失败（`kscc` 不在 PATH）→ 清晰报错 + 安装提示。

## 8. 打包与接入

- npm 包 `kscc-mcp-server`，bin 同名；`npm run build` → `node dist/index.js`。
- **给 DSH 接入**：DSH 的 MCP 配置（stdio）指向 `npx -y kscc-mcp-server` 或本地
  `node dist/index.js`。
- **不推荐**把它接回 kscc 自己（`kscc mcp add … kscc-mcp-server`）—— 递归。
  消费方是 DSH / 外部 orchestrator，不是 kscc 自身。
- README 给 DSH 与通用 MCP 客户端两套配置示例。

## 9. 测试

- 单测：参数 → argv 映射、json 解析（fixture）、zod 输入校验。
- 集成（opt-in，需 kscc 鉴权）：在临时目录起真实
  `kscc -p "echo hi" --output-format json`，断言解析文本；无鉴权环境用 env flag 跳过。

## 10. 演进路径（v2+，非本次范围）

- 长驻 stream-json 子进程多轮复用（降延迟）。
- 后台 agent 管理（`kscc --bg` / `kscc agents --json`）。
- HTTP 传输（多客户端 / 远程编排）。
