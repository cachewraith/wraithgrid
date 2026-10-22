// What a CLI needs to drive the chat view (ADR 0002): the args that run it headless, the
// lines it is fed, and a decoder from its output to ChatEvents. One file per CLI next to
// this one; the session runner (sessions.ts) and the UI never branch on the CLI.
import type { AgentCli } from '@shared/agent-clis'
import type { ApprovalDecision, ChatEvent, ChatImage, ChatModel } from '@shared/chat'
import { createAgyAdapter } from './agy'
import { createClaudeAdapter } from './claude'
import { createCodexAdapter } from './codex'
import type { ChatMode } from '@shared/chat'

export interface Decoded {
  events: ChatEvent[]
  /** Lines to write back at once (an answer the CLI waits for). */
  replies: unknown[]
}

export interface ChatAdapter {
  /**
   * Args after the pane's own ones: resume `sessionId` (or the folder's last conversation),
   * with the chosen model and effort when set.
   */
  args(o: {
    sessionId: string | null
    continueLast: boolean
    model: string | null
    effort: string | null
    mode?: ChatMode | null
  }): string[]
  /** Lines written right after the process starts. */
  hello(): unknown[]
  /** The line that sends a message, or null when the adapter holds it until it is ready. */
  user(text: string, images: ChatImage[]): unknown | null
  /** The line that stops the running turn, or null when there is nothing to send now. */
  interrupt(): unknown | null
  /** The line that switches the model of the running session, or null when it can't. */
  setModel(model: string): unknown | null
  /** The line that switches the permission mode live, or null when it can't. */
  setMode?(mode: ChatMode): unknown | null
  /** The answer to an approval request, or null when it is not pending (any more). */
  answer(reqId: string, decision: ApprovalDecision): unknown | null
  /** One output line, already parsed from JSON. */
  decode(msg: unknown): Decoded
  /**
   * A CLI that doesn't say its models over the pipe: the command (run with the same binary,
   * env and folder) that lists them, and its parser. Sent as `capabilities` after the start.
   */
  listModels?: { args: string[]; parse(stdout: string): ChatModel[] }
}

const ADAPTERS: Partial<Record<AgentCli, () => ChatAdapter>> = {
  claude: createClaudeAdapter,
  agy: createAgyAdapter,
  codex: createCodexAdapter
}

/** A fresh adapter (they keep per-process state), or null when the CLI has no chat view. */
export function chatAdapterFor(cli: AgentCli): ChatAdapter | null {
  return ADAPTERS[cli]?.() ?? null
}
