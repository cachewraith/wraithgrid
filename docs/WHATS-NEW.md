# What's new in 1.7: claude mods

*v1.7.1 · 2026-10-13*

claude now has mods: plugins that change claude's own screen with side panes, a band above the
prompt, status lines, toasts and commands. Wraithgrid 1.7 draws them in every pane and adds a
**Mods** screen to find, install and switch them without leaving the app.

---

## At a glance

| Feature | How to use it |
|---|---|
| Open the Mods screen | Plug icon in the top bar, or **Ctrl+Shift+P** → **Mods** |
| Find and install a mod | **Mods → Browse**, search, **Install** |
| Turn a mod on or off | **Mods → Installed**, the switch beside it |
| Load a mod you are building | **Mods → Mod folders → Add folder…** |
| Smooth mod animation | **Mods → Draw panes with the GPU** |

---

## 1. Browse and install mods

**Mods → Browse** lists everything your account's claude marketplaces offer, a few thousand
mods and plugins, so you don't have to search GitHub. Type a name or what you want it to do;
the most installed come first. Each row shows the description, the marketplace and an **Install** button;
click the mod's name to open its repository.

- **Install** covers all your claude accounts at once, no account to pick. An account that
  lacks the mod's marketplace gets it added first.
- Pick **claudemod.com** above the search box for the mods that community list offers. It is
  not run by Anthropic or Wraithgrid; installing one adds its GitHub repository as a
  marketplace. The site is contacted only when you pick it.
- A mod runs as you, with your files and logins: install the ones you trust.
- The catalog holds every claude plugin, not only the ones that change the screen.
- A few mods install by running a command and need a confirmation claude only asks for in a
  terminal. Those show claude's message; install them with `/plugin` in a pane.

## 2. See and switch installed mods

**Mods → Installed** is one list for all your claude accounts, with each mod's version and
where it comes from. One switch enables or disables a mod in every account that has it, and
**Add to all accounts** hands a mod to the accounts that lack it. Wraithgrid asks each
account's own `claude` for this list; it does not open the plugin files itself.

A running claude loads mods when it starts: after a change, use **Restart claude panes**.

## 3. Mod folders for every pane

Building a mod, or keeping one in a folder of your own? Add the folder under **Mod folders**
and every claude pane in every account loads it, without installing it. claude reloads the mod
when its files change. Pick the mod's own folder, the one that holds
`.claude-plugin/plugin.json`.

## 4. Panes do what mods ask

- **Copy**: text a mod copies lands on your clipboard.
- **Notifications**: a mod's notification becomes a desktop notification for a pane you aren't
  looking at. claude only sends these once `preferredNotifChannel` in its settings is
  `ghostty`, `iterm2` or `kitty`; with one set, claude's own notices arrive as well.
- **Room**: a side pane a mod opens by itself needs 110 columns. The Mods screen tells you how
  many running panes are narrower; zoom a pane (**Ctrl+Shift+Z**) or shrink the text.
- **Animation**: turn on **Draw panes with the GPU** for mods that redraw many times a
  second. It is off by default; a pane that cannot get a GPU context keeps the standard
  renderer.

## Not there yet

- Pictures a mod draws show as their text description.
- A mod that redraws all the time (a clock, an animated band) makes its pane read "running",
  so that pane sends no "done" notification.
- Uninstalling and updating mods, and adding marketplaces, are still done with `/plugin` in a
  pane.
