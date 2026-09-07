import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { parseKsccResult } from "../src/kscc/parse.js";

const here = dirname(fileURLToPath(import.meta.url));
const ok = readFileSync(join(here, "fixtures/result.json"), "utf8").trim();
const err = readFileSync(join(here, "fixtures/error-result.json"), "utf8").trim();

describe("parseKsccResult", () => {
  it("解析成功结果", () => {
    const r = parseKsccResult(ok);
    expect(r.is_error).toBe(false);
    expect(r.text).toBe("pong");
    expect(r.session_id).toBe("0d215be8-2c0e-412d-a8f1-20ae961d0d28");
    expect(r.cost_usd).toBe(0.14218);
    expect(r.duration_ms).toBe(8882);
    expect(r.num_turns).toBe(1);
    expect(r.tool_uses).toEqual([]);
  });

  it("解析错误结果", () => {
    const r = parseKsccResult(err);
    expect(r.is_error).toBe(true);
    expect(r.text).toBe("Error: rate limited");
    expect(r.session_id).toBe(null);
    expect(r.cost_usd).toBe(0);
    expect(r.tool_uses).toEqual([]);
  });

  it("非 JSON 抛错", () => {
    expect(() => parseKsccResult("not json at all")).toThrow();
  });

  it("rawText=true 时纯文本当 text 返回，不解析 JSON", () => {
    const r = parseKsccResult("纯文本测试", true);
    expect(r.text).toBe("纯文本测试");
    expect(r.is_error).toBe(false);
    expect(r.session_id).toBe(null);
    expect(r.tool_uses).toEqual([]);
    expect(r.cost_usd).toBe(null);
  });

  it("rawText=true 时不影响 JSON 字符串内容（原样保留）", () => {
    const r = parseKsccResult('{"looks":"like json"}', true);
    expect(r.text).toBe('{"looks":"like json"}');
    expect(r.is_error).toBe(false);
  });
});
