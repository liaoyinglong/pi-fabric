import fs from "node:fs";

const read = (path) => fs.readFileSync(path, "utf8");
const write = (path, value) => fs.writeFileSync(path, value, "utf8");
const replaceOnce = (path, oldValue, newValue) => {
  const text = read(path);
  if (!text.includes(oldValue)) {
    throw new Error(`Missing expected text in ${path}: ${oldValue.slice(0, 120)}`);
  }
  write(path, text.replace(oldValue, newValue));
};

replaceOnce(
  "src/runtime/type-checker.ts",
  `const TYPE_CORRECTNESS_CODES = new Set<number>([\n  2339, 2551,\n  2322, 2345, 2367,`,
  `const TYPE_CORRECTNESS_CODES = new Set<number>([\n  2322, 2345, 2367,`,
);

replaceOnce(
  "src/core/system-guidance.ts",
  "Pi Code Mode: use `fabric_exec` as the model-facing execution gateway. Call Pi core tools as `pi.*` inside `code`; compose related operations in one program and return only the bounded result needed by the caller.",
  "Pi Code Mode: use `fabric_exec` as the model-facing execution gateway. Pi core actions are `pi.read`, `pi.bash`, `pi.edit`, `pi.write`, `pi.grep`, `pi.find`, and `pi.ls`; run shell commands with `pi.bash` (`pi.exec` does not exist). Compose related operations in one program and return only the bounded result needed by the caller.",
);

{
  const path = "skills/fabric-exec/SKILL.md";
  let text = read(path);
  text = text.replace("collapsed cards show the first 8 lines", "collapsed cards show the first 15 lines");
  const marker = "| `pi.write` | `{ path, content }` | envelope |\n";
  if (!text.includes(marker)) throw new Error("Pi tool table marker missing");
  text = text.replace(
    marker,
    `${marker}\nShell execution is \`pi.bash(...)\`; there is no \`pi.exec\`. Unknown \`pi.*\` members are rejected by the guest TypeScript checker before execution.\n`,
  );
  write(path, text);
}

{
  const path = "src/agents/veda-cli.ts";
  let text = read(path);
  text = text.replace(
    "export interface VedaRunArguments {\n  backend: string;",
    "export interface VedaRunArguments {\n  prompt: string;\n  backend: string;",
  );
  text = text.replace(
    `/** Headless run arguments: veda -b <backend> -p <persona> [model/reasoning/\n *  tools] --json --no-sel -S <session> --no-notify. The task itself is\n *  delivered over stdin by the worker so arbitrarily long prompts never hit\n *  ARG_MAX. */`,
    `/** Headless run arguments: veda -b <backend> -p <persona> [model/reasoning/\n *  tools] --json --no-sel -S <session> --no-notify -- <prompt>. Veda parses\n *  the prompt positionally; \`--\` keeps arbitrary task text from being parsed\n *  as CLI flags. */`,
  );
  const oldTail = `  args.push("--json", "--no-sel", "-S", options.session, "--no-notify");\n  return args;`;
  if (!text.includes(oldTail)) throw new Error("Veda argument tail missing");
  text = text.replace(
    oldTail,
    `  args.push("--json", "--no-sel", "-S", options.session, "--no-notify");\n  args.push("--", options.prompt);\n  return args;`,
  );
  write(path, text);
}

{
  const path = "src/worker.ts";
  let text = read(path);
  const marker = `  const claudeCli = options.runner === "claude" ? await loadClaudeCli() : undefined;\n  const vedaCli = options.runner === "veda" ? await loadVedaCli() : undefined;\n  const childArguments =`;
  if (!text.includes(marker)) throw new Error("worker child argument marker missing");
  text = text.replace(
    marker,
    `  const claudeCli = options.runner === "claude" ? await loadClaudeCli() : undefined;\n  const vedaCli = options.runner === "veda" ? await loadVedaCli() : undefined;\n  const vedaPrompt =\n    options.runner === "veda"\n      ? [\n          ...(options.systemPrompt\n            ? [\`<system_instructions>\\n\${options.systemPrompt}\\n</system_instructions>\`]\n            : []),\n          ...(schema\n            ? [\`Your final response must contain only JSON matching this schema, without Markdown fences:\\n\${schema}\`]\n            : []),\n          task,\n        ].join("\\n\\n")\n      : undefined;\n  const childArguments =`,
  );

  const callMarker = `        ? vedaCli!.buildVedaArguments({\n            backend: options.vedaBackend,\n            persona: options.vedaPersona,`;
  if (!text.includes(callMarker)) throw new Error("worker Veda builder marker missing");
  text = text.replace(
    callMarker,
    `        ? vedaCli!.buildVedaArguments({\n            prompt: vedaPrompt!,\n            backend: options.vedaBackend,\n            persona: options.vedaPersona,`,
  );

  const oldStdin = `  } else if (options.runner === "veda") {\n    // Veda reads the prompt from stdin when no positional prompt is given.\n    // Mirror its <system_instructions> wrapping so systemPrompt and schema\n    // instructions reach the backend model.\n    const sections: string[] = [];\n    if (options.systemPrompt) {\n      sections.push(\`<system_instructions>\\n\${options.systemPrompt}\\n</system_instructions>\`);\n    }\n    if (schema) {\n      sections.push(\n        \`Your final response must contain only JSON matching this schema, without Markdown fences:\\n\${schema}\`,\n      );\n    }\n    sections.push(task);\n    child.stdin?.write(sections.join("\\n\\n"));\n    child.stdin?.end();\n  } else {`;
  if (!text.includes(oldStdin)) throw new Error("worker Veda stdin block missing");
  text = text.replace(
    oldStdin,
    `  } else if (options.runner === "veda") {\n    // Veda receives its one-shot prompt positionally in childArguments.\n    // Close unused stdin so the child cannot wait on an input stream.\n    child.stdin?.end();\n  } else {`,
  );
  write(path, text);
}

write("tests/fixtures/fake-veda.mjs", `#!/usr/bin/env node
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
    }, null, 2) + "\\n");
    process.exit(1);
    break;
  case "design-fail":
    process.stdout.write(JSON.stringify({
      text: "no program here",
      sessionId: "conv-1",
      usage: { inputTokens: 10, outputTokens: 5 },
      design: { ok: false, errors: ["[missing] no <program> block found"] },
    }, null, 2) + "\\n");
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
      text: \`echo: \${input.slice(0, 200)}\`,
      sessionId: "conv-1",
      usage: { inputTokens: 10, outputTokens: 5, cachedTokens: 2 },
    }, null, 2) + "\\n");
    process.exit(0);
}
`);

{
  const path = "tests/veda-cli.test.ts";
  let text = read(path);
  text = text.replaceAll(
    "buildVedaArguments({\n      backend:",
    "buildVedaArguments({\n      prompt: \"test prompt\",\n      backend:",
  );
  text = text.replaceAll(
    "buildVedaArguments({\n        backend:",
    "buildVedaArguments({\n        prompt: \"test prompt\",\n        backend:",
  );
  const expectedTail = `      "--json", "--no-sel", "-S", "fabric-run-123", "--no-notify",\n    ]);`;
  if (!text.includes(expectedTail)) throw new Error("Veda exact argv expectation missing");
  text = text.replace(
    expectedTail,
    `      "--json", "--no-sel", "-S", "fabric-run-123", "--no-notify",\n      "--", "test prompt",\n    ]);`,
  );
  const marker = `  it("forwards a custom persona name unchanged", () => {`;
  if (!text.includes(marker)) throw new Error("Veda test insertion marker missing");
  text = text.replace(
    marker,
    `  it("passes arbitrary prompt text as one literal argument after --", () => {\n    const prompt = "-leading flag-like text\\nsecond line";\n    const args = buildVedaArguments({\n      prompt,\n      backend: "agy",\n      persona: "navigator-chat",\n      tools: [],\n      session: "fabric-prompt",\n    });\n    expect(args.slice(-2)).toEqual(["--", prompt]);\n  });\n\n${marker}`,
  );
  write(path, text);
}

{
  const path = "tests/type-checker.test.ts";
  let text = read(path);
  const marker = `  it("accepts dynamic MCP namespaces and profile-based orchestration", () => {`;
  if (!text.includes(marker)) throw new Error("type checker test marker missing");
  text = text.replace(
    marker,
    `  it("rejects unknown Pi core actions before runtime", () => {\n    const result = typeCheckFabricCode(\n      'return await pi.exec("pwd");',\n      GUEST_TYPE_DECLARATIONS,\n    );\n    expect(result.errors.some((error) =>\n      error.message.includes("Property 'exec' does not exist") || error.message.includes("'exec' does not exist")\n    )).toBe(true);\n    expect(result.javascript).toBeUndefined();\n  });\n\n${marker}`,
  );
  write(path, text);
}

{
  const path = "tests/worker-e2e.test.ts";
  let text = read(path);
  const marker = `  it("rejects recursive Fabric for the Veda runner", async () => {`;
  if (!text.includes(marker)) throw new Error("worker e2e insertion marker missing");
  text = text.replace(
    marker,
    `  it("passes the complete Veda task as a positional prompt", async () => {\n    const result = await runVeda("success", "prompt-through-argv");\n    expect(result.status).toBe("completed");\n    expect(result.text).toContain("echo: prompt-through-argv");\n  }, 30_000);\n\n${marker}`,
  );
  write(path, text);
}

console.log("Lean runtime contract patch applied");
