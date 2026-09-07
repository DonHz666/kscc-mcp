# kscc-mcp-server Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把 kscc CLI 封装成 stdio MCP server，暴露 `run_kscc_prompt` / `continue_kscc_session` 两个工具，供 DSH 等本地 agent 委派编码任务。

**Architecture:** TypeScript stdio MCP server。每个工具调用 spawn 一个 `kscc -p <prompt> --output-format json [flags]` 子进程（cwd=调用方指定目录），收集 stdout，解析为结构化 JSON 返回。忠实暴露真实 CLI，自动继承 skills/AGENTS.md/MCP/权限/模型路由。会话续接用 `--resume <id>` / `--continue`。

**Tech Stack:** TypeScript 5.x（ESM）、Node ≥18、`@modelcontextprotocol/sdk` ^1.30.0、`zod` ^3、`tsx`（dev 运行）、`vitest`（dev 测试）。

**Spec:** `docs/superpowers/specs/2026-09-07-kscc-mcp-server-design.md`

## Global Constraints

- 包名 `kscc-mcp-server`，`package.json` 设 `"type": "module"`，bin 名 `kscc-mcp-server`。
- 运行时仅依赖 `@modelcontextprotocol/sdk` 与 `zod`；其余为 devDependencies。
- MCP server 注册用高层 `McpServer`：`import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js"`、`import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js"`。
- 工具回调返回 `{ content: [{ type: "text", text: <JSON 字符串> }] }`。
- kscc headless 调用：`kscc -p <prompt> --output-format json --permission-mode bypassPermissions [flags]`，cwd=指定目录。
- kscc json 输出顶层字段（实测）：`result`(文本)、`session_id`、`total_cost_usd`、`duration_ms`、`num_turns`、`is_error`、`subtype`、`stop_reason`、`modelUsage`、`usage`。
- 返回给调用方的 JSON 字段：`session_id`、`text`、`tool_uses`、`cost_usd`、`duration_ms`、`num_turns`、`is_error`。
- 默认值：`permissionMode`=`bypassPermissions`、`outputFormat`=`json`、`timeoutMs`=`600000`。
- 本机用 `python` 非 `python3`（与项目无关，仅背景）。所有 npm/node 脚本走 Node ≥18。
- 每个任务结束 commit；commit message 用 conventional commits；末尾附 `Co-Authored-By: Kscc <noreply@owtffssent.com>`。

---

## File Structure

```
kscc-mcp-server/
  package.json
  tsconfig.json
  vitest.config.ts
  src/
    config.ts              # 默认值常量 + DEFAULTS
    kscc/flags.ts          # RunArgs/ContinueArgs 对象 → kscc argv 数组
    kscc/parse.ts          # 解析 kscc --output-format json stdout → RunResult
    kscc/invoke.ts         # spawn kscc + 收集 stdout/stderr + 超时 kill
    tools/run.ts           # run_kscc_prompt 的 zod schema + handler
    tools/continue.ts      # continue_kscc_session 的 zod schema + handler
    index.ts               # 入口：建 McpServer、注册两工具、接 StdioServerTransport
  test/
    flags.test.ts
    parse.test.ts
    invoke.test.ts         # spawn mock（伪 kscc 脚本）
    run.test.ts
    continue.test.ts
    index.test.ts          # 集成：用伪 kscc 走通 stdio（opt-in）
    fixtures/result.json
    fixtures/error-result.json
  README.md
```

---

### Task 1: 项目脚手架与构建配置

**Files:**
- Create: `package.json`
- Create: `tsconfig.json`
- Create: `vitest.config.ts`
- Create: `.gitignore`
- Create: `README.md`（最小占位，Task 9 完善）

**Interfaces:**
- Produces: 可 `npm run build` 产出 `dist/`、`npm test` 跑 vitest、`npm start` 跑 `dist/index.js`、`npm run dev` 用 tsx 直跑 `src/index.ts`。

- [ ] **Step 1: 写 `package.json`**

```json
{
  "name": "kscc-mcp-server",
  "version": "0.1.0",
  "type": "module",
  "description": "MCP server wrapping the kscc CLI for code task delegation",
  "bin": {
    "kscc-mcp-server": "dist/index.js"
  },
  "main": "dist/index.js",
  "scripts": {
    "build": "tsc",
    "start": "node dist/index.js",
    "dev": "tsx src/index.ts",
    "test": "vitest run",
    "test:watch": "vitest"
  },
  "dependencies": {
    "@modelcontextprotocol/sdk": "^1.30.0",
    "zod": "^3.23.8"
  },
  "devDependencies": {
    "tsx": "^4.19.0",
    "typescript": "^5.6.0",
    "vitest": "^2.1.0",
    "@types/node": "^20.11.0"
  },
  "engines": {
    "node": ">=18"
  }
}
```

- [ ] **Step 2: 写 `tsconfig.json`**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "lib": ["ES2022"],
    "outDir": "dist",
    "rootDir": "src",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "resolveJsonModule": true,
    "declaration": true,
    "sourceMap": true
  },
  "include": ["src"],
  "exclude": ["node_modules", "dist", "test"]
}
```

- [ ] **Step 3: 写 `vitest.config.ts`**

```ts
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["test/**/*.test.ts"],
    testTimeout: 30000,
  },
});
```

- [ ] **Step 4: 写 `.gitignore`**

```
node_modules/
dist/
*.log
```

- [ ] **Step 5: 写最小 `README.md`**

```markdown
# kscc-mcp-server

MCP server wrapping the kscc CLI for code task delegation. See `docs/superpowers/specs/2026-09-07-kscc-mcp-server-design.md`.

(WIP — full docs in Task 9.)
```

- [ ] **Step 6: 安装依赖并验证构建空跑**

Run:
```bash
npm install
npx tsc --noEmit
```
Expected: `tsc --noEmit` 通过（无源文件也不报错），`node_modules` 生成。

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "chore: 项目脚手架与构建配置

Co-Authored-By: Kscc <noreply@owtffssent.com>"
```

---

### Task 2: 默认值配置 `src/config.ts`

**Files:**
- Create: `src/config.ts`
- Create: `test/config.test.ts`

**Interfaces:**
- Produces: `DEFAULTS` 常量，类型 `Defaults`，字段 `permissionMode: "bypassPermissions"`、`outputFormat: "json"`、`timeoutMs: 600000`。后续任务 `import { DEFAULTS } from "../config.js"`。

- [ ] **Step 1: 写失败测试 `test/config.test.ts`**

```ts
import { describe, it, expect } from "vitest";
import { DEFAULTS } from "../src/config.js";

describe("DEFAULTS", () => {
  it("默认 permissionMode 为 bypassPermissions", () => {
    expect(DEFAULTS.permissionMode).toBe("bypassPermissions");
  });
  it("默认 outputFormat 为 json", () => {
    expect(DEFAULTS.outputFormat).toBe("json");
  });
  it("默认 timeoutMs 为 600000", () => {
    expect(DEFAULTS.timeoutMs).toBe(600000);
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npx vitest run test/config.test.ts`
Expected: FAIL，`Cannot find module '../src/config.js'`。

- [ ] **Step 3: 写实现 `src/config.ts`**

```ts
export type PermissionMode =
  | "acceptEdits"
  | "auto"
  | "bypassPermissions"
  | "manual"
  | "dontAsk"
  | "plan";

export type OutputFormat = "text" | "json";

export interface Defaults {
  permissionMode: PermissionMode;
  outputFormat: OutputFormat;
  timeoutMs: number;
}

export const DEFAULTS: Defaults = {
  permissionMode: "bypassPermissions",
  outputFormat: "json",
  timeoutMs: 600000,
};
```

- [ ] **Step 4: 跑测试确认通过**

Run: `npx vitest run test/config.test.ts`
Expected: PASS（3/3）。

- [ ] **Step 5: Commit**

```bash
git add src/config.ts test/config.test.ts
git commit -m "feat(config): 默认值常量 DEFAULTS

Co-Authored-By: Kscc <noreply@owtffssent.com>"
```

---

### Task 3: 参数→argv 映射 `src/kscc/flags.ts`

**Files:**
- Create: `src/kscc/flags.ts`
- Create: `test/flags.test.ts`

**Interfaces:**
- Consumes: `DEFAULTS`（Task 2）、`PermissionMode`/`OutputFormat`（Task 2）。
- Produces: `buildRunArgs(input: RunArgs): string[]` 与 `buildContinueArgs(input: ContinueArgs): string[]`。
  - `RunArgs` 字段（全可选除 `prompt`）：`prompt:string`、`model?`、`effort?`、`allowedTools?:string[]`、`disallowedTools?:string[]`、`appendSystemPrompt?`、`permissionMode?:PermissionMode`、`addDirs?:string[]`、`outputFormat?:OutputFormat`、`jsonSchema?:string`、`maxBudgetUsd?:number`、`noSessionPersistence?:boolean`、`mcpConfig?:string`。
  - `ContinueArgs = RunArgs & { sessionId?:string; cwd?:string; fork?:boolean }`（`prompt` 必填）。
  - 返回 argv 数组（不含 `kscc` 本身、不含 `cwd`，cwd 由 spawn 设）。

映射规则（实测自 `kscc --help`）：
- `prompt` → 数组首项（位置参数）。
- `model` → `["--model", v]`。
- `effort` → `["--effort", v]`。
- `allowedTools` → `["--allowedTools", ...v]`（多值，flag 后跟多个值；若空数组则不输出该 flag）。
- `disallowedTools` → `["--disallowedTools", ...v]`。
- `appendSystemPrompt` → `["--append-system-prompt", v]`。
- `permissionMode` → `["--permission-mode", v]`，缺省取 `DEFAULTS.permissionMode`。
- `addDirs` → `["--add-dir", ...v]`。
- `outputFormat` → `["--output-format", v]`，缺省取 `DEFAULTS.outputFormat`。
- `jsonSchema` → `["--json-schema", v]`。
- `maxBudgetUsd` → `["--max-budget-usd", String(v)]`。
- `noSessionPersistence` 为 true → 追加 `["--no-session-persistence"]`。
- `mcpConfig` → `["--mcp-config", v]`。
- 固定追加 `["--print"]`（即 `-p`）在末尾前；实际末尾为位置参数 `prompt`，所以 `--print` 放在 prompt 之前。最终 argv 形如：`["--print", "<prompt>", "--output-format", "json", "--permission-mode", "bypassPermissions", ...]`。
  注：`-p`/`--print` 与位置参数 prompt 同存。kscc 接受 `kscc --print <prompt>`。

Continue 额外规则：
- `sessionId` 存在 → 追加 `["--resume", v]`。
- 否则若 `cwd` 存在 → 追加 `["--continue"]`。
- 两者都无 → 由调用方校验保证不发生（flags 不抛错，照常生成）。
- `fork` 为 true → 追加 `["--fork-session"]`。

- [ ] **Step 1: 写失败测试 `test/flags.test.ts`**

```ts
import { describe, it, expect } from "vitest";
import { buildRunArgs, buildContinueArgs } from "../src/kscc/flags.js";

describe("buildRunArgs", () => {
  it("最小 prompt 加上默认 flag", () => {
    expect(buildRunArgs({ prompt: "do something" })).toEqual([
      "--print", "do something",
      "--output-format", "json",
      "--permission-mode", "bypassPermissions",
    ]);
  });

  it("显式覆盖 outputFormat 与 permissionMode", () => {
    expect(buildRunArgs({ prompt: "hi", outputFormat: "text", permissionMode: "acceptEdits" }))
      .toEqual(["--print", "hi", "--output-format", "text", "--permission-mode", "acceptEdits"]);
  });

  it("数组与可选参数展开", () => {
    expect(buildRunArgs({
      prompt: "p",
      model: "op",
      effort: "high",
      allowedTools: ["Read", "Edit"],
      disallowedTools: ["Bash"],
      appendSystemPrompt: "extra",
      addDirs: ["../a", "../b"],
      maxBudgetUsd: 1.5,
      noSessionPersistence: true,
      mcpConfig: '{"x":1}',
    })).toEqual([
      "--print", "p",
      "--model", "op",
      "--effort", "high",
      "--allowedTools", "Read", "Edit",
      "--disallowedTools", "Bash",
      "--append-system-prompt", "extra",
      "--add-dir", "../a", "../b",
      "--output-format", "json",
      "--permission-mode", "bypassPermissions",
      "--max-budget-usd", "1.5",
      "--no-session-persistence",
      "--mcp-config", '{"x":1}',
    ]);
  });

  it("空数组 allowedTools 不输出 flag", () => {
    expect(buildRunArgs({ prompt: "p", allowedTools: [] }))
      .toEqual(["--print", "p", "--output-format", "json", "--permission-mode", "bypassPermissions"]);
  });

  it("jsonSchema 透传", () => {
    expect(buildRunArgs({ prompt: "p", jsonSchema: '{"type":"object"}' }))
      .toEqual(["--print", "p", "--output-format", "json", "--permission-mode", "bypassPermissions", "--json-schema", '{"type":"object"}']);
  });
});

describe("buildContinueArgs", () => {
  it("sessionId 走 --resume", () => {
    expect(buildContinueArgs({ prompt: "more", sessionId: "abc-123" }))
      .toEqual([
        "--print", "more",
        "--output-format", "json",
        "--permission-mode", "bypassPermissions",
        "--resume", "abc-123",
      ]);
  });

  it("仅 cwd 走 --continue", () => {
    expect(buildContinueArgs({ prompt: "more", cwd: "/tmp/x" }))
      .toEqual([
        "--print", "more",
        "--output-format", "json",
        "--permission-mode", "bypassPermissions",
        "--continue",
      ]);
  });

  it("fork 追加 --fork-session", () => {
    expect(buildContinueArgs({ prompt: "more", sessionId: "s1", fork: true }))
      .toEqual([
        "--print", "more",
        "--output-format", "json",
        "--permission-mode", "bypassPermissions",
        "--resume", "s1",
        "--fork-session",
      ]);
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npx vitest run test/flags.test.ts`
Expected: FAIL，模块找不到。

- [ ] **Step 3: 写实现 `src/kscc/flags.ts`**

```ts
import { DEFAULTS, type PermissionMode, type OutputFormat } from "../config.js";

export interface RunArgs {
  prompt: string;
  model?: string;
  effort?: string;
  allowedTools?: string[];
  disallowedTools?: string[];
  appendSystemPrompt?: string;
  permissionMode?: PermissionMode;
  addDirs?: string[];
  outputFormat?: OutputFormat;
  jsonSchema?: string;
  maxBudgetUsd?: number;
  noSessionPersistence?: boolean;
  mcpConfig?: string;
}

export interface ContinueArgs extends RunArgs {
  sessionId?: string;
  cwd?: string;
  fork?: boolean;
}

function pushOpt(out: string[], flag: string, value: string | undefined): void {
  if (value !== undefined && value !== "") out.push(flag, value);
}

function pushArr(out: string[], flag: string, values: string[] | undefined): void {
  if (values && values.length > 0) out.push(flag, ...values);
}

function buildCommon(a: RunArgs): string[] {
  const out: string[] = ["--print", a.prompt];
  pushOpt(out, "--model", a.model);
  pushOpt(out, "--effort", a.effort);
  pushArr(out, "--allowedTools", a.allowedTools);
  pushArr(out, "--disallowedTools", a.disallowedTools);
  pushOpt(out, "--append-system-prompt", a.appendSystemPrompt);
  pushArr(out, "--add-dir", a.addDirs);
  out.push("--output-format", a.outputFormat ?? DEFAULTS.outputFormat);
  out.push("--permission-mode", a.permissionMode ?? DEFAULTS.permissionMode);
  if (a.maxBudgetUsd !== undefined) out.push("--max-budget-usd", String(a.maxBudgetUsd));
  if (a.noSessionPersistence) out.push("--no-session-persistence");
  pushOpt(out, "--json-schema", a.jsonSchema);
  pushOpt(out, "--mcp-config", a.mcpConfig);
  return out;
}

export function buildRunArgs(a: RunArgs): string[] {
  return buildCommon(a);
}

export function buildContinueArgs(a: ContinueArgs): string[] {
  const out = buildCommon(a);
  if (a.sessionId) {
    out.push("--resume", a.sessionId);
  } else if (a.cwd) {
    out.push("--continue");
  }
  if (a.fork) out.push("--fork-session");
  return out;
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `npx vitest run test/flags.test.ts`
Expected: PASS（全部）。

- [ ] **Step 5: Commit**

```bash
git add src/kscc/flags.ts test/flags.test.ts
git commit -m "feat(flags): RunArgs/ContinueArgs 到 kscc argv 映射

Co-Authored-By: Kscc <noreply@owtffssent.com>"
```

---

### Task 4: kscc 输出解析 `src/kscc/parse.ts`

**Files:**
- Create: `src/kscc/parse.ts`
- Create: `test/fixtures/result.json`
- Create: `test/fixtures/error-result.json`
- Create: `test/parse.test.ts`

**Interfaces:**
- Consumes: 无。
- Produces: `parseKsccResult(stdout: string): RunResult` 与类型 `RunResult`。
  - `RunResult = { session_id: string|null; text: string; tool_uses: string[]; cost_usd: number|null; duration_ms: number|null; num_turns: number|null; is_error: boolean }`。
  - 解析失败（非 JSON 或缺字段）抛 `Error`，含原始片段。

实测 kscc `--output-format json` 输出为单行 JSON（实测样例已用于 fixture）。`result` 是文本；`tool_uses` 在 json 输出里没有顶层字段，置 `[]`（v1 不抽取工具调用明细）。

- [ ] **Step 1: 写 fixture `test/fixtures/result.json`**（实测真实结构）

```json
{"type":"result","subtype":"success","is_error":false,"api_error_status":null,"duration_ms":8882,"duration_api_ms":4764,"num_turns":1,"result":"pong","stop_reason":"end_turn","session_id":"0d215be8-2c0e-412d-a8f1-20ae961d0d28","total_cost_usd":0.14218,"usage":{"input_tokens":28261,"output_tokens":35},"modelUsage":{"mimo-v2.5-pro":{"inputTokens":28261,"outputTokens":35,"costUSD":0.14218}},"permission_denials":[]}
```

- [ ] **Step 2: 写 fixture `test/fixtures/error-result.json`**

```json
{"type":"result","subtype":"success","is_error":true,"api_error_status":"rate_limit","duration_ms":120,"num_turns":0,"result":"Error: rate limited","session_id":null,"total_cost_usd":0,"usage":null,"modelUsage":{},"permission_denials":[]}
```

- [ ] **Step 3: 写失败测试 `test/parse.test.ts`**

```ts
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { parseKsccResult } from "../src/kscc/parse.js";

const here = dirname(fileURLToPath(import.meta.url));
const ok = readFileSync(join(here, "fixtures/result.json"), "utf8").trim();
const err = readFileSync(join(here, "fixtures/error-result.json"), "utf8").trim();

describe("parseKsccResult", () => {
  it("解析成功结果", () => {
    const r = parseKsccResult(ok);
    expect(r.is_error).toBe(false);
    expect(r.text).toBe("pong");
    expect(r.session_id).toBe("0d215be8-2c0e-412d-a8f1-20ae961d0d28");
    expect(r.cost_usd).toBe(0.14218);
    expect(r.duration_ms).toBe(8882);
    expect(r.num_turns).toBe(1);
    expect(r.tool_uses).toEqual([]);
  });

  it("解析错误结果", () => {
    const r = parseKsccResult(err);
    expect(r.is_error).toBe(true);
    expect(r.text).toBe("Error: rate limited");
    expect(r.session_id).toBe(null);
    expect(r.cost_usd).toBe(0);
    expect(r.tool_uses).toEqual([]);
  });

  it("非 JSON 抛错", () => {
    expect(() => parseKsccResult("not json at all")).toThrow();
  });
});
```

- [ ] **Step 4: 跑测试确认失败**

Run: `npx vitest run test/parse.test.ts`
Expected: FAIL，模块找不到。

- [ ] **Step 5: 写实现 `src/kscc/parse.ts`**

```ts
export interface RunResult {
  session_id: string | null;
  text: string;
  tool_uses: string[];
  cost_usd: number | null;
  duration_ms: number | null;
  num_turns: number | null;
  is_error: boolean;
}

interface KsccJson {
  result?: string;
  session_id?: string | null;
  total_cost_usd?: number;
  duration_ms?: number;
  num_turns?: number;
  is_error?: boolean;
}

export function parseKsccResult(stdout: string): RunResult {
  let parsed: KsccJson;
  try {
    parsed = JSON.parse(stdout);
  } catch {
    throw new Error(`kscc 输出非 JSON: ${stdout.slice(0, 200)}`);
  }
  return {
    session_id: parsed.session_id ?? null,
    text: parsed.result ?? "",
    tool_uses: [],
    cost_usd: parsed.total_cost_usd ?? null,
    duration_ms: parsed.duration_ms ?? null,
    num_turns: parsed.num_turns ?? null,
    is_error: parsed.is_error ?? false,
  };
}
```

- [ ] **Step 6: 跑测试确认通过**

Run: `npx vitest run test/parse.test.ts`
Expected: PASS（3/3）。

- [ ] **Step 7: Commit**

```bash
git add src/kscc/parse.ts test/parse.test.ts test/fixtures/
git commit -m "feat(parse): 解析 kscc --output-format json 结果

Co-Authored-By: Kscc <noreply@owtffssent.com>"
```

---

### Task 5: spawn kscc 子进程 `src/kscc/invoke.ts`

**Files:**
- Create: `src/kscc/invoke.ts`
- Create: `test/invoke.test.ts`
- Create: `test/fixtures/fake-kscc.js`（伪 kscc 脚本，用于测试）

**Interfaces:**
- Consumes: `DEFAULTS.timeoutMs`（Task 2）。
- Produces: `invokeKscc(opts: InvokeOptions): Promise<InvokeOutput>`。
  - `InvokeOptions = { argv: string[]; cwd: string; timeoutMs?: number; env?: NodeJS.ProcessEnv; ksccBin?: string }`。
  - `InvokeOutput = { stdout: string; stderr: string; exitCode: number | null; timedOut: boolean }`。
  - 行为：spawn `<ksccBin> ...argv`，cwd=`cwd`，收集 stdout/stderr（buffer，utf8），超时 kill 并置 `timedOut:true`；默认 `ksccBin="kscc"`。

- [ ] **Step 1: 写伪 kscc 脚本 `test/fixtures/fake-kscc.js`**

```js
// 伪 kscc：把 stdin 当 prompt 不关心，按环境变量 FAKE_MODE 行为。
// mode=ok → 输出一条 kscc 风格 json；mode=err → 退出码 1 + stderr；mode=slow → 慢响应触发超时。
const mode = process.env.FAKE_MODE ?? "ok";
if (mode === "err") {
  process.stderr.write("kscc: command not found in this mock\n");
  process.exit(1);
}
if (mode === "slow") {
  setTimeout(() => {
    process.stdout.write('{"type":"result","result":"late","is_error":false,"session_id":null,"total_cost_usd":0,"duration_ms":0,"num_turns":1}');
    process.exit(0);
  }, 5000);
  process.exit;
} else {
  process.stdout.write('{"type":"result","result":"pong","is_error":false,"session_id":"s-1","total_cost_usd":0.1,"duration_ms":10,"num_turns":1}');
  process.exit(0);
}
```

注：`slow` 分支用 `setTimeout` 后显式不立即退出，让调用方有时间超时 kill。

- [ ] **Step 2: 写失败测试 `test/invoke.test.ts`**

```ts
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { invokeKscc } from "../src/kscc/invoke.js";

const here = dirname(fileURLToPath(import.meta.url));
const fakeKscc = process.platform === "win32"
  ? join(here, "fixtures", "fake-kscc.js")
  : join(here, "fixtures", "fake-kscc.js");
const run = (env: NodeJS.ProcessEnv) =>
  invokeKscc({
    argv: [],
    cwd: here,
    timeoutMs: 10000,
    ksccBin: process.execPath, // node
    env: { ...process.env, FAKE_MODE: env.FAKE_MODE },
  }).then((o) => {
    // 用 node 跑伪脚本：把 bin 换成 node，argv 前面加脚本路径
    return o;
  });

// 由于 ksccBin=node 需要把脚本路径塞进 argv，封装一个专门 helper：
async function runFake(mode: string, extra: string[] = []) {
  return invokeKscc({
    argv: [fakeKscc, ...extra],
    cwd: here,
    timeoutMs: mode === "slow" ? 300 : 10000,
    ksccBin: process.execPath,
    env: { ...process.env, FAKE_MODE: mode },
  });
}

describe("invokeKscc", () => {
  it("成功收集 stdout", async () => {
    const out = await runFake("ok");
    expect(out.exitCode).toBe(0);
    expect(out.timedOut).toBe(false);
    expect(out.stdout).toContain('"result":"pong"');
  });

  it("非零退出码收集 stderr", async () => {
    const out = await runFake("err");
    expect(out.exitCode).toBe(1);
    expect(out.timedOut).toBe(false);
    expect(out.stderr).toContain("command not found");
  });

  it("超时 kill 并置 timedOut", async () => {
    const out = await runFake("slow");
    expect(out.timedOut).toBe(true);
    expect(out.exitCode).toBe(null);
  });
});
```

- [ ] **Step 3: 跑测试确认失败**

Run: `npx vitest run test/invoke.test.ts`
Expected: FAIL，模块找不到。

- [ ] **Step 4: 写实现 `src/kscc/invoke.ts`**

```ts
import { spawn } from "node:child_process";
import { DEFAULTS } from "../config.js";

export interface InvokeOptions {
  argv: string[];
  cwd: string;
  timeoutMs?: number;
  env?: NodeJS.ProcessEnv;
  ksccBin?: string;
}

export interface InvokeOutput {
  stdout: string;
  stderr: string;
  exitCode: number | null;
  timedOut: boolean;
}

export function invokeKscc(opts: InvokeOptions): Promise<InvokeOutput> {
  const bin = opts.ksccBin ?? "kscc";
  const timeoutMs = opts.timeoutMs ?? DEFAULTS.timeoutMs;
  return new Promise((resolve) => {
    const child = spawn(bin, opts.argv, {
      cwd: opts.cwd,
      env: opts.env ?? process.env,
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
    });
    let stdout = "";
    let stderr = "";
    let timedOut = false;
    let timer: NodeJS.Timeout | undefined = setTimeout(() => {
      timedOut = true;
      child.kill("SIGKILL");
    }, timeoutMs);

    child.stdout?.setEncoding("utf8");
    child.stderr?.setEncoding("utf8");
    child.stdout?.on("data", (d: string) => { stdout += d; });
    child.stderr?.on("data", (d: string) => { stderr += d; });

    child.on("error", (err) => {
      if (timer) clearTimeout(timer);
      resolve({
        stdout,
        stderr: stderr + `\nspawn error: ${err.message}`,
        exitCode: null,
        timedOut: false,
      });
    });
    child.on("close", (code) => {
      if (timer) clearTimeout(timer);
      resolve({ stdout, stderr, exitCode: code, timedOut });
    });
  });
}
```

- [ ] **Step 5: 跑测试确认通过**

Run: `npx vitest run test/invoke.test.ts`
Expected: PASS（3/3）。注：Windows 下 `process.execPath` 是 node.exe，spawn node + 脚本路径可行。

- [ ] **Step 6: Commit**

```bash
git add src/kscc/invoke.ts test/invoke.test.ts test/fixtures/fake-kscc.js
git commit -m "feat(invoke): spawn kscc 子进程与超时 kill

Co-Authored-By: Kscc <noreply@owtffssent.com>"
```

---

### Task 6: `run_kscc_prompt` 工具 `src/tools/run.ts`

**Files:**
- Create: `src/tools/run.ts`
- Create: `test/run.test.ts`

**Interfaces:**
- Consumes: `buildRunArgs`（Task 3）、`invokeKscc`（Task 5）、`parseKsccResult`（Task 4）、`DEFAULTS`（Task 2）。
- Produces:
  - `runSchema`：zod object（MCP 工具参数 schema，`zodToMcp` 用其 raw shape）。
  - `handleRun(args: RunToolArgs): Promise<ToolResult>`：组装 argv → invokeKscc → parseKsccResult → 返回 `{ content:[{type:"text", text: JSON}] , isError?: boolean }`。
  - `RunToolArgs` = RunArgs 的 zod 推导类型 + `cwd:string` + `timeoutMs?:number`。
  - `ToolResult = { content: { type: "text"; text: string }[]; isError?: boolean }`。

`runSchema` 字段（zod）：`prompt`(string)、`cwd`(string)、`model?`(string)、`effort?`(string)、`allowedTools?`(array string)、`disallowedTools?`(array string)、`appendSystemPrompt?`(string)、`permissionMode?`(enum)、`addDirs?`(array string)、`outputFormat?`(enum)、`jsonSchema?`(string)、`maxBudgetUsd?`(number)、`timeoutMs?`(number)、`noSessionPersistence?`(boolean)、`mcpConfig?`(string)。

handleRun 逻辑：
1. `const argv = buildRunArgs({ ...args })`（注意 `timeoutMs` 不入 argv，单独传 invokeKscc）。
2. `const out = await invokeKscc({ argv, cwd: args.cwd, timeoutMs: args.timeoutMs ?? DEFAULTS.timeoutMs })`。
3. 若 `out.timedOut` → 返回 isError，text JSON `{ is_error:true, text:"kscc 超时（<ms> ms）", session_id:null,... }`。
4. 若 `out.exitCode !== 0` → 返回 isError，text JSON `{ is_error:true, text:"kscc 退出码 <code>: <stderr>", session_id:null, tool_uses:[], cost_usd:null, duration_ms:null, num_turns:null }`。
5. 否则 `parseKsccResult(out.stdout)` → 返回 text JSON（`JSON.stringify(runResult)`），`isError` = `runResult.is_error`。
6. 任何 throw（含 parse 失败）→ isError，text JSON `{ is_error:true, text:"<err.message>", ...nulls }`。

- [ ] **Step 1: 写失败测试 `test/run.test.ts`**

```ts
import { describe, it, expect } from "vitest";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { handleRun, runSchema } from "../src/tools/run.js";

const here = dirname(fileURLToPath(import.meta.url));
const fakeKscc = join(here, "fixtures", "fake-kscc.js");

async function runFake(mode: string, prompt = "hi") {
  return handleRun({
    prompt,
    cwd: here,
    timeoutMs: 10000,
    _ksccBin: process.execPath,
    _prependArgv: [fakeKscc],
    _env: { ...process.env, FAKE_MODE: mode },
  } as any);
}

describe("runSchema", () => {
  it("prompt 与 cwd 必填", () => {
    const r = runSchema.safeParse({ prompt: "x", cwd: "/tmp" });
    expect(r.success).toBe(true);
    expect(runSchema.safeParse({ prompt: "x" }).success).toBe(false);
    expect(runSchema.safeParse({ cwd: "/tmp" }).success).toBe(false);
  });
});

describe("handleRun", () => {
  it("成功返回结构化 JSON", async () => {
    const r = await runFake("ok");
    expect(r.isError).toBeFalsy();
    const body = JSON.parse(r.content[0].text);
    expect(body.is_error).toBe(false);
    expect(body.text).toBe("pong");
    expect(body.session_id).toBe("s-1");
  });

  it("非零退出码 isError + stderr", async () => {
    const r = await runFake("err");
    expect(r.isError).toBe(true);
    const body = JSON.parse(r.content[0].text);
    expect(body.is_error).toBe(true);
    expect(body.text).toContain("command not found");
  });

  it("超时 isError + timedOut 文案", async () => {
    const r = await runFake("slow");
    expect(r.isError).toBe(true);
    const body = JSON.parse(r.content[0].text);
    expect(body.is_error).toBe(true);
    expect(body.text).toMatch(/超时/);
  });
});
```

注：测试用 `_ksccBin` / `_prependArgv` / `_env` 三个测试钩子字段注入伪 kscc，这些字段不进 `runSchema`（handleRun 内部消费，schema 不声明）。

- [ ] **Step 2: 跑测试确认失败**

Run: `npx vitest run test/run.test.ts`
Expected: FAIL，模块找不到。

- [ ] **Step 3: 写实现 `src/tools/run.ts`**

```ts
import { z } from "zod";
import { buildRunArgs, type RunArgs } from "../kscc/flags.js";
import { invokeKscc } from "../kscc/invoke.js";
import { parseKsccResult, type RunResult } from "../kscc/parse.js";
import { DEFAULTS } from "../config.js";

export const runSchema = z.object({
  prompt: z.string().min(1).describe("要执行的编码任务"),
  cwd: z.string().min(1).describe("目标项目目录（kscc 的 cwd，作用域 + AGENTS.md 上下文）"),
  model: z.string().optional(),
  effort: z.string().optional(),
  allowedTools: z.array(z.string()).optional(),
  disallowedTools: z.array(z.string()).optional(),
  appendSystemPrompt: z.string().optional(),
  permissionMode: z.enum(["acceptEdits", "auto", "bypassPermissions", "manual", "dontAsk", "plan"]).optional(),
  addDirs: z.array(z.string()).optional(),
  outputFormat: z.enum(["text", "json"]).optional(),
  jsonSchema: z.string().optional(),
  maxBudgetUsd: z.number().optional(),
  timeoutMs: z.number().optional(),
  noSessionPersistence: z.boolean().optional(),
  mcpConfig: z.string().optional(),
});

export type RunToolArgs = z.infer<typeof runSchema> & {
  cwd: string;
  timeoutMs?: number;
};

export interface ToolResult {
  content: { type: "text"; text: string }[];
  isError?: boolean;
}

interface TestHooks {
  _ksccBin?: string;
  _prependArgv?: string[];
  _env?: NodeJS.ProcessEnv;
}

function errResult(text: string): ToolResult {
  const payload: RunResult = {
    session_id: null, text, tool_uses: [],
    cost_usd: null, duration_ms: null, num_turns: null, is_error: true,
  };
  return { content: [{ type: "text", text: JSON.stringify(payload) }], isError: true };
}

export async function handleRun(args: RunToolArgs & TestHooks): Promise<ToolResult> {
  const { cwd, timeoutMs, _ksccBin, _prependArgv, _env, ...rest } = args;
  const argv = buildRunArgs(rest as RunArgs);
  const prepend = _prependArgv ?? [];
  try {
    const out = await invokeKscc({
      argv: [...prepend, ...argv],
      cwd,
      timeoutMs: timeoutMs ?? DEFAULTS.timeoutMs,
      ksccBin: _ksccBin ?? "kscc",
      env: _env,
    });
    if (out.timedOut) return errResult(`kscc 超时（${timeoutMs ?? DEFAULTS.timeoutMs} ms）`);
    if (out.exitCode !== 0) return errResult(`kscc 退出码 ${out.exitCode}: ${out.stderr.trim()}`);
    const result = parseKsccResult(out.stdout);
    return { content: [{ type: "text", text: JSON.stringify(result) }], isError: result.is_error ? true : undefined };
  } catch (e) {
    return errResult((e as Error).message);
  }
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `npx vitest run test/run.test.ts`
Expected: PASS（4/4）。

- [ ] **Step 5: Commit**

```bash
git add src/tools/run.ts test/run.test.ts
git commit -m "feat(run): run_kscc_prompt 工具 handler

Co-Authored-By: Kscc <noreply@owtffssent.com>"
```

---

### Task 7: `continue_kscc_session` 工具 `src/tools/continue.ts`

**Files:**
- Create: `src/tools/continue.ts`
- Create: `test/continue.test.ts`

**Interfaces:**
- Consumes: `buildContinueArgs`（Task 3）、`invokeKscc`（Task 5）、`parseKsccResult`（Task 4）、`DEFAULTS`（Task 2）。
- Produces: `continueSchema`、`handleContinue(args: ContinueToolArgs & TestHooks): Promise<ToolResult>`。
- `continueSchema` 字段：Run 的全部字段 + `sessionId?`(string) + `fork?`(boolean)（`cwd` 既是 spawn 目录也是 `--continue` 触发条件）。
- 校验：`sessionId` 与 `cwd` 至少一个；但 `cwd` 在 schema 里已必填（spawn 必须有目录），所以校验逻辑是：若 `sessionId` 未给，则用 `cwd` 触发 `--continue`；两者都没有 cwd 的情况由 schema 必填挡掉。
- handleContinue 逻辑同 handleRun，区别：用 `buildContinueArgs`，且 `--continue` 依赖 cwd 已是 spawn 目录。

- [ ] **Step 1: 写失败测试 `test/continue.test.ts`**

```ts
import { describe, it, expect } from "vitest";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { handleContinue, continueSchema } from "../src/tools/continue.js";

const here = dirname(fileURLToPath(import.meta.url));
const fakeKscc = join(here, "fixtures", "fake-kscc.js");

async function runFake(mode: string, args: Record<string, unknown>) {
  return handleContinue({
    prompt: "more",
    cwd: here,
    timeoutMs: 10000,
    _ksccBin: process.execPath,
    _prependArgv: [fakeKscc],
    _env: { ...process.env, FAKE_MODE: mode },
    ...args,
  } as any);
}

describe("continueSchema", () => {
  it("prompt 与 cwd 必填", () => {
    expect(continueSchema.safeParse({ prompt: "x", cwd: "/tmp" }).success).toBe(true);
    expect(continueSchema.safeParse({ prompt: "x" }).success).toBe(false);
  });
  it("接受 sessionId 与 fork", () => {
    expect(continueSchema.safeParse({ prompt: "x", cwd: "/tmp", sessionId: "s1", fork: true }).success).toBe(true);
  });
});

describe("handleContinue", () => {
  it("成功（resume 路径）", async () => {
    const r = await runFake("ok", { sessionId: "abc" });
    expect(r.isError).toBeFalsy();
    const body = JSON.parse(r.content[0].text);
    expect(body.text).toBe("pong");
  });
  it("成功（continue 路径，仅 cwd）", async () => {
    const r = await runFake("ok", {});
    expect(r.isError).toBeFalsy();
  });
  it("非零退出码 isError", async () => {
    const r = await runFake("err", { sessionId: "abc" });
    expect(r.isError).toBe(true);
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npx vitest run test/continue.test.ts`
Expected: FAIL，模块找不到。

- [ ] **Step 3: 写实现 `src/tools/continue.ts`**

```ts
import { z } from "zod";
import { buildContinueArgs, type ContinueArgs } from "../kscc/flags.js";
import { invokeKscc } from "../kscc/invoke.js";
import { parseKsccResult, type RunResult } from "../kscc/parse.js";
import { DEFAULTS } from "../config.js";

const base = {
  model: z.string().optional(),
  effort: z.string().optional(),
  allowedTools: z.array(z.string()).optional(),
  disallowedTools: z.array(z.string()).optional(),
  appendSystemPrompt: z.string().optional(),
  permissionMode: z.enum(["acceptEdits", "auto", "bypassPermissions", "manual", "dontAsk", "plan"]).optional(),
  addDirs: z.array(z.string()).optional(),
  outputFormat: z.enum(["text", "json"]).optional(),
  jsonSchema: z.string().optional(),
  maxBudgetUsd: z.number().optional(),
  timeoutMs: z.number().optional(),
  noSessionPersistence: z.boolean().optional(),
  mcpConfig: z.string().optional(),
};

export const continueSchema = z.object({
  prompt: z.string().min(1).describe("续接会话的追问内容"),
  cwd: z.string().min(1).describe("项目目录；未给 sessionId 时用它续接该目录最近会话"),
  sessionId: z.string().optional().describe("续接指定会话（优先于 cwd）"),
  fork: z.boolean().optional().describe("续接时开新 session id，不改原会话"),
  ...base,
});

export type ContinueToolArgs = z.infer<typeof continueSchema>;

export interface ToolResult {
  content: { type: "text"; text: string }[];
  isError?: boolean;
}

interface TestHooks {
  _ksccBin?: string;
  _prependArgv?: string[];
  _env?: NodeJS.ProcessEnv;
}

function errResult(text: string): ToolResult {
  const payload: RunResult = {
    session_id: null, text, tool_uses: [],
    cost_usd: null, duration_ms: null, num_turns: null, is_error: true,
  };
  return { content: [{ type: "text", text: JSON.stringify(payload) }], isError: true };
}

export async function handleContinue(args: ContinueToolArgs & TestHooks): Promise<ToolResult> {
  const { cwd, timeoutMs, _ksccBin, _prependArgv, _env, ...rest } = args;
  const argv = buildContinueArgs(rest as ContinueArgs);
  const prepend = _prependArgv ?? [];
  try {
    const out = await invokeKscc({
      argv: [...prepend, ...argv],
      cwd,
      timeoutMs: timeoutMs ?? DEFAULTS.timeoutMs,
      ksccBin: _ksccBin ?? "kscc",
      env: _env,
    });
    if (out.timedOut) return errResult(`kscc 超时（${timeoutMs ?? DEFAULTS.timeoutMs} ms）`);
    if (out.exitCode !== 0) return errResult(`kscc 退出码 ${out.exitCode}: ${out.stderr.trim()}`);
    const result = parseKsccResult(out.stdout);
    return { content: [{ type: "text", text: JSON.stringify(result) }], isError: result.is_error ? true : undefined };
  } catch (e) {
    return errResult((e as Error).message);
  }
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `npx vitest run test/continue.test.ts`
Expected: PASS（5/5）。

- [ ] **Step 5: Commit**

```bash
git add src/tools/continue.ts test/continue.test.ts
git commit -m "feat(continue): continue_kscc_session 工具 handler

Co-Authored-By: Kscc <noreply@owtffssent.com>"
```

---

### Task 8: MCP server 入口 `src/index.ts`

**Files:**
- Create: `src/index.ts`
- Create: `test/index.test.ts`

**Interfaces:**
- Consumes: `runSchema`/`handleRun`（Task 6）、`continueSchema`/`handleContinue`（Task 7）。
- Produces: 可启动的 stdio MCP server。`createServer(): McpServer`（可测，不立即 connect）。

`index.ts` 行为：
1. `const server = new McpServer({ name: "kscc-mcp-server", version: "0.1.0" })`。
2. `server.tool("run_kscc_prompt", "一次性 headless 执行 kscc 编码任务", runSchema.shape, async (args) => handleRun(args))`。
3. `server.tool("continue_kscc_session", "续接 kscc 会话做多轮迭代", continueSchema.shape, async (args) => handleContinue(args))`。
4. `const transport = new StdioServerTransport(); await server.connect(transport)`。

测试策略：不直接打 stdio（难测），而是测 `createServer()` 返回的 server 的 tool 注册——通过 MCP 客户端 SDK 起一对 in-memory transport 连接，调 `tools/list` 和 `tools/call`。但为避免引入 client SDK 复杂度，v1 测试只验证 `createServer()` 不抛 + 进程能 `npx tsx src/index.ts` 启动后在 stdin 喂 `tools/list` 拿到 JSON-RPC 响应。采用后者（真实 stdio 往返）。

- [ ] **Step 1: 写失败测试 `test/index.test.ts`**（真实 stdio 往返）

```ts
import { describe, it, expect } from "vitest";
import { spawn, type ChildProcess } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { once } from "node:events";

const here = dirname(fileURLToPath(import.meta.url));
const indexTs = join(here, "..", "src", "index.ts");

function startServer(env: NodeJS.ProcessEnv): ChildProcess {
  return spawn(process.execPath, ["--import", "tsx", indexTs], {
    stdio: ["pipe", "pipe", "pipe"],
    env,
    windowsHide: true,
  });
}

function send(proc: ChildProcess, obj: unknown): void {
  proc.stdin?.write(JSON.stringify(obj) + "\n");
}

async function readMessage(proc: ChildProcess): Promise<any> {
  // 读一行 JSON
  const stdout = proc.stdout!;
  let buf = "";
  for await (const chunk of stdout) {
    buf += chunk.toString();
    const nl = buf.indexOf("\n");
    if (nl >= 0) {
      const line = buf.slice(0, nl);
      if (line.trim()) return JSON.parse(line);
      buf = buf.slice(nl + 1);
    }
  }
  throw new Error("no message");
}

describe("index server (stdio)", () => {
  it("tools/list 返回两个工具", async () => {
    const proc = startServer(process.env);
    try {
      send(proc, { jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2024-11-05", capabilities: {}, clientInfo: { name: "test", version: "0" } } });
      await readMessage(proc);
      send(proc, { jsonrpc: "2.0", method: "notifications/initialized" });
      send(proc, { jsonrpc: "2.0", id: 2, method: "tools/list", params: {} });
      const msg = await readMessage(proc);
      const names = msg.result.tools.map((t: any) => t.name);
      expect(names).toContain("run_kscc_prompt");
      expect(names).toContain("continue_kscc_session");
    } finally {
      proc.kill("SIGKILL");
    }
  }, 15000);

  it("tools/call run_kscc_prompt 用伪 kscc 走通", async () => {
    const fakeKscc = join(here, "fixtures", "fake-kscc.js");
    const proc = startServer({ ...process.env, KSCC_MCP_TEST_BIN: process.execPath, KSCC_MCP_TEST_PREPEND: fakeKscc, FAKE_MODE: "ok" });
    try {
      send(proc, { jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2024-11-05", capabilities: {}, clientInfo: { name: "test", version: "0" } } });
      await readMessage(proc);
      send(proc, { jsonrpc: "2.0", method: "notifications/initialized" });
      send(proc, { jsonrpc: "2.0", id: 2, method: "tools/call", params: { name: "run_kscc_prompt", arguments: { prompt: "hi", cwd: here } } });
      const msg = await readMessage(proc);
      expect(msg.result.isError).toBeFalsy();
      const body = JSON.parse(msg.result.content[0].text);
      expect(body.text).toBe("pong");
    } finally {
      proc.kill("SIGKILL");
    }
  }, 15000);
});
```

注：`tools/call` 集成用例依赖 `handleRun` 支持经环境变量注入伪 kscc（`KSCC_MCP_TEST_BIN` / `KSCC_MCP_TEST_PREPEND`）。Task 6 的 `handleRun` 用的是参数注入 `_ksccBin`/`_prependArgv`，而 MCP 入口从 `process.env` 读这两个 env 来传给 handleRun。因此 Task 6 的 handleRun 需补一段 env 读取（见 Step 3 说明）。这要求 Task 6 实现已含 `TestHooks`，index.ts 透传 env。

- [ ] **Step 2: 跑测试确认失败**

Run: `npx vitest run test/index.test.ts`
Expected: FAIL，模块找不到 / 进程报错。

- [ ] **Step 3: 写实现 `src/index.ts`**

```ts
#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { runSchema, handleRun } from "./tools/run.js";
import { continueSchema, handleContinue } from "./tools/continue.js";

function testHooksFromEnv(): { _ksccBin?: string; _prependArgv?: string[]; _env?: NodeJS.ProcessEnv } {
  const bin = process.env.KSCC_MCP_TEST_BIN;
  const prepend = process.env.KSCC_MCP_TEST_PREPEND;
  if (bin && prepend) return { _ksccBin: bin, _prependArgv: [prepend], _env: process.env };
  return {};
}

export function createServer(): McpServer {
  const server = new McpServer({ name: "kscc-mcp-server", version: "0.1.0" });

  server.tool(
    "run_kscc_prompt",
    "一次性 headless 执行 kscc 编码任务，返回结构化 JSON（含 session_id 供续接）",
    runSchema.shape,
    async (args) => handleRun({ ...args, ...testHooksFromEnv() } as any),
  );

  server.tool(
    "continue_kscc_session",
    "续接 kscc 会话做多轮迭代；给 sessionId 走 --resume，否则用 cwd 走 --continue",
    continueSchema.shape,
    async (args) => handleContinue({ ...args, ...testHooksFromEnv() } as any),
  );

  return server;
}

async function main(): Promise<void> {
  const transport = new StdioServerTransport();
  const server = createServer();
  await server.connect(transport);
}

const isMain = (() => {
  try {
    return import.meta.url === `file://${process.argv[1]}` || process.argv[1]?.endsWith("index.ts") || process.argv[1]?.endsWith("index.js");
  } catch {
    return false;
  }
})();

if (isMain) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `npx vitest run test/index.test.ts`
Expected: PASS（2/2）。若 tsx 启动慢，测试已给 15s timeout。

- [ ] **Step 5: 跑全量测试 + 构建**

Run:
```bash
npx vitest run
npm run build
```
Expected: 全部测试 PASS；`dist/` 产出 `index.js` 等。

- [ ] **Step 6: Commit**

```bash
git add src/index.ts test/index.test.ts
git commit -m "feat(index): stdio MCP server 入口，注册两工具

Co-Authored-By: Kscc <noreply@owtffssent.com>"
```

---

### Task 9: README 与接入说明

**Files:**
- Modify: `README.md`

**Interfaces:**
- Consumes: 全部已实现能力。
- Produces: 完整 README：用途、安全警告、安装、给 DSH 接入配置、给通用 MCP 客户端配置、工具参数表、返回结构、开发命令、演进路径。

- [ ] **Step 1: 重写 `README.md`**

```markdown
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
```

- [ ] **Step 2: 验证 README 与现状一致**

Run:
```bash
npm run build
node dist/index.js </dev/null &
sleep 1; kill %1 2>/dev/null
```
Expected: 进程能启动（无模块解析报错），被 kill 正常退出。

- [ ] **Step 3: Commit**

```bash
git add README.md
git commit -m "docs: 完整 README 与 DSH/通用客户端接入说明

Co-Authored-By: Kscc <noreply@owtffssent.com>"
```

---

## Self-Review

**1. Spec coverage:**
- §4 架构 / 目录结构 → Task 1（脚手架）+ 各 Task 文件路径覆盖。✅
- §5.1 run_kscc_prompt 工具 + 参数表 → Task 6。✅
- §5.2 continue_kscc_session → Task 7。✅
- §5.3 返回结构 → Task 4（RunResult）+ Task 6/7（序列化）。✅
- §6 安全与默认值 → Task 2（DEFAULTS）+ Task 9（README 警告）。✅
- §7 输出解析与错误处理 → Task 4（parse）+ Task 5（invoke 超时/退出码）+ Task 6/7（错误分支）。✅
- §8 打包与接入 → Task 1（bin）+ Task 9（README）。✅
- §9 测试 → 各 Task 的测试步骤。✅
- 无遗漏。

**2. Placeholder scan:** 无 TBD/TODO；每步含真实代码。✅

**3. Type consistency:**
- `RunArgs`/`ContinueArgs`（Task 3）↔ `runSchema`/`continueSchema`（Task 6/7）字段一致。✅
- `RunResult`（Task 4）↔ 返回 JSON（Task 6/7）。✅
- `InvokeOutput`（Task 5）↔ handleRun/handleContinue 消费 `timedOut`/`exitCode`/`stdout`/`stderr`。✅
- `ToolResult`（Task 6 定义）↔ Task 7 重复定义同名（一致）↔ index.ts 返回结构。✅
- 测试钩子 `_ksccBin`/`_prependArgv`/`_env`（Task 6）↔ index.ts `testHooksFromEnv`（Task 8）。✅
