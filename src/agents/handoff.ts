import type {
  AgentSessionSeed,
  HandoffCompactionRequest,
} from "./types.js";
import type { ThinkingTransferInput } from "./thinking-transfer.js";

/**
 * Compatibility boundary for the upstream AgentManager. Lean V2 never builds
 * `sessionSeed`, so this path is intentionally unreachable from the public
 * subagent surface. Keep the failure explicit instead of retaining the full
 * trajectory handoff + main-session compaction runtime.
 */
export const writeHandoffSession = (
  _seed: AgentSessionSeed,
  _cwd: string,
  _directory: string,
  _transfer?: ThinkingTransferInput,
  _compaction?: HandoffCompactionRequest,
): string => {
  throw new Error(
    "Trajectory handoff is not supported by the lean Code Mode runtime; use a named one-shot subagent instead",
  );
};
