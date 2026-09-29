import fs from 'node:fs'
import path from 'node:path'
import { defaultConfig, parseConfig } from '@shared/schema'
import type { SimpleResult } from '@shared/ipc-contract'
import type { Config } from '@shared/types'

export interface ConfigStoreOptions {
  debounceMs?: number
  now?: () => Date
  log?: (msg: string) => void
}

/** Writes via a temp file + rename so a crash mid-write never leaves a torn config. */
export async function writeFileAtomic(file: string, data: string): Promise<void> {
  const tmp = `${file}.${process.pid}.${Date.now()}.tmp`
  const handle = await fs.promises.open(tmp, 'w', 0o600)
  try {
    await handle.writeFile(data, 'utf8')
    await handle.sync()
  } finally {
    await handle.close()
  }
  try {
    await fs.promises.rename(tmp, file)
  } catch (err) {
    await fs.promises.rm(tmp, { force: true })
    throw err
  }
}

/**
 * The single owner of config.json. Keeps the validated config in memory, saves it
 * debounced, and never lets a corrupt file stop the app from starting.
 */
export class ConfigStore {
  private config: Config = defaultConfig()
  private timer: NodeJS.Timeout | null = null
  private dirty = false
  private writing: Promise<void> = Promise.resolve()
  private readonly debounceMs: number
  private readonly now: () => Date
  private readonly log: (msg: string) => void

  constructor(
    readonly file: string,
    opts: ConfigStoreOptions = {}
  ) {
    this.debounceMs = opts.debounceMs ?? 300
    this.now = opts.now ?? (() => new Date())
    this.log = opts.log ?? ((msg) => console.warn(`[wraithgrid] ${msg}`))
  }

  /** Reads the file once at startup. Missing → defaults. Corrupt → backed up, then defaults. */
  load(): Config {
    let text: string
    try {
      text = fs.readFileSync(this.file, 'utf8')
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'ENOENT') {
        this.log(`could not read config: ${(err as Error).message}`)
      }
      this.config = defaultConfig()
      return this.config
    }

    let raw: unknown
    let error: string | null = null
    try {
      raw = JSON.parse(text)
    } catch (err) {
      error = `invalid JSON: ${(err as Error).message}`
    }
    if (error === null) {
      const parsed = parseConfig(raw)
      if (parsed.ok) {
        this.config = parsed.config
        return this.config
      }
      error = parsed.error
    }

    const backup = this.backupPath()
    try {
      fs.renameSync(this.file, backup)
      this.log(`config was corrupt (${error.split('\n')[0]}); moved it to ${backup}`)
    } catch (err) {
      this.log(`config was corrupt and could not be backed up: ${(err as Error).message}`)
    }
    this.config = defaultConfig()
    return this.config
  }

  get(): Config {
    return this.config
  }

  /** Validates untrusted input (it arrives over IPC) before it replaces the config. */
  set(raw: unknown): SimpleResult {
    const parsed = parseConfig(raw, { migrate: false })
    if (!parsed.ok) return { ok: false, error: parsed.error }
    this.config = parsed.config
    this.scheduleSave()
    return { ok: true }
  }

  /** Writes any pending change now. Called on quit. */
  async flush(): Promise<void> {
    if (this.timer) {
      clearTimeout(this.timer)
      this.timer = null
    }
    if (this.dirty) this.writeNow()
    await this.writing
  }

  private scheduleSave(): void {
    this.dirty = true
    if (this.timer) clearTimeout(this.timer)
    this.timer = setTimeout(() => {
      this.timer = null
      this.writeNow()
    }, this.debounceMs)
  }

  private writeNow(): void {
    this.dirty = false
    const data = JSON.stringify(this.config, null, 2) + '\n'
    // Chain writes so two renames never race.
    this.writing = this.writing
      .then(async () => {
        await fs.promises.mkdir(path.dirname(this.file), { recursive: true })
        await writeFileAtomic(this.file, data)
      })
      .catch((err: Error) => this.log(`could not save config: ${err.message}`))
  }

  private backupPath(): string {
    const ts = this.now().toISOString().replace(/[:.]/g, '-')
    return path.join(path.dirname(this.file), `config.bad-${ts}.json`)
  }
}
