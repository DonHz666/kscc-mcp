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
