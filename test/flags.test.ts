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
