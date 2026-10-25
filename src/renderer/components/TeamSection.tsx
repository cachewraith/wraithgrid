// A project's team on its screen (#79): agents saved once, started together as chats.
import { useState, type MouseEvent } from 'react'
import { AGENT_CLI_SPECS } from '@shared/agent-clis'
import { CHAT_EFFORTS, CHAT_MODES, CHAT_MODE_LABEL, CHAT_MODEL_PATTERN } from '@shared/chat'
import { TEAM_MAX, type TeamAgent, type Workspace } from '@shared/types'
import { useActions, useApp } from '../app/services'
import { newId } from '../lib/ids'
import { planTeam, teamBranch, teamWarnings } from '../lib/team'
import { ContextMenu, menuPoint, type MenuPoint } from './ContextMenu'
import { Dialog } from './Dialog'
import { ProviderLogo } from './ProviderLogo'
import { IconBranch, IconFolder, IconMore, IconPlay, IconPlus, IconStop } from './icons'

const RUNNING = new Set(['running', 'starting', 'approval', 'background'])

function blank(accountId: string | null): TeamAgent {
  return {
    id: newId('t'),
    role: '',
    accountId,
    model: null,
    effort: null,
    chatMode: null,
    prompt: '',
    folder: 'worktree'
  }
}

/** "opus · high · plan", or "default" when nothing is set. */
function settingsLine(a: TeamAgent): string {
  const parts = [a.model, a.effort, a.chatMode ? CHAT_MODE_LABEL[a.chatMode].toLowerCase() : null]
  return parts.filter(Boolean).join(' · ') || 'default'
}

export function TeamSection({ ws }: { ws: Workspace }) {
  const actions = useActions()
  const accounts = useApp((s) => s.config.accounts)
  const runtime = useApp((s) => s.runtime)
  const [editing, setEditing] = useState<TeamAgent | null>(null)
  const [menu, setMenu] = useState<{ at: MenuPoint; agent: TeamAgent } | null>(null)

  const paneOf = (a: TeamAgent) => ws.panes.find((p) => p.teamAgentId === a.id)
  const running = ws.team.filter((a) => paneOf(a)).length
  const stateOf = (a: TeamAgent): { text: string; tone: string } => {
    if (editing?.id === a.id) return { text: 'editing', tone: '' }
    if (!accounts.some((x) => x.id === a.accountId)) return { text: 'skipped', tone: '' }
    const pane = paneOf(a)
    if (!pane) return { text: 'not started', tone: '' }
    const st = runtime[pane.id]?.status ?? 'starting'
    if (st === 'approval') return { text: 'approve', tone: ' warn' }
    return RUNNING.has(st) ? { text: 'working', tone: ' working' } : { text: 'idle', tone: '' }
  }
  const openMenu = (agent: TeamAgent) => (e: MouseEvent<HTMLElement>) => {
    e.preventDefault()
    setMenu({ at: menuPoint(e), agent })
  }

  return (
    <section className="team" aria-label="Team">
      <div className="team-hd">
        <h2 className="pj-h">Team</h2>
        <span className="team-n">
          {ws.team.length === 0
            ? 'Save a set of agents and start them together'
            : running
              ? `${running} of ${ws.team.length} running`
              : `${ws.team.length} ${ws.team.length === 1 ? 'agent' : 'agents'}`}
        </span>
        {ws.team.length ? (
          running ? (
            <button className="btn gh" onClick={() => actions.stopTeam(ws.id)}>
              <IconStop small />
              Stop team
            </button>
          ) : (
            <button className="btn pri" onClick={() => void actions.startTeam(ws.id)}>
              <IconPlay small />
              Start team
            </button>
          )
        ) : null}
      </div>
      <div className="team-list">
        {ws.team.map((a) => {
          const account = accounts.find((x) => x.id === a.accountId)
          const st = stateOf(a)
          return (
            <div key={a.id}>
              <div
                className={`team-row${editing?.id === a.id ? ' sel' : ''}`}
                onContextMenu={openMenu(a)}
              >
                <span className="team-role">{a.role}</span>
                <span className="team-acct">
                  {account ? (
                    <>
                      <ProviderLogo cli={account.cli} fallbackName={account.name} size={13} />
                      {account.name}
                    </>
                  ) : (
                    <span className="team-warn">Account missing</span>
                  )}
                </span>
                <span className="team-m">{settingsLine(a)}</span>
                <span className="team-m team-fold">
                  {a.folder === 'worktree' ? <IconBranch small /> : <IconFolder small />}
                  {a.folder === 'worktree' ? teamBranch(a.role) : 'project folder'}
                </span>
                <span className={`team-m team-st sch-st${st.tone}`}>{st.text}</span>
                <button
                  className="icon-btn sm"
                  aria-label={`Agent ${a.role}`}
                  aria-haspopup="menu"
                  onClick={openMenu(a)}
                >
                  <IconMore small />
                </button>
              </div>
              {editing?.id === a.id ? (
                <AgentForm
                  agent={editing}
                  onCancel={() => setEditing(null)}
                  onRemove={() => {
                    actions.removeTeamAgent(ws.id, a.id)
                    setEditing(null)
                  }}
                  onSave={(next) => {
                    actions.saveTeamAgent(ws.id, next)
                    setEditing(null)
                  }}
                />
              ) : null}
            </div>
          )
        })}
        {editing && !ws.team.some((a) => a.id === editing.id) ? (
          <AgentForm
            agent={editing}
            onCancel={() => setEditing(null)}
            onSave={(next) => {
              actions.saveTeamAgent(ws.id, next)
              setEditing(null)
            }}
          />
        ) : ws.team.length < TEAM_MAX ? (
          <button
            className="team-add"
            onClick={() => setEditing(blank(ws.accountId ?? accounts[0]?.id ?? null))}
          >
            <IconPlus small />
            Add agent
          </button>
        ) : null}
      </div>
      {menu ? (
        <ContextMenu
          at={menu.at}
          label={`Agent ${menu.agent.role}`}
          onClose={() => setMenu(null)}
          items={[
            { label: 'Edit', onSelect: () => setEditing(menu.agent) },
            {
              label: paneOf(menu.agent) ? 'Show this agent' : 'Start this agent',
              onSelect: () => void actions.startTeam(ws.id, { only: menu.agent.id })
            },
            {
              label: 'Remove',
              danger: true,
              divider: true,
              onSelect: () => actions.removeTeamAgent(ws.id, menu.agent.id)
            }
          ]}
        />
      ) : null}
    </section>
  )
}

function AgentForm({
  agent,
  onSave,
  onCancel,
  onRemove
}: {
  agent: TeamAgent
  onSave: (a: TeamAgent) => void
  onCancel: () => void
  onRemove?: () => void
}) {
  const accounts = useApp((s) => s.config.accounts)
  const [a, setA] = useState(agent)
  const set = (patch: Partial<TeamAgent>): void => setA((cur) => ({ ...cur, ...patch }))
  const modelOk = !a.model || CHAT_MODEL_PATTERN.test(a.model)
  const ok = a.role.trim() !== '' && !!a.accountId && modelOk

  return (
    <form
      className="team-edit"
      aria-label={agent.role ? `Edit ${agent.role}` : 'New agent'}
      onSubmit={(e) => {
        e.preventDefault()
        if (ok) onSave({ ...a, role: a.role.trim(), prompt: a.prompt.trim() })
      }}
    >
      <label className="team-f">
        <span>Role</span>
        <input
          className="inpt sans"
          value={a.role}
          maxLength={40}
          placeholder="Reviewer"
          autoFocus
          onChange={(e) => set({ role: e.target.value })}
        />
      </label>
      <label className="team-f">
        <span>Account</span>
        <select
          className="inpt sans"
          value={a.accountId ?? ''}
          onChange={(e) => set({ accountId: e.target.value || null })}
        >
          {a.accountId && !accounts.some((x) => x.id === a.accountId) ? (
            <option value={a.accountId}>Account missing</option>
          ) : null}
          {accounts.map((x) => (
            <option key={x.id} value={x.id}>
              {x.name} · {AGENT_CLI_SPECS[x.cli].label}
            </option>
          ))}
        </select>
      </label>
      <div className="team-f team-3">
        <label className="team-f">
          <span>Model</span>
          <input
            className="inpt sans"
            value={a.model ?? ''}
            placeholder="default"
            aria-invalid={!modelOk}
            onChange={(e) => set({ model: e.target.value.trim() || null })}
          />
        </label>
        <label className="team-f">
          <span>Effort</span>
          <select
            className="inpt sans"
            value={a.effort ?? ''}
            onChange={(e) => set({ effort: (e.target.value || null) as TeamAgent['effort'] })}
          >
            <option value="">default</option>
            {CHAT_EFFORTS.map((x) => (
              <option key={x} value={x}>
                {x}
              </option>
            ))}
          </select>
        </label>
        <label className="team-f">
          <span>Mode</span>
          <select
            className="inpt sans"
            value={a.chatMode ?? 'default'}
            onChange={(e) =>
              set({
                chatMode:
                  e.target.value === 'default' ? null : (e.target.value as TeamAgent['chatMode'])
              })
            }
          >
            {CHAT_MODES.map((x) => (
              <option key={x} value={x}>
                {CHAT_MODE_LABEL[x]}
              </option>
            ))}
          </select>
        </label>
      </div>
      <label className="team-f team-wide">
        <span>
          First message <em>optional, sent when it starts</em>
        </span>
        <textarea
          className="inpt sans"
          rows={3}
          maxLength={4000}
          value={a.prompt}
          placeholder="You review every change in this repo for security and missing tests."
          onChange={(e) => set({ prompt: e.target.value })}
        />
      </label>
      <fieldset className="team-f team-wide team-folder">
        <legend>Folder</legend>
        <label>
          <input
            type="radio"
            name={`fold-${a.id}`}
            checked={a.folder === 'worktree'}
            onChange={() => set({ folder: 'worktree' })}
          />
          <span>
            Its own branch folder <code>{teamBranch(a.role)}</code>
            <small>
              A git worktree under ~/.wraithgrid/worktrees, so agents can't overwrite each other.
              Not a git repo: the project folder, with a notice.
            </small>
          </span>
        </label>
        <label>
          <input
            type="radio"
            name={`fold-${a.id}`}
            checked={a.folder === 'shared'}
            onChange={() => set({ folder: 'shared' })}
          />
          <span>
            The project folder
            <small>Shared with the other agents: they can overwrite each other's edits.</small>
          </span>
        </label>
      </fieldset>
      <div className="team-ft">
        {onRemove ? (
          <button type="button" className="btn gh" onClick={onRemove}>
            Remove
          </button>
        ) : null}
        <span className="team-sp" />
        <button type="button" className="btn gh" onClick={onCancel}>
          Cancel
        </button>
        <button type="submit" className="btn" disabled={!ok}>
          Save
        </button>
      </div>
    </form>
  )
}

/** Before Start team: agents whose account is missing or at its limit. */
export function StartTeamDialog({ wsId, only }: { wsId: string; only: string | null }) {
  const actions = useActions()
  const ws = useApp((s) => s.config.workspaces.find((w) => w.id === wsId))
  const accounts = useApp((s) => s.config.accounts)
  const limits = useApp((s) => s.usage.limits)
  const [now] = useState(() => Date.now())
  if (!ws) return null
  const team = only ? ws.team.filter((a) => a.id === only) : ws.team
  const warnings = teamWarnings(planTeam(team, accounts, ws.panes), limits, now)
  return (
    <Dialog onClose={actions.closeModal} className="w4" role="alertdialog" labelledBy="team-st-t">
      <div className="dlg-hd">
        <h2 id="team-st-t">Start the team?</h2>
      </div>
      <div className="dlg-bd">
        <p className="hint" style={{ fontSize: 13, color: 'var(--mu)', margin: '0 0 10px' }}>
          Some agents may not run:
        </p>
        <ul className="team-warns">
          {warnings.map((w) => {
            const account = accounts.find((x) => x.id === w.agent.accountId)
            return (
              <li key={w.agent.id}>
                {account ? <ProviderLogo cli={account.cli} size={13} /> : null}
                <span>{w.agent.role}</span>
                {account ? <span className="team-m">{account.name}</span> : null}
                <span className="team-sp" />
                <span className="team-m team-warn">{w.text}</span>
              </li>
            )
          })}
        </ul>
      </div>
      <div className="dlg-ft">
        <button className="btn gh" onClick={actions.closeModal} data-autofocus>
          Cancel
        </button>
        <button className="btn" onClick={() => void actions.startTeam(wsId, { only, force: true })}>
          Start anyway
        </button>
      </div>
    </Dialog>
  )
}

/** Before Stop team while an agent is working. */
export function StopTeamDialog({ wsId }: { wsId: string }) {
  const actions = useActions()
  return (
    <Dialog onClose={actions.closeModal} className="w4" role="alertdialog" labelledBy="team-sp-t">
      <div className="dlg-hd">
        <h2 id="team-sp-t">Stop the team?</h2>
      </div>
      <div className="dlg-bd">
        <p className="hint" style={{ fontSize: 13, color: 'var(--mu)', margin: 0 }}>
          An agent is still working and will be stopped. Its chat goes to History.
        </p>
      </div>
      <div className="dlg-ft">
        <button className="btn gh" onClick={actions.closeModal} data-autofocus>
          Keep running
        </button>
        <button className="btn dng" onClick={() => actions.stopTeam(wsId, true)}>
          Stop team
        </button>
      </div>
    </Dialog>
  )
}
