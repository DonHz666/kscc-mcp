export interface RunResult {
  session_id: string | null;
  text: string;
  tool_uses: string[];
  cost_usd: number | null;
  duration_ms: number | null;
  num_turns: number | null;
  is_error: boolean;
}

interface KsccJson {
  result?: string;
  session_id?: string | null;
  total_cost_usd?: number;
  duration_ms?: number;
  num_turns?: number;
  is_error?: boolean;
}

export function parseKsccResult(stdout: string): RunResult {
  let parsed: KsccJson;
  try {
    parsed = JSON.parse(stdout);
  } catch {
    throw new Error(`kscc 输出非 JSON: ${stdout.slice(0, 200)}`);
  }
  return {
    session_id: parsed.session_id ?? null,
    text: parsed.result ?? "",
    tool_uses: [],
    cost_usd: parsed.total_cost_usd ?? null,
    duration_ms: parsed.duration_ms ?? null,
    num_turns: parsed.num_turns ?? null,
    is_error: parsed.is_error ?? false,
  };
}
