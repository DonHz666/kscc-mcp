import { describe, it, expect } from "vitest";
import { DEFAULTS } from "../src/config.js";

describe("DEFAULTS", () => {
  it("默认 permissionMode 为 bypassPermissions", () => {
    expect(DEFAULTS.permissionMode).toBe("bypassPermissions");
  });
  it("默认 outputFormat 为 json", () => {
    expect(DEFAULTS.outputFormat).toBe("json");
  });
  it("默认 timeoutMs 为 600000", () => {
    expect(DEFAULTS.timeoutMs).toBe(600000);
  });
});
