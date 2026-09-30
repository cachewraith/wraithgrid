# Changelog

## 2026-09-30

- [ci] Build installers only on release tags; push/PR runs checks only, docs-only changes skip CI (files: .github/workflows/build.yml, .github/workflows/release.yml)
- [docs] Add the AI Working Agreement and context files (files: CLAUDE.md, CHANGELOG.md, docs/CONTEXT.md, docs/ARCHITECTURE.md, docs/DECISIONS.md, docs/TODO.md)

## 2026-09-29

- [docs] Add README screenshots and restructure the README (files: README.md, docs/screenshots/)
- [release] v1.1.0 (files: package.json)
- [ci] Fix the Windows lint and Linux e2e failures; publish a GitHub release on version tags (files: .github/workflows/)
- [settings] Add appearance options (theme, accent, palette, font) and the update check (files: src/main/update-check.ts, src/renderer/components/SettingsView.tsx)
- [platform] Add Windows, Linux distro packages, tiling compositors, and shared CLAUDE.md/skills (files: src/main/platform.ts, src/main/shared-config.ts, electron-builder.yml)
- [m5] Add packaging, the README, and shutdown hardening
- [m1-m4] Add the PTY grid with accounts, layouts, and persistence
