// What a CLI needs to drive the chat view (ADR 0002): the args that run it headless, the
// lines it is fed, and a decoder from its output to ChatEvents. One file per CLI next to
// this one; the session runner (sessions.ts) and the UI never branch on the CLI.
import type { AgentCli } from '@shared/agent-clis'
import type { ApprovalDecision, ChatEvent, ChatImage } from '@shared/chat'
import { createClaudeAdapter } from './claude'

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
  }): string[]
  /** Lines written right after the process starts. */
  hello(): unknown[]
  user(text: string, images: ChatImage[]): unknown
  /** The line that stops the running turn, or null when the process must be signalled. */
  interrupt(): unknown | null
  /** The line that switches the model of the running session, or null when it can't. */
  setModel(model: string): unknown | null
  /** The answer to an approval request, or null when it is not pending (any more). */
  answer(reqId: string, decision: ApprovalDecision): unknown | null
  /** One output line, already parsed from JSON. */
  decode(msg: unknown): Decoded
}

const ADAPTERS: Partial<Record<AgentCli, () => ChatAdapter>> = {
  claude: createClaudeAdapter
}

/** A fresh adapter (they keep per-process state), or null when the CLI has no chat view. */
export function chatAdapterFor(cli: AgentCli): ChatAdapter | null {
  return ADAPTERS[cli]?.() ?? null
}
