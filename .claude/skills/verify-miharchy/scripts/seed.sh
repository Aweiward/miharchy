#!/usr/bin/env bash
# Seed the scratch server: Keiyoushi repo, extensions, library manga, updates, a held queue.
#   seed.sh [pkg ...]              install extensions (default: MangaDex)
#   seed.sh --library N [pkg ...]  also add the first N popular manga of the first English source to the library
#   seed.sh --updates N [pkg ...]  also add N latest manga not yet in the library, so their chapters count as
#                                  updates (joined the library before the fetch, uploaded recently)
#   seed.sh --hold-queue 4,5,6     only queue those chapters, off disk, with the downloader stopped; fails when
#                                  the queue does not hold (a chapter finished first, or the server restarted it)
set -euo pipefail
here=$(dirname "$0"); source "$here/env.sh"
gql() { "$here/gql.sh" "$@"; }

if [ "${1:-}" = --hold-queue ]; then
  ids="[${2:?chapter ids, e.g. 4,5,6}]"
  gql "mutation { deleteDownloadedChapters(input:{ids:$ids}) { chapters { id } } }" >/dev/null
  gql "mutation { enqueueChapterDownloads(input:{ids:$ids}) { downloadStatus { state } } }" >/dev/null
  # The enqueue starts the downloader about a second later; a stop sent before
  # that start does not hold.
  for _ in $(seq 50); do
    [ "$(gql '{ downloadStatus { state } }' | jq -r .data.downloadStatus.state)" = STARTED ] && break
    sleep 0.2
  done
  gql 'mutation { stopDownloader(input:{}) { downloadStatus { state } } }' >/dev/null
  sleep 3
  got=$(gql '{ downloadStatus { state queue { chapter { id } } } }' | jq -c '.data.downloadStatus | {state, queue: [.queue[].chapter.id] | sort}')
  want=$(jq -cn --argjson i "$ids" '{state: "STOPPED", queue: ($i | sort)}')
  [ "$got" = "$want" ] || { echo "queue did not hold: $got, wanted $want" >&2; exit 1; }
  echo "held: $got"; exit 0
fi

n=0; updates=0
while :; do
  case ${1:-} in
    --library) n=$2; shift 2 ;;
    --updates) updates=$2; shift 2 ;;
    *) break ;;
  esac
done
pkgs=("${@:-eu.kanade.tachiyomi.extension.all.mangadex}")
gql 'mutation { addExtensionStore(input:{indexUrl:"https://raw.githubusercontent.com/keiyoushi/extensions/repo/index.min.json"}) { extensionStore { indexUrl } } }' >/dev/null
gql 'mutation { fetchExtensions(input:{}) { extensions { pkgName } } }' >/dev/null
for p in "${pkgs[@]}"; do
  gql 'mutation($id: String!) { updateExtension(input:{id:$id, patch:{install:true}}) { extension { pkgName isInstalled } } }' "{\"id\":\"$p\"}" | jq -c '.data.updateExtension.extension // .errors[0].message'
done
src=$(gql '{ sources { nodes { id lang } } }' | jq -r '[.data.sources.nodes[] | select(.lang=="en")][0].id')
if [ "$n" -gt 0 ]; then
  ids=$(gql 'mutation($s: LongString!) { fetchSourceManga(input:{source:$s, type:POPULAR, page:1}) { mangas { id } } }' "{\"s\":\"$src\"}" | jq -r ".data.fetchSourceManga.mangas[:$n][].id")
  for id in $ids; do
    gql 'mutation($id: Int!) { fetchMangaAndChapters(input:{id:$id, fetchManga:true, fetchChapters:true}) { manga { id } } }' "{\"id\":$id}" >/dev/null
    gql 'mutation($id: Int!) { updateManga(input:{id:$id, patch:{inLibrary:true}}) { manga { id title inLibrary } } }' "{\"id\":$id}" | jq -c '.data.updateManga.manga'
  done
fi
if [ "$updates" -gt 0 ]; then
  # Chapters fetched as a manga joins the library are backlog; these join first.
  ids=$(gql 'mutation($s: LongString!) { fetchSourceManga(input:{source:$s, type:LATEST, page:1}) { mangas { id inLibrary } } }' "{\"s\":\"$src\"}" | jq -r "[.data.fetchSourceManga.mangas[] | select(.inLibrary | not)][:$updates][].id")
  for id in $ids; do
    gql 'mutation($id: Int!) { updateManga(input:{id:$id, patch:{inLibrary:true}}) { manga { id } } }' "{\"id\":$id}" >/dev/null
  done
  sleep 2
  for id in $ids; do
    gql 'mutation($id: Int!) { fetchMangaAndChapters(input:{id:$id, fetchManga:true, fetchChapters:true}) { manga { id title chapters { totalCount } } } }' "{\"id\":$id}" | jq -c '.data.fetchMangaAndChapters.manga'
  done
fi
