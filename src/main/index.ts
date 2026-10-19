// Entry: `wraithgrid <command>` runs the command line (cli-entry.ts) and exits; anything
// else opens the app (app.ts). Decided before the app takes its single-instance lock.
import { spawnSync } from 'node:child_process'
import path from 'node:path'
import { app } from 'electron'
import { isCliCommand } from './cli'
import { userDataDir } from './paths'

// Packaged, argv is [binary, ...args]; in development [electron, script, ...args].
const argv = process.argv.slice(app.isPackaged ? 1 : 2)

if (isCliCommand(argv[0])) {
  // Synchronous on purpose: Electron starts its window system once this script yields,
  // which fails without a display (ssh). The command itself runs as plain Node.
  const r = spawnSync(process.execPath, [path.join(__dirname, 'cli.js'), ...argv], {
    stdio: 'inherit',
    env: {
      ...process.env,
      ELECTRON_RUN_AS_NODE: '1',
      WRAITHGRID_CLI_USER_DATA: userDataDir(app.getPath('appData'), process.env),
      WRAITHGRID_CLI_VERSION: app.getVersion()
    }
  })
  process.exit(r.status ?? 1)
} else {
  void import('./app')
}
