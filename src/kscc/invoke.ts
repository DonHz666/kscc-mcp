import { spawn } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { delimiter, join, dirname } from "node:path";
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

/**
 * Windows cmd.exe 参数引号转义。含空格/特殊字符的 arg 整体加双引号。
 * 仅在 shell fallback 路径（resolveBinToExe 失败时）使用。
 */
export function quoteWindowsArg(s: string): string {
  if (s.length === 0) return '""';
  if (!/[\s"<>|&^()%!]/.test(s)) return s;
  return '"' + s.replace(/"/g, '\\"') + '"';
}

function isCommandName(bin: string): boolean {
  return !bin.includes("\\") && !bin.includes("/");
}

// 跟踪活跃 kscc 子进程，供 server 退出时清理（避免孤儿进程）
const activeChildren = new Set<import("node:child_process").ChildProcess>();

/** server 退出时 kill 所有活跃 kscc 子进程，避免孤儿进程残留 */
export function killActiveChildren(): void {
  for (const child of activeChildren) {
    try { child.kill("SIGKILL"); } catch { /* 已退出 */ }
  }
  activeChildren.clear();
}

/**
 * Windows: 命令名 bin → 找 .exe 绝对路径，不经 shell 直接 spawn。
 * 1. PATH 里直接有同名 .exe
 * 2. PATH 里有同名 .cmd shim，解析它指向的 .exe（npm shim 格式
 *    "%dp0%\node_modules\@scope\pkg\bin.exe"）
 * 返回正斜杠路径（spawn 对含非 ASCII 的反斜杠 cwd 会 ENOENT，正斜杠安全）。
 * 找不到返回 null（调用方退回 shell fallback）。
 */
export function resolveBinToExe(bin: string, env: NodeJS.ProcessEnv): string | null {
  const dirs = (env.PATH || "").split(delimiter).filter(Boolean);
  for (const dir of dirs) {
    const exe = join(dir, bin + ".exe");
    if (existsSync(exe)) return exe.replace(/\\/g, "/");
  }
  for (const dir of dirs) {
    const cmd = join(dir, bin + ".cmd");
    if (existsSync(cmd)) {
      try {
        const txt = readFileSync(cmd, "utf8");
        const m = txt.match(/"([^"]+\.exe)"/i);
        if (m) {
          const dp0 = dirname(cmd);
          const exe = m[1].replace(/%dp0%/gi, dp0).replace(/%~dp0/gi, dp0);
          return exe.replace(/\\/g, "/");
        }
      } catch {
        // 读 .cmd 失败，继续找
      }
    }
  }
  return null;
}

export function invokeKscc(opts: InvokeOptions): Promise<InvokeOutput> {
  const bin = opts.ksccBin ?? "kscc";
  const timeoutMs = opts.timeoutMs ?? DEFAULTS.timeoutMs;
  const onWindows = process.platform === "win32";
  const env = opts.env ?? process.env;

  return new Promise((resolve) => {
    // Windows 上命令名 bin（如 "kscc"）的处理优先级：
    // 1. resolveBinToExe 解析到真实 .exe 绝对路径 → 直接 spawn（不经 shell）。
    //    此路对含空格/反斜杠/换行/特殊字符的参数都安全（argv 原样传给进程），
    //    且兼容含非 ASCII 的 cwd。优先走这条。
    // 2. 解析失败 → 退回 shell:true + quoteWindowsArg（cmd.exe /c 路径）。
    //    此路空格安全，但反斜杠/换行会被 cmd.exe 破坏（已知局限）。
    // 绝对路径 bin（node.exe、测试脚本）直接 spawn，不经 shell。
    let spawnBin = bin;
    let spawnArgs = opts.argv;
    let useShell = false;
    if (onWindows && isCommandName(bin)) {
      const exe = resolveBinToExe(bin, env);
      if (exe) {
        spawnBin = exe;
      } else {
        spawnArgs = opts.argv.map(quoteWindowsArg);
        useShell = true;
      }
    }

    const child = spawn(spawnBin, spawnArgs, {
      // Windows 上含非 ASCII（如中文"项目"）的反斜杠 cwd 会让 spawn 报 ENOENT，
      // 统一转正斜杠规避（Windows 同时接受两种分隔符）。
      cwd: onWindows ? opts.cwd.replace(/\\/g, "/") : opts.cwd,
      env,
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
      shell: useShell,
    });
    activeChildren.add(child);
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
      activeChildren.delete(child);
      if (timer) clearTimeout(timer);
      resolve({
        stdout,
        stderr: stderr + `\nspawn error: ${err.message}`,
        exitCode: null,
        timedOut: false,
      });
    });
    child.on("close", (code) => {
      activeChildren.delete(child);
      if (timer) clearTimeout(timer);
      resolve({ stdout, stderr, exitCode: code, timedOut });
    });
  });
}
