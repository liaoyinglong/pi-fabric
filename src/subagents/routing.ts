import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { parse as parseYaml } from "yaml";

export const SUBAGENT_TIERS = ["fast", "balance", "strong"] as const;
export type SubagentTier = (typeof SUBAGENT_TIERS)[number];

export const SUBAGENT_POLICIES = ["inspect", "execute", "modify", "isolated"] as const;
export type SubagentPolicy = (typeof SUBAGENT_POLICIES)[number];

type SubagentRunner = "pi" | "claude" | "cli";
type SubagentCliAdapter = "agy" | "droid";
type SubagentTransport = "auto" | "process" | "tmux" | "screen" | "localterm" | "herdr";
type SubagentThinking = "off" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max";

interface SubagentTierConfig {
  description: string;
  instructions?: string;
  runner?: SubagentRunner;
  cli?: SubagentCliAdapter;
  transport?: SubagentTransport;
  model?: string;
  thinking?: SubagentThinking;
  timeoutMs?: number;
  extensions?: boolean;
}

interface SubagentPolicyConfig {
  description: string;
  instructions?: string;
  tools: string[];
  worktree: boolean;
}

interface SubagentRoutingCatalog {
  tiers: Record<SubagentTier, SubagentTierConfig>;
  policies: Record<SubagentPolicy, SubagentPolicyConfig>;
  sources: string[];
}

interface SubagentRoutingFile {
  tiers: Partial<Record<SubagentTier, Partial<SubagentTierConfig>>>;
  policies: Partial<Record<SubagentPolicy, Partial<SubagentPolicyConfig>>>;
}

interface ResolvedSubagentRouting {
  tier: SubagentTier;
  policy: SubagentPolicy;
  args: Record<string, unknown>;
}

export interface SubagentRoutingLoadOptions {
  projectTrusted?: boolean;
}

const DEFAULT_TIERS: Record<SubagentTier, SubagentTierConfig> = {
  fast: {
    description: "Cheap, fast worker for bounded search, evidence gathering, and repetitive inspection.",
    instructions: "Prefer direct evidence and short answers. Do not make architecture decisions. Surface uncertainty instead of guessing.",
    runner: "pi",
    model: "azure-openai-responses/gpt-5.6-luna",
    thinking: "medium",
  },
  balance: {
    description: "Default worker for routine reasoning, debugging, implementation, and verification.",
    instructions: "Solve the bounded task end-to-end, keep scope narrow, and return the minimum evidence Main needs.",
    runner: "pi",
    model: "azure-openai-responses/gpt-5.6-terra",
    thinking: "medium",
  },
  strong: {
    description: "Strong worker for ambiguous bugs, architecture decisions, difficult reasoning, and independent review.",
    instructions: "Challenge assumptions, resolve ambiguity with evidence, and explicitly report residual risk or uncertainty.",
    runner: "pi",
    model: "azure-openai-responses/gpt-5.6-sol",
    thinking: "medium",
  },
};

const DEFAULT_POLICIES: Record<SubagentPolicy, SubagentPolicyConfig> = {
  inspect: {
    description: "Read-only inspection and evidence gathering.",
    instructions: "Do not modify files or run mutation-capable shell commands. Return concise findings with concrete evidence.",
    tools: ["read", "grep", "find", "ls"],
    worktree: false,
  },
  execute: {
    description: "Read plus shell execution for tests, builds, diagnostics, and verification; no file edits.",
    instructions: "Execution is for bounded verification and diagnostics. Do not edit or write files. Summarize command outcomes instead of returning raw logs.",
    tools: ["read", "grep", "find", "ls", "bash"],
    worktree: false,
  },
  modify: {
    description: "Scoped implementation in the current workspace with verification.",
    instructions: "Change only files needed for the assigned task. Do not undo unrelated work. Verify the change and report touched files plus validation results.",
    tools: ["read", "grep", "find", "ls", "bash", "edit", "write"],
    worktree: false,
  },
  isolated: {
    description: "Scoped implementation in an isolated Git worktree for experiments or parallel mutation.",
    instructions: "Work only in the isolated worktree. Keep the change self-contained, verify it, and return changed files plus validation results for Main to integrate.",
    tools: ["read", "grep", "find", "ls", "bash", "edit", "write"],
    worktree: true,
  },
};

const RUNNERS = new Set<SubagentRunner>(["pi", "claude", "cli"]);
const CLI_ADAPTERS = new Set<SubagentCliAdapter>(["agy", "droid"]);
const TRANSPORTS = new Set<SubagentTransport>([
  "auto",
  "process",
  "tmux",
  "screen",
  "localterm",
  "herdr",
]);
const THINKING = new Set<SubagentThinking>([
  "off",
  "minimal",
  "low",
  "medium",
  "high",
  "xhigh",
  "max",
]);

const asObject = (value: unknown): Record<string, unknown> | undefined =>
  typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;

const nonEmptyString = (value: unknown): string | undefined =>
  typeof value === "string" && value.trim() ? value.trim() : undefined;

const stringList = (value: unknown): string[] | undefined => {
  if (!Array.isArray(value)) return undefined;
  return value
    .filter((entry): entry is string => typeof entry === "string")
    .map((entry) => entry.trim())
    .filter(Boolean);
};

const isTier = (value: string): value is SubagentTier =>
  (SUBAGENT_TIERS as readonly string[]).includes(value);

const isPolicy = (value: string): value is SubagentPolicy =>
  (SUBAGENT_POLICIES as readonly string[]).includes(value);

const parseTier = (value: unknown): Partial<SubagentTierConfig> | undefined => {
  const input = asObject(value);
  if (!input) return undefined;
  const runner = RUNNERS.has(input.runner as SubagentRunner)
    ? input.runner as SubagentRunner
    : undefined;
  const cli = CLI_ADAPTERS.has(input.cli as SubagentCliAdapter)
    ? input.cli as SubagentCliAdapter
    : undefined;
  const transport = TRANSPORTS.has(input.transport as SubagentTransport)
    ? input.transport as SubagentTransport
    : undefined;
  const thinking = THINKING.has(input.thinking as SubagentThinking)
    ? input.thinking as SubagentThinking
    : undefined;
  const timeoutMs = typeof input.timeoutMs === "number" && Number.isFinite(input.timeoutMs) && input.timeoutMs > 0
    ? Math.floor(input.timeoutMs)
    : undefined;
  const description = nonEmptyString(input.description);
  const instructions = nonEmptyString(input.instructions);
  const model = nonEmptyString(input.model);
  return {
    ...(description ? { description } : {}),
    ...(instructions ? { instructions } : {}),
    ...(runner ? { runner } : {}),
    ...(cli ? { cli } : {}),
    ...(transport ? { transport } : {}),
    ...(model ? { model } : {}),
    ...(thinking ? { thinking } : {}),
    ...(timeoutMs !== undefined ? { timeoutMs } : {}),
    ...(typeof input.extensions === "boolean" ? { extensions: input.extensions } : {}),
  };
};

const parsePolicy = (value: unknown): Partial<SubagentPolicyConfig> | undefined => {
  const input = asObject(value);
  if (!input) return undefined;
  const description = nonEmptyString(input.description);
  const instructions = nonEmptyString(input.instructions);
  const tools = stringList(input.tools);
  return {
    ...(description ? { description } : {}),
    ...(instructions ? { instructions } : {}),
    ...(tools !== undefined ? { tools } : {}),
    ...(typeof input.worktree === "boolean" ? { worktree: input.worktree } : {}),
  };
};

const parseRoutingFile = (filePath: string): SubagentRoutingFile => {
  const source = fs.readFileSync(filePath, "utf8");
  const parsed: unknown = filePath.endsWith(".json") ? JSON.parse(source) : parseYaml(source);
  const root = asObject(parsed);
  if (!root) throw new Error(`Subagent routing file must contain an object: ${filePath}`);

  const rawTiers = asObject(root.tiers) ?? {};
  const rawPolicies = asObject(root.policies) ?? {};
  const tiers: SubagentRoutingFile["tiers"] = {};
  const policies: SubagentRoutingFile["policies"] = {};

  for (const name of SUBAGENT_TIERS) {
    const parsedTier = parseTier(rawTiers[name]);
    if (parsedTier) tiers[name] = parsedTier;
  }
  for (const name of SUBAGENT_POLICIES) {
    const parsedPolicy = parsePolicy(rawPolicies[name]);
    if (parsedPolicy) policies[name] = parsedPolicy;
  }
  return { tiers, policies };
};

const projectRoot = (cwd: string): string => {
  const configured = process.env.PI_FABRIC_PROJECT_ROOT?.trim();
  if (configured) return path.resolve(configured);
  let current = path.resolve(cwd);
  while (true) {
    if (fs.existsSync(path.join(current, ".git"))) return current;
    const parent = path.dirname(current);
    if (parent === current) return path.resolve(cwd);
    current = parent;
  }
};

const candidateFiles = (base: string): string[] => [
  path.join(base, "subagents.yaml"),
  path.join(base, "subagents.yml"),
  path.join(base, "subagents.json"),
];

const routingFiles = (
  cwd: string,
  options: SubagentRoutingLoadOptions = {},
): string[] => {
  const globalBase = path.join(os.homedir(), ".pi", "agent", "fabric");
  const projectBase = path.join(projectRoot(cwd), ".pi", "fabric");
  const explicit = process.env.PI_FABRIC_SUBAGENTS_FILE?.trim();
  return [
    ...candidateFiles(globalBase),
    ...(options.projectTrusted === false ? [] : candidateFiles(projectBase)),
    ...(explicit ? [path.resolve(explicit)] : []),
  ];
};

const cloneCatalog = (): SubagentRoutingCatalog => ({
  tiers: Object.fromEntries(
    SUBAGENT_TIERS.map((name) => [name, { ...DEFAULT_TIERS[name] }]),
  ) as Record<SubagentTier, SubagentTierConfig>,
  policies: Object.fromEntries(
    SUBAGENT_POLICIES.map((name) => [name, {
      ...DEFAULT_POLICIES[name],
      tools: [...DEFAULT_POLICIES[name].tools],
    }]),
  ) as Record<SubagentPolicy, SubagentPolicyConfig>,
  sources: [],
});

const loadSubagentRouting = (
  cwd: string,
  options: SubagentRoutingLoadOptions = {},
): SubagentRoutingCatalog => {
  const catalog = cloneCatalog();
  for (const filePath of routingFiles(cwd, options)) {
    if (!fs.existsSync(filePath)) continue;
    const loaded = parseRoutingFile(filePath);
    for (const name of SUBAGENT_TIERS) {
      const override = loaded.tiers[name];
      if (override) catalog.tiers[name] = { ...catalog.tiers[name], ...override };
    }
    for (const name of SUBAGENT_POLICIES) {
      const override = loaded.policies[name];
      if (override) {
        catalog.policies[name] = {
          ...catalog.policies[name],
          ...override,
          tools: override.tools !== undefined
            ? [...override.tools]
            : [...catalog.policies[name].tools],
        };
      }
    }
    catalog.sources.push(filePath);
  }
  return catalog;
};

const tierArgs = (tier: SubagentTierConfig): Record<string, unknown> => ({
  ...(tier.runner ? { runner: tier.runner } : {}),
  ...(tier.cli ? { cli: tier.cli } : {}),
  ...(tier.transport ? { transport: tier.transport } : {}),
  ...(tier.model ? { model: tier.model } : {}),
  ...(tier.thinking ? { thinking: tier.thinking } : {}),
  ...(tier.timeoutMs !== undefined ? { timeoutMs: tier.timeoutMs } : {}),
  ...(tier.extensions !== undefined ? { extensions: tier.extensions } : {}),
});

const policyArgs = (policy: SubagentPolicyConfig): Record<string, unknown> => ({
  tools: [...policy.tools],
  worktree: policy.worktree,
});

const childTask = (
  tierName: SubagentTier,
  tier: SubagentTierConfig,
  policyName: SubagentPolicy,
  policy: SubagentPolicyConfig,
  role: string,
  instructions: string | undefined,
  task: unknown,
): string => [
  "You are a bounded subagent created by Main. Main owns the final decision and integration.",
  `Assigned role: ${role}`,
  `Execution tier: ${tierName} — ${tier.description}`,
  `Capability policy: ${policyName} — ${policy.description}`,
  tier.instructions ? `Tier guidance:\n${tier.instructions}` : undefined,
  policy.instructions ? `Policy boundary:\n${policy.instructions}` : undefined,
  instructions ? `Instructions from Main:\n${instructions}` : undefined,
  [
    "Output contract:",
    "- Return a compact result, not a transcript of your tool calls.",
    "- Include concrete evidence, changed files, or verification results when relevant.",
    "- State uncertainty, missing evidence, or blockers explicitly.",
    "- Do not broaden scope beyond the assigned task.",
  ].join("\n"),
  `Task:\n${String(task ?? "")}`,
].filter((value): value is string => Boolean(value)).join("\n\n");

export const resolveSubagentRouting = (
  args: Record<string, unknown>,
  cwd: string,
  options: SubagentRoutingLoadOptions = {},
): ResolvedSubagentRouting => {
  const catalog = loadSubagentRouting(cwd, options);
  const rawTier = nonEmptyString(args.tier) ?? "balance";
  if (!isTier(rawTier)) throw new Error(`Unknown subagent tier: ${rawTier}`);
  const rawPolicy = nonEmptyString(args.policy) ?? "inspect";
  if (!isPolicy(rawPolicy)) throw new Error(`Unknown subagent policy: ${rawPolicy}`);

  const tier = catalog.tiers[rawTier];
  const policy = catalog.policies[rawPolicy];
  const role = nonEmptyString(args.role) ?? "bounded worker";
  const instructions = nonEmptyString(args.instructions);
  const merged: Record<string, unknown> = {
    ...tierArgs(tier),
    ...args,
    ...policyArgs(policy),
    name: nonEmptyString(args.name) ?? (role === "bounded worker" ? `${rawTier}:${rawPolicy}` : role),
    task: childTask(rawTier, tier, rawPolicy, policy, role, instructions, args.task),
  };
  delete merged.tier;
  delete merged.policy;
  delete merged.role;
  delete merged.instructions;
  return { tier: rawTier, policy: rawPolicy, args: merged };
};

export const describeSubagentRouting = (
  cwd: string,
  options: SubagentRoutingLoadOptions = {},
): Record<string, unknown> => {
  const catalog = loadSubagentRouting(cwd, options);
  return {
    tiers: SUBAGENT_TIERS.map((name) => ({
      name,
      description: catalog.tiers[name].description,
    })),
    policies: SUBAGENT_POLICIES.map((name) => ({
      name,
      description: catalog.policies[name].description,
      tools: [...catalog.policies[name].tools],
      worktree: catalog.policies[name].worktree,
    })),
    sources: catalog.sources,
  };
};