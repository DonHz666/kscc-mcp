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

export function invokeKscc(opts: InvokeOptions): Promise<InvokeOutput> {
  const bin = opts.ksccBin ?? "kscc";
  const timeoutMs = opts.timeoutMs ?? DEFAULTS.timeoutMs;
  return new Promise((resolve) => {
    const child = spawn(bin, opts.argv, {
      cwd: opts.cwd,
      env: opts.env ?? process.env,
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
      // Windows 上 npm 全局 bin 是 .cmd/.ps1 shim，spawn 不经 shell 找不到命令名
      // （Node 对 .cmd 强制要求 shell:true，见 CVE-2024-27980）。
      // 仅当 bin 是命令名（无路径分隔符，需 shell 查 PATH）时走 shell；
      // 绝对路径 bin（如 node.exe、测试用脚本）不经 shell，避免空格/转义问题。
      shell: process.platform === "win32" && !bin.includes("\\") && !bin.includes("/"),
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
