#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import type { ChildProcess, SpawnOptions } from "node:child_process";
import crossSpawn from "cross-spawn";
import { StringDecoder } from "node:string_decoder";
import { Value } from "typebox/value";
import type { AgentRunRecord } from "./agents/types.js";

type CliAdaptersModule = typeof import("./agents/cli-adapters.js");
type WorkerOptionsModule = typeof import("./worker/options.js");
type WorkerRunRecordModule = typeof import("./worker/run-record.js");
type WorkerSessionExportModule = typeof import("./worker/session-export.js");

const NODE_SCRIPT_EXTENSIONS = new Set([".js", ".cjs", ".mjs", ".ts", ".cts", ".mts"]);
const MAX_STDERR_CHARS = 20_000;
const MAX_STDOUT_CHARS = 8 * 1024 * 1024;
const KILL_GRACE_MS = 5_000;

const spawnCli = (
  command: string,
  args: readonly string[],
  options: SpawnOptions,
): ChildProcess => NODE_SCRIPT_EXTENSIONS.has(path.extname(command).toLowerCase())
  ? crossSpawn(process.execPath, [command, ...args], options)
  : crossSpawn(command, [...args], options);

const loadWorkerOptions = async (): Promise<WorkerOptionsModule> => {
  if (!import.meta.url.endsWith(".ts")) return import("./worker/options.js");
  const sourceModulePath = "./worker/options.ts";
  return import(sourceModulePath) as Promise<WorkerOptionsModule>;
};

const loadWorkerRunRecord = async (): Promise<WorkerRunRecordModule> => {
  if (!import.meta.url.endsWith(".ts")) return import("./worker/run-record.js");
  const sourceModulePath = "./worker/run-record.ts";
  return import(sourceModulePath) as Promise<WorkerRunRecordModule>;
};

const loadWorkerSessionExport = async (): Promise<WorkerSessionExportModule> => {
  if (!import.meta.url.endsWith(".ts")) return import("./worker/session-export.js");
  const sourceModulePath = "./worker/session-export.ts";
  return import(sourceModulePath) as Promise<WorkerSessionExportModule>;
};

const loadCliAdapters = async (): Promise<CliAdaptersModule> => {
  if (!import.meta.url.endsWith(".ts")) return import("./agents/cli-adapters.js");
  const sourceModulePath = "./agents/cli-adapters.ts";
  return import(sourceModulePath) as Promise<CliAdaptersModule>;
};

const extractBalancedJson = (text: string, start: number): string | null => {
  const open = text[start];
  if (open !== "{" && open !== "[") return null;
  const close = open === "{" ? "}" : "]";
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = start; i < text.length; i++) {
    const ch = text[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (ch === "\\") escaped = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') inString = true;
    else if (ch === open) depth++;
    else if (ch === close) {
      depth--;
      if (depth === 0) return text.slice(start, i + 1);
    }
  }
  return null;
};

const parseStructuredValue = (text: string): unknown => {
  const trimmed = text.trim();
  try {
    return JSON.parse(trimmed);
  } catch {
    // Whole text is not JSON; try a fenced or balanced payload below.
  }
  const fenced = trimmed.match(/```(?:json)?\s*\n([\s\S]*?)\n```/i);
  if (fenced?.[1]) {
    try {
      return JSON.parse(fenced[1].trim());
    } catch {
      // Continue to balanced extraction.
    }
  }
  const start = trimmed.search(/[{\[]/);
  if (start >= 0) {
    const balanced = extractBalancedJson(trimmed, start);
    if (balanced) return JSON.parse(balanced);
  }
  return JSON.parse(trimmed);
};

const terminateChild = (child: ChildProcess, signal: NodeJS.Signals): void => {
  if (!child.pid) return;
  try {
    process.kill(process.platform === "win32" ? child.pid : -child.pid, signal);
  } catch {
    // Child process group already exited.
  }
};

let crashContext: { statusFile: string; record: AgentRunRecord } | undefined;
let runRecordHelpers: WorkerRunRecordModule | undefined;
let terminalWritten = false;

const writeCrashStatus = (error: unknown): void => {
  if (!crashContext || !runRecordHelpers || terminalWritten) return;
  try {
    runRecordHelpers.writeCrashRunRecord(crashContext.statusFile, crashContext.record, error);
  } catch {
    // Best effort; the manager has a transport-death fallback.
  }
};

process.on("uncaughtException", (error) => {
  writeCrashStatus(error);
  process.stderr.write(`${error instanceof Error ? error.stack ?? error.message : error}\n`);
  process.exit(1);
});
process.on("unhandledRejection", (error) => {
  writeCrashStatus(error);
  process.stderr.write(`Unhandled rejection: ${error instanceof Error ? error.stack ?? error.message : error}\n`);
  process.exit(1);
});

const main = async (): Promise<void> => {
  const [optionHelpers, loadedRunRecordHelpers, sessionExportHelpers, cliAdapters] = await Promise.all([
    loadWorkerOptions(),
    loadWorkerRunRecord(),
    loadWorkerSessionExport(),
    loadCliAdapters(),
  ]);
  runRecordHelpers = loadedRunRecordHelpers;
  const options = optionHelpers.parseWorkerOptions();
  if (options.runner !== "cli" || !options.cliAdapter || !options.cliBinary) {
    throw new Error("worker-cli requires runner=cli, --cli-adapter, and --cli-binary");
  }

  const thinking =
    options.thinking === "off" || options.thinking === "minimal" || options.thinking === "low" ||
    options.thinking === "medium" || options.thinking === "high" || options.thinking === "xhigh" ||
    options.thinking === "max"
      ? options.thinking
      : undefined;
  const task = fs.readFileSync(options.taskFile, "utf8");
  const schema = options.schemaFile ? fs.readFileSync(options.schemaFile, "utf8") : undefined;
  const record = loadedRunRecordHelpers.createRunningRecord(options, task, thinking, Date.now());
  loadedRunRecordHelpers.writeRunRecord(options.statusFile, record);
  crashContext = { statusFile: options.statusFile, record };

  const appendLog = (event: Record<string, unknown>): void => {
    try {
      fs.mkdirSync(path.dirname(options.logFile), { recursive: true });
      fs.appendFileSync(options.logFile, `${JSON.stringify(event)}\n`, { encoding: "utf8", mode: 0o600 });
    } catch {
      // Run logs are best effort.
    }
  };
  const emitLifecycle = (event: string, data?: Record<string, unknown>): void => {
    try {
      fs.mkdirSync(path.dirname(options.lifecycleFile), { recursive: true });
      fs.appendFileSync(
        options.lifecycleFile,
        `${JSON.stringify({ version: 1, event, occurredAt: Date.now(), ...(data ? { data } : {}) })}\n`,
        { encoding: "utf8", mode: 0o600 },
      );
    } catch {
      // Lifecycle telemetry is best effort.
    }
  };

  const sessionExporter = options.sessionExportFile
    ? new sessionExportHelpers.SessionExporter({
        file: options.sessionExportFile,
        sessionId: options.id,
        cwd: options.cwd,
        agentName: options.name,
      })
    : undefined;
  const prompt = [
    ...(options.systemPrompt ? [`<system_instructions>\n${options.systemPrompt}\n</system_instructions>`] : []),
    ...(schema ? [`Your final response must contain only JSON matching this schema, without Markdown fences:\n${schema}`] : []),
    task,
  ].join("\n\n");
  const adapter = cliAdapters.resolveCliAdapter(options.cliAdapter);
  const childArguments = adapter.buildArguments({
    prompt,
    ...(options.model ? { model: options.model } : {}),
    ...(thinking ? { thinking } : {}),
    tools: options.tools,
  });

  process.stdout.write(`[pi-fabric] ${options.name} (${options.cliAdapter})\n${task}\n\n`);
  appendLog({ type: "cli_start", adapter: options.cliAdapter, binary: options.cliBinary });
  const child = spawnCli(options.cliBinary, childArguments, {
    cwd: options.cwd,
    detached: process.platform !== "win32",
    env: {
      ...process.env,
      PI_FABRIC_DEPTH: String(options.depth),
      PI_FABRIC_PARENT_RUN: options.id,
      PI_FABRIC_AGENT_NAME: options.name,
      ...(options.mainAgentId ? { PI_FABRIC_MAIN_AGENT_ID: options.mainAgentId } : {}),
      PI_FABRIC_GRANTED_RISKS: options.grantedRisks.join(","),
      PI_FABRIC_FULL_CODE_MODE: String(options.fullCodeMode),
      ...(options.projectRoot ? { PI_FABRIC_PROJECT_ROOT: options.projectRoot } : {}),
      ...(options.runRoot ? { PI_FABRIC_RUN_ROOT: options.runRoot } : {}),
    },
    stdio: ["ignore", "pipe", "pipe"],
  });

  const stdoutDecoder = new StringDecoder("utf8");
  const stderrDecoder = new StringDecoder("utf8");
  let stdout = "";
  let stderr = "";
  let timedOut = false;
  let stopped = false;

  child.stdout?.on("data", (chunk: Buffer) => {
    stdout += stdoutDecoder.write(chunk);
    if (stdout.length > MAX_STDOUT_CHARS) {
      stdout = stdout.slice(-MAX_STDOUT_CHARS);
      appendLog({ type: "cli_warning", message: "stdout exceeded capture limit; keeping tail" });
    }
  });
  child.stderr?.on("data", (chunk: Buffer) => {
    const text = stderrDecoder.write(chunk);
    if (!text) return;
    stderr = `${stderr}${text}`.slice(-MAX_STDERR_CHARS);
    appendLog({ type: "worker_stderr", text });
    process.stderr.write(text);
  });

  const stopChild = (reason: "timeout" | "signal"): void => {
    if (reason === "timeout") timedOut = true;
    else stopped = true;
    terminateChild(child, "SIGTERM");
    setTimeout(() => terminateChild(child, "SIGKILL"), KILL_GRACE_MS).unref();
  };
  const timeout = setTimeout(() => stopChild("timeout"), options.timeoutMs);
  timeout.unref();
  process.once("SIGTERM", () => stopChild("signal"));
  process.once("SIGINT", () => stopChild("signal"));
  process.once("SIGHUP", () => stopChild("signal"));

  const exitCode = await new Promise<number | null>((resolve) => {
    child.once("error", (error) => {
      stderr = `${stderr}\n${error.message}`.trim().slice(-MAX_STDERR_CHARS);
      resolve(null);
    });
    child.once("close", (code) => resolve(code));
  });
  clearTimeout(timeout);
  stdout += stdoutDecoder.end();
  stderr = `${stderr}${stderrDecoder.end()}`.slice(-MAX_STDERR_CHARS);

  record.exitCode = exitCode;
  record.stderr = stderr;
  record.finishedAt = Date.now();
  record.updatedAt = record.finishedAt;

  if (timedOut) {
    record.status = "timed_out";
    record.error = `Agent timed out after ${options.timeoutMs}ms`;
  } else if (stopped) {
    record.status = "stopped";
    record.error = "Agent stopped";
  } else {
    try {
      const result = adapter.parseOutput(stdout);
      record.text = loadedRunRecordHelpers.latestRunText(result.text);
      record.turns = result.turns;
      record.toolCalls = result.toolCalls ?? 0;
      if (result.sessionId) record.runnerSessionId = result.sessionId;
      if (result.model && !record.model) record.model = result.model;
      if (result.usage) {
        record.usage = result.usage;
        emitLifecycle("tokens.usage", {
          runId: options.id,
          name: options.name,
          runner: options.runner,
          depth: options.depth,
          cumulativeTokens: result.usage.input + result.usage.output + result.usage.cacheRead + result.usage.cacheWrite,
          ...result.usage,
        });
        sessionExporter?.push(result.usage, result.model ?? record.model ?? options.model);
      }
      if (record.text) process.stdout.write(`\n${record.text}\n`);
      if (result.error) {
        record.status = "failed";
        record.error = result.error;
      } else if (exitCode === 0) {
        record.status = "completed";
      } else {
        record.status = "failed";
        record.error = stderr.trim() || `${options.cliAdapter} exited with code ${exitCode ?? "unknown"}`;
      }
    } catch (error) {
      record.status = "failed";
      const reason = error instanceof Error ? error.message : String(error);
      record.error = stderr.trim() || `${options.cliAdapter} output could not be parsed: ${reason}`;
    }
  }

  if (record.status === "completed" && options.schemaFile) {
    try {
      const value = parseStructuredValue(record.text);
      const parsedSchema = JSON.parse(fs.readFileSync(options.schemaFile, "utf8")) as Record<string, unknown>;
      if (!Value.Check(parsedSchema, value)) {
        const errors = [...Value.Errors(parsedSchema, value)].slice(0, 5).map((entry) => entry.message).join("; ");
        throw new Error(errors || "value does not match schema");
      }
      record.value = value;
    } catch (error) {
      record.status = "failed";
      const reason = error instanceof Error ? error.message : String(error);
      record.error = `Structured agent output was invalid: ${reason}`;
    }
  }

  appendLog({ type: "cli_end", adapter: options.cliAdapter, status: record.status, exitCode });
  loadedRunRecordHelpers.writeRunRecord(options.statusFile, record);
  terminalWritten = true;
  process.stdout.write(`\n[pi-fabric] ${record.status}\n`);
  process.exitCode = record.status === "completed" ? 0 : 1;
};

main().catch((error) => {
  console.error(error instanceof Error ? error.stack ?? error.message : String(error));
  writeCrashStatus(error);
  process.exit(1);
});
