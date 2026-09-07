export type PermissionMode =
  | "acceptEdits"
  | "auto"
  | "bypassPermissions"
  | "manual"
  | "dontAsk"
  | "plan";

export type OutputFormat = "text" | "json";

export interface Defaults {
  permissionMode: PermissionMode;
  outputFormat: OutputFormat;
  timeoutMs: number;
}

export const DEFAULTS: Defaults = {
  permissionMode: "bypassPermissions",
  outputFormat: "json",
  timeoutMs: 600000,
};
