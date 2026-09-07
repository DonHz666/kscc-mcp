// 伪 kscc 测试脚本：按 FAKE_MODE 输出不同内容
const mode = process.env.FAKE_MODE ?? "ok";
if (mode === "empty") {
  // 空 stdout，正常退出
  process.exit(0);
}
if (mode === "big") {
  // 超长输出：生成 ~1MB 的 JSON
  const big = "x".repeat(1000000);
  const out = JSON.stringify({ type: "result", result: big, is_error: false, session_id: "s-big", total_cost_usd: 0.1, duration_ms: 10, num_turns: 1 });
  process.stdout.write(out);
  process.exit(0);
}
if (mode === "bom") {
  // UTF-8 BOM 开头的 JSON
  process.stdout.write("﻿" + JSON.stringify({ type: "result", result: "bom-test", is_error: false, session_id: "s-bom" }));
  process.exit(0);
}
// 默认 ok
process.stdout.write('{"type":"result","result":"pong","is_error":false,"session_id":"s-1","total_cost_usd":0.1,"duration_ms":10,"num_turns":1}');
process.exit(0);
