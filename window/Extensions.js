.pragma library
.import "Model.js" as Model
.import "Settings.js" as Settings

// The Browse view's extensions and extension repos. Pure, so
// tests/extensions.test.js pins it; ExtensionsView.qml sends the payloads
// built here and feeds replies back through reduce().

var KEIYOUSHI = "https://raw.githubusercontent.com/keiyoushi/extensions/repo/index.min.json"
var PRESET_META = Settings.META_PREFIX + "repoPreset"

var FIELDS = "pkgName name lang versionName iconUrl isInstalled hasUpdate isObsolete contentWarning storeIndexUrl"
var STORES_QUERY = "{ extensionStores { nodes { indexUrl name } } metas(condition: { key: \"" + PRESET_META + "\" }) { nodes { key value } } }"

// ext.state: "idle" | "loading" | "ok" | "no-config" | "down" | "unauthorized"
// | "error", the connection states plus "idle" (never loaded), so
// Model.problem() words failures. step: the load request in flight, see next().
// repos: [{ url, name }] with url as the server stores it; the server
// rewrites the Keiyoushi URL to .../index.pb, so removal must send this one.
// busy / errors: per extension pkgName, the action in flight or its failure.
function initial() {
  return { state: "idle", message: "", step: null, repos: [], extensions: [], busy: {}, errors: {}, repoError: "" }
}

function copy(ext, changes) {
  var c = {}
  for (var k in ext) c[k] = ext[k]
  for (var j in changes) c[j] = changes[j]
  return c
}

function without(map, key) {
  var c = {}
  for (var k in map) if (k !== key) c[k] = map[k]
  return c
}

function withKey(map, key, value) {
  var c = without(map, key)
  c[key] = value
  return c
}

function toRepo(store) {
  return { url: String(store.indexUrl), name: String(store.name || store.indexUrl) }
}

function toExtension(config, n) {
  return {
    pkgName: n.pkgName,
    name: String(n.name || n.pkgName),
    lang: String(n.lang || ""),
    version: String(n.versionName || ""),
    icon: Model.coverUrl(config, n.iconUrl),
    installed: n.isInstalled === true,
    hasUpdate: n.hasUpdate === true,
    obsolete: n.isObsolete === true,
    warning: String(n.contentWarning || "SAFE"),
    repo: n.storeIndexUrl || ""
  }
}

// The load runs as steps: "stores" reads the repos and the preset flag;
// "preset" adds Keiyoushi, only when there is no repo and the flag is
// unset; "mark" sets the flag so a repo the user removes stays removed;
// "fetch" refreshes every repo and returns the whole list.
// Returns the payload for ext.step, or null when nothing is due.
function next(ext) {
  switch (ext.step) {
    case "stores":
      return { query: STORES_QUERY }
    case "preset":
      return addRepoPayload(KEIYOUSHI)
    case "mark":
      return {
        query: "mutation($key: String!) { setGlobalMeta(input: { meta: { key: $key, value: \"true\" } }) { meta { key } } }",
        variables: { key: PRESET_META }
      }
    case "fetch":
      return { query: "mutation { fetchExtensions(input: {}) { extensionStores { indexUrl name } extensions { " + FIELDS + " } } }" }
  }
  return null
}

function addRepoPayload(url) {
  return {
    query: "mutation($url: String!) { addExtensionStore(input: { indexUrl: $url }) { extensionStore { indexUrl name } } }",
    variables: { url: url }
  }
}

function removeRepoPayload(repo) {
  return {
    query: "mutation($url: String!) { removeExtensionStore(input: { indexUrl: $url }) { extensionStore { indexUrl } } }",
    variables: { url: repo.url }
  }
}

// action: "install" | "update" | "uninstall".
function actionPayload(pkgName, action) {
  var patch = {}
  patch[action] = true
  return {
    query: "mutation($id: String!, $patch: UpdateExtensionPatchInput!) { updateExtension(input: { id: $id, patch: $patch }) { extension { " + FIELDS + " } } }",
    variables: { id: pkgName, patch: patch }
  }
}

// A repo URL as typed -> { url } or { error }.
function parseRepoUrl(text) {
  var t = String(text).trim()
  if (!/^https?:\/\/\S+$/.test(t)) return { error: "Enter a repo URL that starts with http:// or https://." }
  return { url: t }
}

// event.type:
//   "config-missing"  server.json is absent or unreadable
//   "load"            start the load steps
//   "reply"           { reply, config } for the load step in flight
//   "action"          { pkgName, action } went out
//   "action-reply"    { pkgName, reply, config }
//   "repo-reply"      { reply, removed? } for an add, or a removal of removed
// reply is Model.reply()'s. A failure keeps what is shown.
function reduce(ext, event) {
  var r = event.reply
  switch (event.type) {
    case "config-missing":
      return copy(ext, { state: "no-config", message: "", step: null })
    case "load":
      return copy(ext, { state: "loading", message: "", step: "stores", repoError: "" })
    case "reply":
      if (r.state !== "ok") return copy(ext, { state: r.state, message: r.message, step: null })
      return loaded(ext, r.data, event.config)
    case "action":
      return copy(ext, { busy: withKey(ext.busy, event.pkgName, event.action), errors: without(ext.errors, event.pkgName) })
    case "action-reply":
      var busy = without(ext.busy, event.pkgName)
      if (r.state !== "ok") return copy(ext, { busy: busy, errors: withKey(ext.errors, event.pkgName, r.message || Model.problem(r, "").title) })
      var node = r.data.updateExtension && r.data.updateExtension.extension
      var list = ext.extensions.filter(function(e) { return e.pkgName !== event.pkgName || node })
      list = list.map(function(e) { return e.pkgName === event.pkgName ? toExtension(event.config, node) : e })
      return copy(ext, { busy: busy, extensions: list })
    case "repo-reply":
      if (r.state !== "ok") return copy(ext, { repoError: r.message || Model.problem(r, "").title })
      if (event.removed) {
        return copy(ext, { repoError: "", repos: ext.repos.filter(function(p) { return p.url !== event.removed.url }) })
      }
      // A new repo's extensions arrive with the next fetch.
      return copy(ext, { repoError: "", state: "loading", step: "fetch" })
  }
  return ext
}

function loaded(ext, data, config) {
  switch (ext.step) {
    case "stores":
      var repos = data.extensionStores.nodes.map(toRepo)
      var preset = data.metas.nodes.length > 0
      return copy(ext, { repos: repos, step: repos.length || preset ? "fetch" : "preset" })
    case "preset":
      return copy(ext, { step: "mark" })
    case "mark":
      return copy(ext, { step: "fetch" })
    case "fetch":
      var f = data.fetchExtensions
      return copy(ext, {
        state: "ok",
        step: null,
        repos: f.extensionStores.map(toRepo),
        extensions: f.extensions.map(function(n) { return toExtension(config, n) })
      })
  }
  return ext
}

var GROUPS = ["Extension repos", "Updates", "Installed", "Available"]

function group(e) {
  if (e.hasUpdate) return "Updates"
  return e.installed ? "Installed" : "Available"
}

// What the list shows, in order: repos, then updatable, installed and
// available extensions, each by name. filter: { query, allLanguages,
// showNsfw }.
//   NSFW extensions hide unless showNsfw; MIXED ones show, marked.
//   Available ones show only for a repo the server still has (it keeps
//   removed repos' extensions) and, unless allLanguages, only in English
//   or "all". Installed ones show in every language.
//   query matches a name or repo, ignoring case.
// A row: { key, group, title, detail, marker, icon, kind: "repo" | "extension" }.
function rows(ext, filter) {
  var q = String(filter.query || "").toLowerCase()
  var match = function(s) { return s.toLowerCase().indexOf(q) !== -1 }
  var repoUrls = ext.repos.map(function(p) { return p.url })
  var out = ext.repos.filter(function(p) { return match(p.name) || match(p.url) }).map(function(p) {
    return { kind: "repo", key: p.url, group: GROUPS[0], title: p.name, detail: p.url, marker: "", icon: "" }
  })
  var list = ext.extensions.filter(function(e) {
    if (e.warning === "NSFW" && !filter.showNsfw) return false
    if (!match(e.name)) return false
    if (e.installed) return true
    return repoUrls.indexOf(e.repo) !== -1 && (filter.allLanguages || e.lang === "en" || e.lang === "all")
  }).map(function(e) {
    return {
      kind: "extension",
      key: e.pkgName,
      group: group(e),
      title: e.name,
      detail: e.lang + "  " + e.version + (e.obsolete ? "  obsolete" : ""),
      marker: e.warning === "NSFW" ? "18+" : e.warning === "MIXED" ? "mixed" : "",
      icon: e.icon
    }
  })
  list.sort(function(a, b) {
    return GROUPS.indexOf(a.group) - GROUPS.indexOf(b.group) || a.title.toLowerCase().localeCompare(b.title.toLowerCase())
  })
  return out.concat(list)
}

function find(ext, pkgName) {
  for (var i = 0; i < ext.extensions.length; i++) if (ext.extensions[i].pkgName === pkgName) return ext.extensions[i]
  return null
}

// What a command does to a row:
//   "extensions.activate" (Enter) installs an available extension and
//   updates an updatable one; "extensions.remove" (x) uninstalls an
//   installed extension or removes a repo.
// Returns { action, pkgName }, { removeRepo }, or null for nothing.
function actionFor(ext, row, command) {
  if (!row) return null
  if (row.kind === "repo") {
    if (command !== "extensions.remove") return null
    for (var i = 0; i < ext.repos.length; i++) if (ext.repos[i].url === row.key) return { removeRepo: ext.repos[i] }
    return null
  }
  var e = find(ext, row.key)
  if (!e || ext.busy[e.pkgName]) return null
  if (command === "extensions.remove") return e.installed ? { action: "uninstall", pkgName: e.pkgName } : null
  if (e.hasUpdate) return { action: "update", pkgName: e.pkgName }
  return e.installed ? null : { action: "install", pkgName: e.pkgName }
}

var BUSY = { install: "installing", update: "updating", uninstall: "uninstalling" }

// An extension row's inline status: the action in flight, its failure, or "".
function status(ext, row) {
  if (row.kind === "repo") return ""
  if (ext.busy[row.key]) return BUSY[ext.busy[row.key]] + "..."
  if (ext.errors[row.key]) return ext.errors[row.key]
  return ""
}

if (typeof module !== "undefined") {
  module.exports = {
    KEIYOUSHI: KEIYOUSHI,
    PRESET_META: PRESET_META,
    initial: initial,
    next: next,
    addRepoPayload: addRepoPayload,
    removeRepoPayload: removeRepoPayload,
    actionPayload: actionPayload,
    parseRepoUrl: parseRepoUrl,
    reduce: reduce,
    rows: rows,
    actionFor: actionFor,
    status: status
  }
}
