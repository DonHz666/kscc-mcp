// 伪 kscc：把 stdin 当 prompt 不关心，按环境变量 FAKE_MODE 行为。
// mode=ok → 输出一条 kscc 风格 json；mode=err → 退出码 1 + stderr；mode=slow → 慢响应触发超时。
const mode = process.env.FAKE_MODE ?? "ok";
if (mode === "err") {
  process.stderr.write("kscc: command not found in this mock\n");
  process.exit(1);
}
if (mode === "slow") {
  setTimeout(() => {
    process.stdout.write('{"type":"result","result":"late","is_error":false,"session_id":null,"total_cost_usd":0,"duration_ms":0,"num_turns":1}');
    process.exit(0);
  }, 5000);
  process.exit;
} else {
  process.stdout.write('{"type":"result","result":"pong","is_error":false,"session_id":"s-1","total_cost_usd":0.1,"duration_ms":10,"num_turns":1}');
  process.exit(0);
}
