#!/usr/bin/env node
// Stub Veda for worker e2e. Real Veda takes one positional prompt; Fabric
// passes it after -- so prompt text beginning with '-' stays literal.
const behavior = process.env.FAKE_VEDA_BEHAVIOR || "success";
const separator = process.argv.indexOf("--");
const input = separator >= 0 ? process.argv.slice(separator + 1).join(" ") : "";

switch (behavior) {
  case "error":
    process.stdout.write(JSON.stringify({
      text: "partial",
      error: "backend quota exceeded",
      sessionId: "conv-1",
      usage: { inputTokens: 10, outputTokens: 5 },
    }, null, 2) + "\n");
    process.exit(1);
    break;
  case "design-fail":
    process.stdout.write(JSON.stringify({
      text: "no program here",
      sessionId: "conv-1",
      usage: { inputTokens: 10, outputTokens: 5 },
      design: { ok: false, errors: ["[missing] no <program> block found"] },
    }, null, 2) + "\n");
    process.exit(1);
    break;
  case "no-json":
    process.exit(0);
    break;
  case "hang":
    setInterval(() => {}, 60_000);
    break;
  case "success":
  default:
    process.stdout.write(JSON.stringify({
      text: `echo: ${input.slice(0, 200)}`,
      sessionId: "conv-1",
      usage: { inputTokens: 10, outputTokens: 5, cachedTokens: 2 },
    }, null, 2) + "\n");
    process.exit(0);
}
