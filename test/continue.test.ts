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
