# Making a Wraithgrid theme

A theme is one JSON file of colors. Import it from **Settings → Appearance → Import theme…**;
Wraithgrid checks it and saves a copy in `~/.wraithgrid/themes/`. To share a theme, send the
file. To start from a built-in one, right-click its card → **Export as a starting point…**.

```json
{
  "name": "Ocean",
  "mode": "dark",
  "author": "you",
  "colors": {
    "bg": "#0f1a24",
    "text": "#e6f1ff",
    "accent": "#38bdf8"
  },
  "terminal": {
    "red": "#ff6b81"
  }
}
```

Only `name`, `mode` (`dark` or `light`), `colors.bg`, `colors.text` and `colors.accent` are
required. Anything else you leave out is mixed from those three, so a three-color theme still
looks finished.

Every value must be a hex color: `#rgb`, `#rrggbb` or `#rrggbbaa`. Nothing else is accepted
(no CSS, no `rgb()`), and a file with a mistake is listed in Appearance with the reason instead
of being applied.

## `colors`

| Key | What it colors |
|---|---|
| `bg` | main area background (required) |
| `text` | main text (required) |
| `accent` | buttons, focus, selection, cursor (required) |
| `sidebar` | sidebar and pane headers |
| `panel` | menus, dialogs, cards |
| `raised` | raised controls, the selected toggle |
| `line`, `lineStrong` | borders, quiet and strong |
| `muted`, `faint` | secondary and hint text |
| `accentText` | accent-colored text and links |
| `accentFill`, `accentFillHover`, `onAccent` | filled accent buttons and the text on them |
| `terminal` | terminal background |
| `ok`, `warn`, `err`, `info` | status colors (running, needs you, errors, info) |
| `selection`, `hover` | selected and hovered rows |
| `frame` | the window around the sidebar and main panels |

## `terminal` (optional)

`background`, `foreground`, `cursor`, `selection` and the 16 ANSI colors: `black`, `red`,
`green`, `yellow`, `blue`, `magenta`, `cyan`, `white`, and `brightBlack` … `brightWhite`.
Without them, terminals use the theme's own colors (status colors for red, green, yellow and
cyan). They apply when **Terminal colors** is **Match app**.

The file's name in `~/.wraithgrid/themes/` is its id: lowercase letters, digits and `-`.
Files can be at most 64 KB; up to 100 are loaded.
