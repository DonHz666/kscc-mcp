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

/**
 * Windows cmd.exe 参数引号转义。含空格/特殊字符的 arg 整体加双引号，
 * 内部双引号转义。shell:true 时 Node 不自动给 argv 加引号，cmd.exe 会按
 * 空格截断含空格的参数（如 prompt），故需预先给每个 arg 加引号。
 */
export function quoteWindowsArg(s: string): string {
  if (s.length === 0) return '""';
  if (!/[\s"<>|&^()%!]/.test(s)) return s;
  return '"' + s.replace(/"/g, '\\"') + '"';
}

function isCommandName(bin: string): boolean {
  return !bin.includes("\\") && !bin.includes("/");
}

export function invokeKscc(opts: InvokeOptions): Promise<InvokeOutput> {
  const bin = opts.ksccBin ?? "kscc";
  const timeoutMs = opts.timeoutMs ?? DEFAULTS.timeoutMs;
  const onWindows = process.platform === "win32";

  return new Promise((resolve) => {
    // Windows 上命令名 bin（如 "kscc"）是 npm 全局 .cmd/.ps1 shim：
    //   - 不经 shell：spawn 找不到（Node 对 .cmd 强制要求 shell，CVE-2024-27980）
    //   - shell:true 默认：cmd.exe 按空格截断含空格的参数（如 prompt）
    //   - cmd.exe /c + windowsVerbatimArguments：含非 ASCII 的 cwd 会 ENOENT
    // 解法：对命令名 bin 用 shell:true（让 cmd.exe 查 PATH 找 .cmd、shell 模式
    // 兼容非 ASCII cwd），并预先用 quoteWindowsArg 给每个 arg 加引号防截断。
    // 绝对路径 bin（node.exe、测试脚本）直接 spawn，不经 shell。
    let spawnBin = bin;
    let spawnArgs = opts.argv;
    let useShell = false;
    if (onWindows && isCommandName(bin)) {
      spawnArgs = opts.argv.map(quoteWindowsArg);
      useShell = true;
    }

    const child = spawn(spawnBin, spawnArgs, {
      // Windows 上含非 ASCII（如中文"项目"）的反斜杠 cwd 会让 spawn 报 ENOENT，
      // 统一转正斜杠规避（Windows 同时接受两种分隔符）。
      cwd: onWindows ? opts.cwd.replace(/\\/g, "/") : opts.cwd,
      env: opts.env ?? process.env,
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
      shell: useShell,
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
