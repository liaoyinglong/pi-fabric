import type { FabricDynamicGuestDeclarations } from "../core/execution-types.js";

export const PI_CORE_COMPATIBILITY_ARGUMENT_TYPE_NAMES = {
  read: "PiReadCompatibilityArgument",
  bash: "PiBashCompatibilityArgument",
  edit: "PiEditCompatibilityArgument",
  write: "PiWriteCompatibilityArgument",
  grep: "PiGrepCompatibilityArgument",
  find: "PiFindCompatibilityArgument",
  ls: "PiLsCompatibilityArgument",
} as const;

export const PI_CORE_NUMERIC_FIELDS = {
  read: ["offset", "limit"],
  bash: ["timeout"],
  edit: [],
  write: [],
  grep: ["context", "limit"],
  find: ["limit"],
  ls: ["limit"],
} as const;

export const GUEST_TYPE_DECLARATIONS = `
type JsonPrimitive = string | number | boolean | null;
type JsonValue = JsonPrimitive | JsonValue[] | { [key: string]: JsonValue };
interface FabricActionEffect {
  kind: "none" | "transactional" | "emission";
  resources?: string[];
  ordering?: "commutative" | "ordered" | "unknown";
}
interface FabricActionSummary {
  ref: string;
  provider: string;
  name: string;
  description: string;
  risk: "read" | "write" | "execute" | "network";
  namespace?: string;
  effect?: FabricActionEffect;
}
interface FabricAction extends FabricActionSummary {
  inputSchema: Record<string, unknown>;
  outputSchema?: Record<string, unknown>;
}
interface FabricCapabilityActionHead {
  key: string;
  parentKey: string;
  ref: string;
  name: string;
  description: string;
  descriptorHash: string;
  risk: "read" | "write" | "execute" | "network";
  namespace?: string;
  effect?: FabricActionEffect;
}
interface FabricCapabilityProviderHead {
  key: string;
  parentKey: string;
  name: string;
  description: string;
  descriptorHash: string;
  actions: FabricCapabilityActionHead[];
}
interface FabricCapabilityCatalog {
  kind: "pi-fabric.capability-catalog";
  version: 1;
  root: {
    key: "capability:fabric";
    name: "Fabric capabilities";
    description: string;
    descriptorHash: string;
  };
  providers: FabricCapabilityProviderHead[];
  totalActions: number;
  indexedActions: number;
  complete: boolean;
  reasons: string[];
}
type FabricDiscoveryListArgs = {
  provider?: string;
  namespace?: string;
  query?: string;
  limit?: number;
  includeSchemas?: false;
};
type FabricDiscoveryListWithSchemasArgs = Omit<FabricDiscoveryListArgs, "includeSchemas"> & {
  includeSchemas: true;
};
type FabricDiscoverySearchArgs = { query: string; limit?: number; includeSchemas?: false };
type FabricDiscoverySearchWithSchemasArgs = Omit<FabricDiscoverySearchArgs, "includeSchemas"> & {
  includeSchemas: true;
};
interface FabricToolsApi {
  providers(): Promise<Array<{ name: string; description: string }>>;
  catalog(args?: { provider?: string; limit?: number }): Promise<FabricCapabilityCatalog>;
  list(args?: FabricDiscoveryListArgs): Promise<FabricActionSummary[]>;
  list(args: FabricDiscoveryListWithSchemasArgs): Promise<FabricAction[]>;
  search(query: string): Promise<FabricActionSummary[]>;
  search(args: FabricDiscoverySearchArgs): Promise<FabricActionSummary[]>;
  search(args: FabricDiscoverySearchWithSchemasArgs): Promise<FabricAction[]>;
  describe(args: { ref: string }): Promise<FabricAction>;
  call(args: { ref: string; args?: Record<string, unknown> }): Promise<unknown>;
  progress(args: { message: string }): Promise<void>;
}
interface FabricCapturedToolResult {
  content: Array<{ type: string; text?: string; [key: string]: unknown }>;
  text: string;
  details?: unknown;
  isError: boolean;
  terminate?: boolean;
  source: { path: string; source: string; scope: string; origin: string; baseDir?: string };
}
interface FabricCapturedTool {
  (args?: Record<string, unknown>): Promise<FabricCapturedToolResult>;
}
type FabricExtensionsApi = Record<string, FabricCapturedTool>;

type PiPathArgument = {
  path?: string;
  file?: string;
  absolutePath?: string;
  file_path?: string;
  filePath?: string;
  filepath?: string;
  pathname?: string;
  target_file?: string;
  targetFile?: string;
  absolute_path?: string;
  fileAbsolutePath?: string;
};
type PiOptionalPathArgument = {
  path?: string;
  file?: string;
  absolutePath?: string;
  file_path?: string;
  filePath?: string;
  filepath?: string;
  pathname?: string;
  target_file?: string;
  targetFile?: string;
  absolute_path?: string;
  fileAbsolutePath?: string;
  dir?: string;
  folder?: string;
  directory?: string;
  directoryPath?: string;
};
type PiOldTextArgument = {
  oldText?: string;
  old?: string;
  old_string?: string;
  oldString?: string;
  old_str?: string;
  oldStr?: string;
  from?: string;
  old_value?: string;
  old_text?: string;
  oldContent?: string;
  old_content?: string;
};
type PiNewTextArgument = {
  newText?: string;
  new?: string;
  replacement?: string;
  new_string?: string;
  newString?: string;
  new_str?: string;
  newStr?: string;
  to?: string;
  new_value?: string;
  new_text?: string;
  newContent?: string;
  new_content?: string;
};
type PiEditOperation = PiOldTextArgument & PiNewTextArgument & { all?: boolean };
type PiCommandArgument = {
  command?: string;
  cmd?: string;
  shell?: string;
  cmdline?: string;
  script?: string;
  commandLine?: string;
};
type PiContentArgument = {
  content?: string;
  contents?: string;
  body?: string;
  text?: string;
  data?: string;
  fileContent?: string;
};
type PiGrepPatternArgument = {
  pattern?: string;
  query?: string;
  regex?: string;
  search?: string;
  q?: string;
  expression?: string;
  text?: string;
};
type PiFindPatternArgument = {
  pattern?: string;
  query?: string;
  regex?: string;
  search?: string;
  name?: string;
  filename?: string;
  glob?: string;
  expression?: string;
  include?: string;
};
type PiReadOptions = { offset?: number; limit?: number; start?: number; max?: number };
type PiBashOptions = { timeout?: number; timeoutMs?: number; settle?: boolean };
type PiGrepOptions = {
  path?: string;
  glob?: string;
  globPattern?: string;
  ignoreCase?: boolean;
  ic?: boolean;
  caseInsensitive?: boolean;
  caseSensitive?: boolean;
  literal?: boolean;
  context?: number;
  ctx?: number;
  limit?: number;
  max?: number;
};
type PiFindOptions = { path?: string; limit?: number; max?: number };
type PiLsOptions = { limit?: number; max?: number };
type PiReadArgument = string | (PiPathArgument & PiReadOptions);
type PiBashArgument = string | (PiCommandArgument & PiBashOptions);
type PiEditFlatArgument = PiPathArgument & PiOldTextArgument & PiNewTextArgument & { all?: boolean };
type PiEditArgument = PiPathArgument & ({ edits: PiEditOperation[]; all?: boolean } | PiEditFlatArgument);
type PiWriteArgument = string | (PiPathArgument & PiContentArgument);
type PiGrepArgument = string | (PiGrepPatternArgument & PiGrepOptions);
type PiFindArgument = string | (PiFindPatternArgument & PiFindOptions);
type PiLsArgument = string | (PiOptionalPathArgument & PiLsOptions);
type PiNumericString<T> = T extends number ? T | string : T;
type PiNumericStringOptions<T> = { [K in keyof T]: PiNumericString<T[K]> };
type PiReadCompatibilityArgument = string | (PiPathArgument & PiNumericStringOptions<PiReadOptions>);
type PiBashCompatibilityArgument = string | (PiCommandArgument & PiNumericStringOptions<PiBashOptions>);
type PiEditCompatibilityArgument = PiEditFlatArgument;
type PiWriteCompatibilityArgument = PiWriteArgument;
type PiGrepCompatibilityArgument = string | (PiGrepPatternArgument & PiNumericStringOptions<PiGrepOptions>);
type PiFindCompatibilityArgument = string | (PiFindPatternArgument & PiNumericStringOptions<PiFindOptions>);
type PiLsCompatibilityArgument = string | (PiOptionalPathArgument & PiNumericStringOptions<PiLsOptions>);
interface PiToolsApi {
  read(args: PiReadArgument, options?: PiReadOptions): Promise<string>;
  bash(args: PiBashArgument, options?: PiBashOptions): Promise<{ ok: true; output: string; details: unknown } | { ok: false; output: string; details: null; exitCode: number; error: string }>;
  edit(args: PiEditArgument): Promise<{ ok: true; output: string; details: unknown }>;
  edit(path: string, oldText: string, newText: string): Promise<{ ok: true; output: string; details: unknown }>;
  write(args: PiWriteArgument): Promise<{ ok: true; output: string; details: unknown }>;
  write(path: string, content: string): Promise<{ ok: true; output: string; details: unknown }>;
  grep(args: PiGrepArgument): Promise<string>;
  grep(pattern: string, path?: string | PiGrepOptions, limit?: number): Promise<string>;
  find(args: PiFindArgument): Promise<string>;
  find(pattern: string, path?: string | PiFindOptions, limit?: number): Promise<string>;
  ls(args?: PiLsArgument, options?: PiLsOptions): Promise<string>;
}

interface FabricMcpResult {
  text: string;
  content: unknown[];
  structuredContent: unknown;
}
interface FabricMcpTool {
  (args?: Record<string, unknown>): Promise<FabricMcpResult | unknown>;
}
interface FabricMcpServer {
  [tool: string]: FabricMcpTool;
}
interface FabricMcpManagement {
  servers(): Promise<Array<{ name: string; description: string | null; transport: "http" | "stdio" }>>;
  reload(): Promise<{ servers: string[] }>;
  register(args: {
    name: string;
    description?: string;
    command?: string;
    args?: string[];
    cwd?: string;
    baseUrl?: string;
    headers?: Record<string, string>;
    env?: Record<string, string>;
    overwrite?: boolean;
  }): Promise<{ registered: string }>;
  call(args: { server: string; tool: string; args?: Record<string, unknown> }): Promise<unknown>;
}
type FabricMcpApi = Record<string, FabricMcpServer> & FabricMcpManagement;

declare const tools: FabricToolsApi;
declare const pi: PiToolsApi;
declare const extensions: FabricExtensionsApi;
declare const mcp: FabricMcpApi;
interface FabricConsole {
  log(...args: unknown[]): void;
  info(...args: unknown[]): void;
  warn(...args: unknown[]): void;
  error(...args: unknown[]): void;
}
declare const console: FabricConsole;
declare const π: Readonly<Record<string, string>>;
declare function print(...args: unknown[]): void;
declare function setTimeout(handler: (...args: any[]) => void, timeout?: number): number;
declare function clearTimeout(handle: number): void;
declare function setInterval(handler: (...args: any[]) => void, timeout?: number): number;
declare function clearInterval(handle: number): void;
`;

const PI_LOOSE_DECLARATION = "declare const pi: PiToolsApi;\n";
const MCP_LOOSE_DECLARATION = "declare const mcp: FabricMcpApi;\n";
const EXTENSIONS_LOOSE_DECLARATION = "declare const extensions: FabricExtensionsApi;\n";

export interface FabricGuestDeclarationOptions {
  excludeGlobals?: readonly string[];
  dynamic?: FabricDynamicGuestDeclarations;
  coreOverrides?: string;
}

const globalDeclarationLine = (name: string): RegExp =>
  new RegExp(`^declare const ${name}: [^\\n]*;\\n`, "m");

const terminatedDeclaration = (block: string): string =>
  block.endsWith("\n") ? block : `${block}\n`;

export const guestTypeDeclarations = (
  options: FabricGuestDeclarationOptions = {},
): string => {
  let result = (options.excludeGlobals ?? []).reduce(
    (declarations, name) => declarations.replace(globalDeclarationLine(name), ""),
    GUEST_TYPE_DECLARATIONS,
  );
  if (options.coreOverrides && result.includes(PI_LOOSE_DECLARATION)) {
    result = result.replace(PI_LOOSE_DECLARATION, terminatedDeclaration(options.coreOverrides));
  }
  if (options.dynamic?.mcp && result.includes(MCP_LOOSE_DECLARATION)) {
    result = result.replace(MCP_LOOSE_DECLARATION, terminatedDeclaration(options.dynamic.mcp));
  }
  if (options.dynamic?.extensions && result.includes(EXTENSIONS_LOOSE_DECLARATION)) {
    result = result.replace(
      EXTENSIONS_LOOSE_DECLARATION,
      terminatedDeclaration(options.dynamic.extensions),
    );
  }
  return result;
};
