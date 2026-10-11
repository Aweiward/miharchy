# Release

A release is a git tag `vX.Y.Z`, a `stable` commit and a GitHub release on `Aweiward/miharchy`. Users install from `stable`, the default branch (ADR 0008), and get each release through `omarchy plugin update miharchy`. Work merges to `main`; `stable` moves only here. Run `gh` with `GH_TOKEN=$(gh auth token -u Aweiward)`.

## Steps

1. Pick the version. A new feature since the last tag means a minor bump. Fixes only means a patch bump.
2. Open a PR `release/vX.Y.Z` that changes two lines: `version` in `manifest.json` and the `Status:` link in `README.md`. Run `omarchy plugin validate .`.
3. Draft the notes in the layout of the last release (`gh release view <last tag> --json body -q .body`): `## Upgrade`, `## Highlights` (one bold line per feature, with its ADR), `## Fixes`, `## Not in this release`.
4. After the user approves, merge the PR. Tag the merge commit and push the tag: `git tag vX.Y.Z <sha> && git push origin vX.Y.Z`.
5. Move `stable` to the release: `tools/release-stable vX.Y.Z`. It builds the commit without the agent files, checks it, pushes it and prints its full SHA.
6. Publish: `gh release create vX.Y.Z --title "Miharchy X.Y.Z" --notes-file <notes>`.
7. The `Release` workflow fails if the tag differs from `manifest.json`. Check it with `gh run list -w Release -L 1`.
8. Ask the marketplace to publish the release: a "Verify or update a listed plugin" issue (`[Verify]: Miharchy`) on https://github.com/omacom/omarchy-plugin-marketplace, action "Verify and publish a newer upstream commit", with the `stable` commit's full SHA from step 5. Until it is published, the listing shows "Update unverified".
9. Record the release: the release link in "Current work" in `AGENTS.md` (replace it; the release notes hold the history), the roadmap plans that shipped, and the site (`site/index.html`, screenshots through `site/tools/README.md`) when features changed.

## The first stable release (once)

The first run of `tools/release-stable` makes `stable` from `main`'s tip, so every clone of `main` fast-forwards to it. Right after it, with no merge to `main` in between, make `stable` the default branch: `gh repo edit Aweiward/miharchy --default-branch stable`. A merge in that window strands the users who update in it: their clone is past `stable`'s first parent and cannot fast-forward.
