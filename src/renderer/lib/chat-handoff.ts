// Cross-CLI handoffs (#78) carry visible text only; newest messages survive the size cap.
import { AGENT_PROVIDER_LABEL, type AgentCli } from '@shared/agent-clis'
import type { ChatItem } from './chat-thread'

export interface ChatHandoff {
  text: string
  messages: number
  fromCli: AgentCli
}

export function buildHandoff(
  items: ChatItem[],
  cli: AgentCli,
  account: string,
  maxChars = 20_000,
  maxMessages = 60
): ChatHandoff {
  const header = `Continuing a conversation from ${AGENT_PROVIDER_LABEL[cli]} (${account}):\n\n`
  let remaining = Math.max(0, maxChars - header.length)
  const parts: string[] = []
  for (let i = items.length - 1; i >= 0 && parts.length < maxMessages; i--) {
    const item = items[i]!
    if ((item.kind !== 'user' && item.kind !== 'assistant') || !item.text.trim()) continue
    const prefix = `${item.kind}: `
    const gap = parts.length ? 2 : 0
    if (remaining <= prefix.length + gap) break
    const available = remaining - prefix.length - gap
    const text = item.text.length > available ? item.text.slice(-available) : item.text
    parts.unshift(prefix + text)
    remaining -= prefix.length + text.length + gap
    if (text.length !== item.text.length) break
  }
  return {
    text: (header + parts.join('\n\n')).slice(0, maxChars),
    messages: parts.length,
    fromCli: cli
  }
}
