# Users install from a stable release branch

`omarchy plugin add` clones the default branch, and `omarchy plugin update` fast-forwards to the remote's HEAD (`git fetch origin HEAD`, then `git merge --ff-only`). Until now the default branch was `main`, so every merged PR reached users, not only releases. The Omarchy Plugin Marketplace binds a listing to one exact commit and shows "Update unverified" when the default branch moves past it. Its review also blocks agent instruction files in the installed tree (`AGENTS.md`, `CLAUDE.md`, `.claude/`), because coding agents load them from the plugin folder. So the default branch becomes `stable`, and `stable` moves only at a release. Development and PRs stay on `main`.

Each release commit on `stable` is a merge with two parents: the previous `stable` commit and the release tag `vX.Y.Z` on `main`. Its tree is the tag's tree without `AGENTS.md`, `CLAUDE.md`, `.claude/` and `docs/agents/`. The first `stable` commit has the `main` HEAD of its day as its parent, so a clone of `main` fast-forwards to `stable`. A release script builds the commit, checks that the excluded paths are absent, and checks that it fast-forwards from the previous `stable`.

## Considered Options

- Keep `main` as the default branch and verify each merge on the marketplace. Rejected: many merges a week, each one "Update unverified", and agent files in every install.
- A `stable` branch with its own history. Rejected: `merge --ff-only` fails for every user who installed from `main`.
- Move the agent files out of the repo, or to paths agents do not load. Rejected: the project's sessions rely on them loading.

## Consequences

- Users get releases only, which is what `docs/agents/release.md` already promised.
- The repo root is still the plugin folder, but the installed tree is `stable`'s tree, not `main`'s. Files only agents use live on `main` only.
- Each release adds a marketplace [Verify] request with the `stable` commit's full SHA.
- A marketplace review stays valid while work merges to `main`, because `stable` does not move.
