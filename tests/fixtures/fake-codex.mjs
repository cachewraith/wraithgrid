#!/usr/bin/env node
// Stand-in for codex in E2E tests, with codex-cli 0.163.0's shapes
// (tests/fixtures/codex-chat.ndjson): `codex app-server` (JSON-RPC lines on stdio),
// `codex login --device-auth` (prints the link and code, signs in after a moment) and
// `codex login status`. "run it" asks before a command; "slow" streams until interrupted;
// anything else is echoed back with the turn's settings.
import fs from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import { clearInterval, setInterval, setTimeout } from 'node:timers'
import readline from 'node:readline'

const args = process.argv.slice(2)
const home = process.env.CODEX_HOME ?? ''
const auth = path.join(home, 'auth.json')

if (args[0] === 'login' && args[1] === 'status') {
  if (fs.existsSync(auth)) {
    process.stderr.write('Logged in using ChatGPT\n')
    process.exit(0)
  }
  process.stderr.write('Not logged in\n')
  process.exit(1)
}
if (args[0] === 'login') {
  process.stdout.write(
    '\nFollow these steps to sign in with ChatGPT using device code authorization:\n\n' +
      '1. Open this link in your browser and sign in to your account\n' +
      '   \x1b[94mhttps://auth.openai.com/codex/device\x1b[0m\n\n' +
      '2. Enter this one-time code \x1b[90m(expires in 15 minutes)\x1b[0m\n' +
      '   \x1b[94mFAKE-C0DE1\x1b[0m\n\n'
  )
  setTimeout(() => {
    fs.mkdirSync(home, { recursive: true })
    fs.writeFileSync(auth, '{}')
    process.stdout.write('Successfully logged in\n')
    process.exit(0)
  }, 800)
} else if (args[0] === 'app-server') {
  appServer()
} else {
  process.stdout.write(`fake codex terminal: ${args.join(' ')}\n`)
  process.stdin.pipe(process.stdout)
}

function appServer() {
  const send = (m) => process.stdout.write(`${JSON.stringify({ jsonrpc: '2.0', ...m })}\n`)
  const note = (method, params) => send({ method, params })
  let thread = null
  let n = 0
  let reqId = 0
  /** The running turn: its id, its stream timer, and an approval it waits on. */
  let turn = null
  const waitingApproval = new Map()

  const endTurn = (status) => {
    if (!turn) return
    clearInterval(turn.timer)
    note('turn/completed', {
      threadId: thread,
      turn: { id: turn.id, items: [], status, error: null, durationMs: 1200 }
    })
    turn = null
  }
  const say = (text) => {
    const id = `msg_${++n}`
    note('item/started', { item: { type: 'agentMessage', id, text: '' }, threadId: thread })
    for (const part of text.match(/.{1,12}/gs) ?? [])
      note('item/agentMessage/delta', { threadId: thread, itemId: id, delta: part })
    note('item/completed', { item: { type: 'agentMessage', id, text }, threadId: thread })
  }

  readline.createInterface({ input: process.stdin }).on('line', (line) => {
    let m
    try {
      m = JSON.parse(line)
    } catch {
      return
    }
    // Answers to our approval requests.
    if (!m.method && waitingApproval.has(m.id)) {
      const item = waitingApproval.get(m.id)
      waitingApproval.delete(m.id)
      note('serverRequest/resolved', { threadId: thread, requestId: m.id })
      const ok = m.result?.decision === 'accept' || m.result?.decision === 'acceptForSession'
      note('item/completed', {
        item: {
          ...item,
          status: ok ? 'completed' : 'declined',
          aggregatedOutput: ok ? 'build removed\n' : null,
          exitCode: ok ? 0 : null
        },
        threadId: thread
      })
      say(ok ? 'Ran it.' : 'Skipped it.')
      endTurn('completed')
      return
    }
    const p = m.params ?? {}
    switch (m.method) {
      case 'initialize':
        send({ id: m.id, result: { userAgent: 'fake', codexHome: home } })
        break
      case 'thread/start':
      case 'thread/resume':
        thread = m.method === 'thread/resume' ? p.threadId : 'cx-new'
        send({ id: m.id, result: { thread: { id: thread }, model: p.model ?? 'gpt-fake' } })
        break
      case 'thread/list':
        send({ id: m.id, result: { data: [], nextCursor: null } })
        break
      case 'model/list':
        send({
          id: m.id,
          result: {
            data: [
              {
                id: 'gpt-fake',
                displayName: 'GPT-Fake',
                description: 'The default',
                hidden: false,
                supportedReasoningEfforts: [{ reasoningEffort: 'low' }, { reasoningEffort: 'high' }]
              },
              {
                id: 'gpt-mini',
                displayName: 'GPT-Mini',
                description: 'Small',
                hidden: false,
                supportedReasoningEfforts: []
              }
            ],
            nextCursor: null
          }
        })
        break
      case 'account/read':
        send({
          id: m.id,
          result: {
            account: { type: 'chatgpt', email: 'me@example.com', planType: 'plus' },
            requiresOpenaiAuth: true
          }
        })
        break
      case 'account/rateLimits/read':
        send({
          id: m.id,
          result: {
            rateLimits: {
              primary: { usedPercent: 12, windowDurationMins: 300, resetsAt: 1900000000 },
              secondary: { usedPercent: 40, windowDurationMins: 10080, resetsAt: 1900500000 }
            }
          }
        })
        break
      case 'turn/interrupt':
        send({ id: m.id, result: {} })
        endTurn('interrupted')
        break
      case 'turn/start': {
        const text = (p.input ?? []).map((i) => i.text ?? `[${i.type}]`).join(' ')
        const id = `turn-${++n}`
        turn = { id, timer: null }
        send({ id: m.id, result: { turn: { id, items: [], status: 'inProgress' } } })
        note('turn/started', { threadId: thread, turn: { id, items: [], status: 'inProgress' } })
        if (text.includes('run it')) {
          const item = {
            type: 'commandExecution',
            id: 'exec-1',
            command: "/usr/bin/bash -lc 'rm -rf build'",
            commandActions: [{ type: 'unknown', command: 'rm -rf build' }],
            status: 'inProgress',
            aggregatedOutput: null,
            exitCode: null
          }
          note('item/started', { item, threadId: thread, turnId: id })
          const rid = reqId++
          waitingApproval.set(rid, item)
          send({
            id: rid,
            method: 'item/commandExecution/requestApproval',
            params: {
              threadId: thread,
              turnId: id,
              itemId: 'exec-1',
              command: item.command,
              commandActions: item.commandActions
            }
          })
        } else if (text.includes('slow')) {
          const mid = `msg_${++n}`
          note('item/started', {
            item: { type: 'agentMessage', id: mid, text: '' },
            threadId: thread
          })
          turn.timer = setInterval(
            () => note('item/agentMessage/delta', { threadId: thread, itemId: mid, delta: '.' }),
            200
          )
        } else {
          say(
            `Hello from **fake** codex: ${text} (thread ${thread}, model ${p.model ?? 'default'}, effort ${p.effort ?? 'default'}, approval ${p.approvalPolicy}, sandbox ${p.sandboxPolicy?.type})`
          )
          endTurn('completed')
        }
        break
      }
      default:
        if (m.id !== undefined) send({ id: m.id, result: {} })
    }
  })
}
