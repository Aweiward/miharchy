#!/usr/bin/env bash
# Seed the scratch server: Keiyoushi repo, extensions, and library manga.
#   seed.sh [pkg ...]            install extensions (default: MangaDex)
#   seed.sh --library N [pkg]    also add the first N popular manga of the first English source to the library
set -euo pipefail
here=$(dirname "$0"); source "$here/env.sh"
n=0; [ "${1:-}" = --library ] && { n=$2; shift 2; }
pkgs=("${@:-eu.kanade.tachiyomi.extension.all.mangadex}")
"$here/gql.sh" 'mutation { addExtensionStore(input:{indexUrl:"https://raw.githubusercontent.com/keiyoushi/extensions/repo/index.min.json"}) { extensionStore { indexUrl } } }' >/dev/null
"$here/gql.sh" 'mutation { fetchExtensions(input:{}) { extensions { pkgName } } }' >/dev/null
for p in "${pkgs[@]}"; do
  "$here/gql.sh" 'mutation($id: String!) { updateExtension(input:{id:$id, patch:{install:true}}) { extension { pkgName isInstalled } } }' "{\"id\":\"$p\"}" | jq -c '.data.updateExtension.extension // .errors[0].message'
done
if [ "$n" -gt 0 ]; then
  src=$("$here/gql.sh" '{ sources { nodes { id lang } } }' | jq -r '[.data.sources.nodes[] | select(.lang=="en")][0].id')
  ids=$("$here/gql.sh" 'mutation($s: LongString!) { fetchSourceManga(input:{source:$s, type:POPULAR, page:1}) { mangas { id } } }' "{\"s\":\"$src\"}" | jq -r ".data.fetchSourceManga.mangas[:$n][].id")
  for id in $ids; do
    "$here/gql.sh" 'mutation($id: Int!) { fetchMangaAndChapters(input:{id:$id, fetchManga:true, fetchChapters:true}) { manga { id } } }' "{\"id\":$id}" >/dev/null
    "$here/gql.sh" 'mutation($id: Int!) { updateManga(input:{id:$id, patch:{inLibrary:true}}) { manga { id title inLibrary } } }' "{\"id\":$id}" | jq -c '.data.updateManga.manga'
  done
fi
