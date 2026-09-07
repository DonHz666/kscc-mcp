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
