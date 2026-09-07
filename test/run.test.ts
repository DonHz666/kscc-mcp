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
