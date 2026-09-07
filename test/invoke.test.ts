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

  it("命令名 bin（无路径分隔符）在 Windows 经 shell 解析能找到", async () => {
    // 回归：Windows 上 npm 全局 bin 是 .cmd shim，spawn 不经 shell 找不到命令名。
    // invokeKscc 对无路径分隔符的 bin 在 win32 走 shell:true。
    // 用 "node" 命令名（在 PATH 中）+ -e 内联脚本验证 shell 路径工作。
    const out = await invokeKscc({
      argv: ["-e", "process.stdout.write('shell-ok')"],
      cwd: here,
      timeoutMs: 10000,
      ksccBin: "node",
      env: { ...process.env },
    });
    expect(out.exitCode).toBe(0);
    expect(out.timedOut).toBe(false);
    expect(out.stdout).toContain("shell-ok");
  });
});
