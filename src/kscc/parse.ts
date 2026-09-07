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

export function parseKsccResult(stdout: string, rawText = false): RunResult {
  // rawText=true（outputFormat=text）：kscc 输出纯文本，直接当 text 返回，不解析 JSON。
  if (rawText) {
    return {
      session_id: null,
      text: stdout,
      tool_uses: [],
      cost_usd: null,
      duration_ms: null,
      num_turns: null,
      is_error: false,
    };
  }
  // 健壮性：strip UTF-8 BOM（部分环境输出带 BOM 会让 JSON.parse 失败）
  const cleaned = stdout.charCodeAt(0) === 0xfeff ? stdout.slice(1) : stdout;
  // 空输出：kscc 退出码 0 但无输出，返回空 text 而非抛错（边界友好）
  if (cleaned.trim() === "") {
    return {
      session_id: null,
      text: "",
      tool_uses: [],
      cost_usd: null,
      duration_ms: null,
      num_turns: null,
      is_error: false,
    };
  }
  let parsed: KsccJson;
  try {
    parsed = JSON.parse(cleaned);
  } catch {
    throw new Error(`kscc 输出非 JSON: ${cleaned.slice(0, 200)}`);
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
