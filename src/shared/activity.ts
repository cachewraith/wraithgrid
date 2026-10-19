// Timing that turns pane output into a status, shared by the window (pane badges) and the
// background host (`wraithgrid wait`), so both read a pane the same way.

/** Output within this window counts as "running"; quieter panes are idle. */
export const RUNNING_WINDOW_MS = 1200
/** Output this soon after a keypress is treated as echo, not work. */
export const ECHO_WINDOW_MS = 250
