/** The complete IPC surface. Nothing else crosses the preload bridge. */
export const IPC = {
  ptyCreate: 'pty:create',
  ptyWrite: 'pty:write',
  ptyResize: 'pty:resize',
  ptyKill: 'pty:kill',
  ptyData: 'pty:data',
  ptyExit: 'pty:exit',
  configGet: 'config:get',
  configSet: 'config:set',
  dialogPickFolder: 'dialog:pickFolder',
  dialogPickFile: 'dialog:pickFile',
  windowMinimize: 'window:minimize',
  windowMaximize: 'window:maximize',
  windowClose: 'window:close',
  claudeDetect: 'claude:detect',
  accountCreateDir: 'account:createDir',
  accountDeleteDir: 'account:deleteDir',
  shellOpenExternal: 'shell:openExternal',
  sharedApply: 'shared:apply',
  appInfo: 'app:info'
} as const
