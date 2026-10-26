import { describe, expect, it } from 'vitest'
import { applyEnvPlan, buildPaneEnv, paneEnvPlan } from '../../src/main/pane-env'
import {
  prepareRemote,
  preflightCommand,
  remoteBinPath,
  remoteTarget,
  uploadCommand
} from '../../src/main/remote-bin'
import { remotePlan } from '../../src/main/remote-plan'
import type { SpawnSpec } from '../../src/main/spawn-resolve'

const spec: SpawnSpec = {
  paneId: 'p-1',
  cli: 'claude',
  shell: false,
  configDir: '~/.wraithgrid/accounts/work',
  cwd: '~/proj',
  args: ['--model', 'opus'],
  resume: true,
  cols: 100,
  rows: 30
}

describe('remotePlan', () => {
  it('carries the rules; the machine fills in its own paths', () => {
    const plan = remotePlan(spec)
    expect(plan.candidates).toEqual(['claude'])
    expect(plan.args).toContain('--continue')
    expect(plan.cwd).toBe('~/proj')
    expect(plan.env.set).toMatchObject({
      CLAUDE_CONFIG_DIR: '~/.wraithgrid/accounts/work',
      WRAITHGRID_PANE: 'p-1',
      TERM: 'xterm-256color'
    })
    expect(plan.env.lang).toBe('C.UTF-8')
    expect(plan.approval).toBeTruthy()
    expect(plan.path.byKind.bash).toBeTruthy()
  })

  it('a shell pane tries $SHELL first and keeps the account dir vars out', () => {
    const plan = remotePlan({ ...spec, shell: true })
    expect(plan.candidates[0]).toBe('$SHELL')
    expect(plan.args).toEqual([])
    expect(plan.env.drop).not.toContain('CLAUDE_CONFIG_DIR')
    expect(plan.env.set.CLAUDE_CONFIG_DIR).toBeUndefined()
    expect(plan.approval).toBeUndefined()
  })

  it('applied locally, the plan builds the same env as a local pane', () => {
    const baseEnv = { PATH: '/usr/bin', TMUX: 'x', ELECTRON_RUN_AS_NODE: '1', KEEP: '1' }
    const input = {
      shell: false,
      cli: 'claude' as const,
      configDir: null,
      platform: 'linux' as const
    }
    const local = buildPaneEnv({ ...input, baseEnv, homeDir: '/h', modDirs: [] })
    expect(applyEnvPlan(baseEnv, paneEnvPlan(input), '/h')).toEqual(local)
  })
})

describe('the Rust host on a remote machine', () => {
  it('runs on Linux x64 and arm64 only', () => {
    expect(remoteTarget('Linux x86_64\n')).toBe('x86_64-unknown-linux-musl')
    expect(remoteTarget('Linux aarch64')).toBe('aarch64-unknown-linux-musl')
    expect(remoteTarget('Darwin arm64')).toBeNull()
    expect(remoteTarget('Linux riscv64')).toBeNull()
  })

  it('checks that the binary runs before trusting it', () => {
    expect(preflightCommand('1.2.3')).toContain(`${remoteBinPath('1.2.3')} --version`)
    expect(uploadCommand('1.2.3')).toMatch(/--version >\/dev\/null && mv -f/)
  })

  const deps = (stdout: string, binary: Buffer | null, uploadCode = 0) => {
    const runs: { command: string; input?: Buffer }[] = []
    return {
      runs,
      d: {
        version: '1.2.3',
        run: async (command: string, input?: Buffer) => {
          runs.push({ command, input })
          return input ? { code: uploadCode, stdout: '' } : { code: 0, stdout }
        },
        binary: async () => binary
      }
    }
  }
  const command = [remoteBinPath('1.2.3'), 'stdio', '1.2.3']

  it('uses the copy already there', async () => {
    const { d, runs } = deps('Linux x86_64\n__WRAITHGRID_HOST_PRESENT__\n', null)
    expect(await prepareRemote(d)).toEqual(command)
    expect(runs).toHaveLength(1)
  })

  it('copies this build’s binary when the machine has none', async () => {
    const bin = Buffer.from('elf')
    const { d, runs } = deps('Linux aarch64\n', bin)
    expect(await prepareRemote(d)).toEqual(command)
    expect(runs[1]?.input).toBe(bin)
  })

  it('falls back to wraithgrid host-stdio otherwise', async () => {
    expect(await prepareRemote(deps('Darwin arm64\n', Buffer.from('x')).d)).toBeNull()
    expect(await prepareRemote(deps('Linux x86_64\n', null).d)).toBeNull()
    expect(await prepareRemote(deps('Linux x86_64\n', Buffer.from('x'), 1).d)).toBeNull()
    expect(await prepareRemote({ ...deps('', null).d, version: '1; rm -rf ~' })).toBeNull()
  })
})
