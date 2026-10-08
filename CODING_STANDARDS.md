# Coding standards

The reviewer applies these to a diff. Every rule here is a judgment call; a mechanical rule belongs in a check (`npm test`, `lint:qml`, CI).

## The verify skill's feature map follows user-facing changes

A PR that adds or changes something a user reaches (a view, a key group, a palette command, a start target such as `MIHARCHY_PEEK`, a launcher subcommand) also adds or updates its entry in `.claude/skills/verify-miharchy/features/`: the feature file and its row in `features/README.md`. The entry says how a user reaches the feature, how `drive.sh` drives it, and what end state proves it. A new command id is not always a new feature: a key on an existing screen belongs in that screen's file.
