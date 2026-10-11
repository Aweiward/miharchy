# Release

A release is a git tag `vX.Y.Z` and a GitHub release on `Aweiward/miharchy`. Users get it through `omarchy plugin update miharchy`. Run `gh` with `GH_TOKEN=$(gh auth token -u Aweiward)`.

## Steps

1. Pick the version. A new feature since the last tag means a minor bump. Fixes only means a patch bump.
2. Open a PR `release/vX.Y.Z` that changes two lines: `version` in `manifest.json` and the `Status:` link in `README.md`. Run `omarchy plugin validate .`.
3. Draft the notes in the layout of the last release (`gh release view <last tag> --json body -q .body`): `## Upgrade`, `## Highlights` (one bold line per feature, with its ADR), `## Fixes`, `## Not in this release`.
4. After the user approves, merge the PR. Tag the merge commit and push the tag: `git tag vX.Y.Z <sha> && git push origin vX.Y.Z`.
5. Publish: `gh release create vX.Y.Z --title "Miharchy X.Y.Z" --notes-file <notes>`.
6. The `Release` workflow fails if the tag differs from `manifest.json`. Check it with `gh run list -w Release -L 1`.
7. Record the release: the "Current work" paragraph in `AGENTS.md`, the roadmap plans that shipped, and the site (`site/index.html`, screenshots through `site/tools/README.md`) when features changed.
