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
  [key: string]: unknown;
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
    const result = parseKsccResult(out.stdout, rest.outputFormat === "text");
    return { content: [{ type: "text", text: JSON.stringify(result) }], isError: result.is_error ? true : undefined };
  } catch (e) {
    return errResult((e as Error).message);
  }
}
