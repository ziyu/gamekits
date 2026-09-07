# Changesets

GameKits uses Changesets to automate package version PRs and release publishing.

- Current prerelease mode: `alpha`.
- Current publish scope: `@gamekits/*`.
- Internal workspace package names remain `@gamekits/*`; release staging maps them to `@gamekits/*`.
- Public packages are versioned as a fixed lockstep group.
- `@gamekits/platform-tauri` stays ignored until the Wave 4 Tauri validation path is ready.

For ordinary package changes, add a changeset with:

```bash
corepack pnpm changeset
```

When the alpha phase is ready to become a stable release, run:

```bash
corepack pnpm changeset pre exit
```
