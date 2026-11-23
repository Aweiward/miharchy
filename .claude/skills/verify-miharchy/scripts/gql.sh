#!/usr/bin/env bash
# Run one GraphQL query against the scratch Suwayomi (server.sh): gql.sh '{ mangas(condition:{inLibrary:true}){ totalCount } }'
# A second argument is a JSON object of variables. Kept only for seed.sh and to read the source of Setup's move
# from Suwayomi; read the scratch core with core.sh api.
set -euo pipefail
source "$(dirname "$0")/env.sh"
body=$(jq -n --arg q "$1" --argjson v "${2:-{\}}" '{query:$q, variables:$v}')
printf 'Authorization: Bearer %s\n' "$(token)" | curl -s -m 180 -H @- -H 'content-type: application/json' -X POST -d "$body" "http://127.0.0.1:$PORT/api/graphql"
