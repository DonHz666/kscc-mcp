import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { invokeKscc, quoteWindowsArg, resolveBinToExe } from "../src/kscc/invoke.js";

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
    // invokeKscc 对无路径分隔符的 bin 在 win32 走 cmd.exe /c + 手动引号。
    // 用 "node" 命令名（在 PATH 中）+ -e 内联脚本验证 cmd 路径工作。
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

  it("命令名 bin 含空格的 arg 不被截断", async () => {
    // 回归（真实 bug）：shell:true 曾让 cmd.exe 按空格截断含空格的参数。
    // 现改为 resolveBinToExe 直 spawn .exe（不经 shell），空格天然安全。
    const spaced = "hello world with spaces";
    const out = await invokeKscc({
      argv: ["-e", `process.stdout.write(${JSON.stringify(spaced)})`],
      cwd: here,
      timeoutMs: 10000,
      ksccBin: "node",
      env: { ...process.env },
    });
    expect(out.exitCode).toBe(0);
    expect(out.stdout).toContain(spaced);
  });

  it("命令名 bin 含反斜杠的 arg 不被破坏", async () => {
    // 回归（真实 bug）：cmd.exe /c 路径会破坏 prompt 里的反斜杠。
    // resolveBinToExe 直 spawn .exe 不经 shell，反斜杠安全。
    const backslash = "path\\with\\backslash";
    const out = await invokeKscc({
      argv: ["-e", `process.stdout.write(${JSON.stringify(backslash)})`],
      cwd: here,
      timeoutMs: 10000,
      ksccBin: "node",
      env: { ...process.env },
    });
    expect(out.exitCode).toBe(0);
    expect(out.stdout).toContain(backslash);
  });

  it("命令名 bin 含换行的 arg 不被破坏", async () => {
    // 回归（真实 bug）：cmd.exe /c 路径会破坏 prompt 里的换行符。
    const newline = "line1\nline2";
    const out = await invokeKscc({
      argv: ["-e", `process.stdout.write(${JSON.stringify(newline)})`],
      cwd: here,
      timeoutMs: 10000,
      ksccBin: "node",
      env: { ...process.env },
    });
    expect(out.exitCode).toBe(0);
    expect(out.stdout).toContain(newline);
  });
});

describe("resolveBinToExe", () => {
  it("node 命令名能解析到 node.exe 绝对路径", () => {
    if (process.platform !== "win32") return; // Windows 专属
    const exe = resolveBinToExe("node", process.env);
    expect(exe).toBeTruthy();
    expect(exe!.toLowerCase()).toMatch(/node\.exe$/);
  });
  it("返回正斜杠路径", () => {
    if (process.platform !== "win32") return;
    const exe = resolveBinToExe("node", process.env);
    if (exe) expect(exe).not.toContain("\\");
  });
  it("不存在的命令返回 null", () => {
    expect(resolveBinToExe("no-such-bin-xyz", process.env)).toBeNull();
  });
});

describe("quoteWindowsArg", () => {
  it("无特殊字符不加引号", () => {
    expect(quoteWindowsArg("abc")).toBe("abc");
    expect(quoteWindowsArg("--print")).toBe("--print");
  });
  it("含空格加引号", () => {
    expect(quoteWindowsArg("hello world")).toBe('"hello world"');
  });
  it("空字符串变空引号", () => {
    expect(quoteWindowsArg("")).toBe('""');
  });
  it("含双引号转义", () => {
    expect(quoteWindowsArg('say "hi"')).toBe('"say \\"hi\\""');
  });
  it("含特殊字符加引号", () => {
    expect(quoteWindowsArg("a&b")).toBe('"a&b"');
    expect(quoteWindowsArg("a|b")).toBe('"a|b"');
  });
});
