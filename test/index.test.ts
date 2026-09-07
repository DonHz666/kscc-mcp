import { describe, it, expect } from "vitest";
import { spawn, type ChildProcess } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const indexTs = join(here, "..", "src", "index.ts");

function startServer(env: NodeJS.ProcessEnv): ChildProcess {
  return spawn(process.execPath, ["--import", "tsx", indexTs], {
    stdio: ["pipe", "pipe", "pipe"],
    env,
    windowsHide: true,
  });
}

function send(proc: ChildProcess, obj: unknown): void {
  proc.stdin?.write(JSON.stringify(obj) + "\n");
}

async function readMessage(proc: ChildProcess, timeoutMs = 10000): Promise<any> {
  const stdout = proc.stdout!;
  return new Promise((resolve, reject) => {
    let buf = "";
    let settled = false;
    const timer = setTimeout(() => {
      if (!settled) { settled = true; cleanup(); reject(new Error("readMessage timeout")); }
    }, timeoutMs);
    function onData(chunk: Buffer) {
      if (settled) return;
      buf += chunk.toString();
      const nl = buf.indexOf("\n");
      if (nl >= 0) {
        const line = buf.slice(0, nl).trim();
        if (line) {
          settled = true;
          cleanup();
          try { resolve(JSON.parse(line)); } catch (e) { reject(e); }
        }
      }
    }
    function onEnd() {
      if (!settled) { settled = true; cleanup(); reject(new Error("no message: stream closed")); }
    }
    function onError(err: Error) {
      if (!settled) { settled = true; cleanup(); reject(new Error(`no message: ${err.message}`)); }
    }
    function cleanup() {
      clearTimeout(timer);
      stdout.removeListener("data", onData);
      stdout.removeListener("end", onEnd);
      stdout.removeListener("error", onError);
    }
    stdout.on("data", onData);
    stdout.on("end", onEnd);
    stdout.on("error", onError);
  });
}

describe("index server (stdio)", () => {
  it("tools/list 返回两个工具", async () => {
    const proc = startServer(process.env);
    try {
      send(proc, { jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2024-11-05", capabilities: {}, clientInfo: { name: "test", version: "0" } } });
      await readMessage(proc);
      send(proc, { jsonrpc: "2.0", method: "notifications/initialized" });
      send(proc, { jsonrpc: "2.0", id: 2, method: "tools/list", params: {} });
      const msg = await readMessage(proc);
      const names = msg.result.tools.map((t: any) => t.name);
      expect(names).toContain("run_kscc_prompt");
      expect(names).toContain("continue_kscc_session");
    } finally {
      proc.kill("SIGKILL");
    }
  }, 15000);

  it("tools/call run_kscc_prompt 用伪 kscc 走通", async () => {
    const fakeKscc = join(here, "fixtures", "fake-kscc.js");
    const proc = startServer({ ...process.env, KSCC_MCP_TEST_BIN: process.execPath, KSCC_MCP_TEST_PREPEND: fakeKscc, FAKE_MODE: "ok" });
    try {
      send(proc, { jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2024-11-05", capabilities: {}, clientInfo: { name: "test", version: "0" } } });
      await readMessage(proc);
      send(proc, { jsonrpc: "2.0", method: "notifications/initialized" });
      send(proc, { jsonrpc: "2.0", id: 2, method: "tools/call", params: { name: "run_kscc_prompt", arguments: { prompt: "hi", cwd: here } } });
      const msg = await readMessage(proc);
      expect(msg.result.isError).toBeFalsy();
      const body = JSON.parse(msg.result.content[0].text);
      expect(body.text).toBe("pong");
    } finally {
      proc.kill("SIGKILL");
    }
  }, 15000);
});
