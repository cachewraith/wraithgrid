# Making a Wraithgrid theme

The easiest way: **Settings → Appearance → Customize…** edits a copy of any theme live over the
whole app, warns when text gets hard to read, and saves it as a new theme (or exports the
file). Everything below is what that file holds, for editing by hand.

A theme is one JSON file: colors, plus an optional `style` for fonts, shape, depth, density
and motion. Import it from **Settings → Appearance → Import theme…**;
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
  },
  "style": {
    "radius": "large",
    "depth": "deep",
    "density": "spacious"
  }
}
```

Only `name`, `mode` (`dark` or `light`), `colors.bg`, `colors.text` and `colors.accent` are
required. Anything else you leave out is mixed from those three, so a three-color theme still
looks finished.

Every color must be a hex color: `#rgb`, `#rrggbb` or `#rrggbbaa`, and every `style` value
one of the options below. Nothing else is accepted (no CSS, no `rgb()`, no font files), and a file with a mistake is listed in Appearance with the reason instead
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
| `userBubble` | your messages in a chat (default: the accent mixed into `raised`) |
| `codeBlock` | code blocks in chat answers |
| `diffAdd`, `diffDel` | added and removed lines in diffs (use an alpha, e.g. `#4ade801f`) |

## `style` (optional)

| Key | Options | Default |
|---|---|---|
| `font` | `Geist`, `System`, `Inter`, `IBM Plex Sans`, `Source Sans 3`, `Noto Sans` | `Geist` |
| `monoFont` | `JetBrains Mono`, `System`, `IBM Plex Mono`, `Fira Code`, `Cascadia Code` | `JetBrains Mono` |
| `chatTextSize` | whole number 13–17 (px) | 14.5 |
| `radius` | `small`, `medium`, `large` (scales every rounded corner) | `medium` |
| `border` | `thin` (1px), `thick` (1.5px) on the main cards | `thin` |
| `depth` | `flat`, `soft`, `deep` shadows on cards, menus and dialogs | `soft` |
| `density` | `compact`, `comfortable`, `spacious` | `comfortable` |
| `motion` | `on`, `reduced` (no animations), `off` (no animations or transitions) | `on` |
| `frameGradient` | `true` for a faint accent glow over the window frame | `false` |

Geist and JetBrains Mono come with Wraithgrid; the other fonts are used when installed on the
computer, else Geist / JetBrains Mono. The system's reduce-motion setting always wins over
`motion`. Files without `style` look as they always did.

## `terminal` (optional)

`background`, `foreground`, `cursor`, `selection` and the 16 ANSI colors: `black`, `red`,
`green`, `yellow`, `blue`, `magenta`, `cyan`, `white`, and `brightBlack` … `brightWhite`.
Without them, terminals use the theme's own colors (status colors for red, green, yellow and
cyan). They apply when **Terminal colors** is **Match app**.

The file's name in `~/.wraithgrid/themes/` is its id: lowercase letters, digits and `-`.
Files can be at most 64 KB; up to 100 are loaded.
