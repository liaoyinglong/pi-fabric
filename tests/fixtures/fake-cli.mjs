#!/usr/bin/env node

const args = process.argv.slice(2);
const behavior = process.env.FAKE_CLI_BEHAVIOR ?? "success";
const adapter = args[0] === "exec" ? "droid" : "agy";

if (behavior === "hang") {
  setInterval(() => {}, 1_000);
} else if (adapter === "droid") {
  const prompt = args.at(-1) ?? "";
  if (behavior === "error") {
    process.stdout.write(JSON.stringify({
      type: "result",
      subtype: "error",
      is_error: true,
      num_turns: 1,
      result: "quota exceeded",
    }));
    process.exitCode = 1;
  } else {
    process.stdout.write(JSON.stringify({
      type: "result",
      subtype: "success",
      is_error: false,
      num_turns: 1,
      result: `echo: ${prompt}`,
      session_id: "droid-session-1",
      total_cost_usd: 0.01,
      usage: {
        input_tokens: 10,
        output_tokens: 5,
        cache_read_input_tokens: 2,
        cache_creation_input_tokens: 0,
      },
    }));
  }
} else {
  const promptIndex = args.indexOf("-p");
  const prompt = promptIndex >= 0 ? args[promptIndex + 1] ?? "" : "";
  if (behavior === "error") {
    process.stderr.write("quota exceeded\n");
    process.exitCode = 1;
  } else {
    process.stdout.write(`echo: ${prompt}\n`);
  }
}
