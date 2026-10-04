.pragma library
.import "Settings.js" as Settings

// The setup screen's steps and state. Pure, so tests/setup.test.js pins it;
// SetupView.qml runs the commands built here and feeds their output back.
// Every step detects its own "done" from a fresh check, so setup can run
// any number of times.

var FLARE_URL = "http://127.0.0.1:8191"
var CONTAINER = "miharchy-flaresolverr"

// kind "install": the user runs command in a terminal; Enter checks again.
// kind "run":     Miharchy runs the step after the user confirms with y.
// kind "folder":  the user types a path.
// required: the window opens on setup while one of these is not done.
var STEPS = [
  { id: "java", title: "Java 21 or newer", kind: "install", required: true, command: "sudo pacman -S jre-openjdk" },
  { id: "suwayomi", title: "Suwayomi-Server", kind: "install", required: true, command: "yay -S suwayomi-server-bin" },
  { id: "server", title: "Server service and credentials", kind: "run", required: true },
  { id: "flaresolverr", title: "FlareSolverr (optional)", kind: "run" },
  { id: "syncFolder", title: "Sync folder", kind: "folder" }
]

// $1 is the server.json path. Each line prints one fact; parseProbe reads them.
var PROBE = [
  "echo \"java $(java -version 2>&1 | head -n 1)\"",
  "test -x /usr/bin/suwayomi-server && echo suwayomi",
  "test -s \"$1\" && echo config",
  "echo \"unit $(systemctl --user is-enabled miharchy-server 2>/dev/null) $(systemctl --user is-active miharchy-server 2>/dev/null)\"",
  "command -v docker >/dev/null && echo \"docker $(docker inspect -f '{{.State.Running}}' " + CONTAINER + " 2>/dev/null)\""
].join("\n")

// docker start makes a rerun reuse the container; the loop waits for the
// first answer so the step only reports done once FlareSolverr serves.
var FLARE_SCRIPT = [
  "docker start " + CONTAINER + " >/dev/null 2>&1 || docker run -d --name " + CONTAINER + " --restart unless-stopped -p 127.0.0.1:8191:8191 ghcr.io/flaresolverr/flaresolverr:latest || exit",
  "for i in $(seq 60); do curl -fs " + FLARE_URL + " >/dev/null && echo \"FlareSolverr answers on " + FLARE_URL + "\" && exit 0; sleep 1; done",
  "echo \"FlareSolverr did not answer on " + FLARE_URL + " within 60 s.\"",
  "exit 1"
].join("\n")

var SERVER_QUERY = "{ settings { flareSolverrEnabled flareSolverrUrl flareSolverrAsResponseFallback } metas { nodes { key value } } }"

// A job's argv. The script's output, stderr included, ends with its exit
// status on the last line, because Process gives no order between its exit
// and the end of its output.
function command(script, args) {
  return ["/bin/sh", "-c", "(\n" + script + "\n) 2>&1\nprintf '\\n%s\\n' \"$?\"", "sh"].concat(args || [])
}

function probeCommand(configPath) {
  return command(PROBE, [configPath])
}

// The job a confirmed or committed step runs. ctx: { serverScript, folder }.
function runCommand(id, ctx) {
  switch (id) {
    case "server": return command("\"$1\"", [ctx.serverScript])
    case "flaresolverr": return command(FLARE_SCRIPT)
    case "syncFolder": return command("test -d \"$1\" || { echo \"$1 is not a folder.\"; exit 1; }", [ctx.folder])
  }
  return null
}

// A job's collected output -> { code, output }.
function parseJob(text) {
  var lines = String(text).replace(/\s+$/, "").split("\n")
  var code = parseInt(lines.pop(), 10)
  return { code: isNaN(code) ? -1 : code, output: lines.join("\n").trim() }
}

// "openjdk version "26.0.2" ..." -> 26; Java 8 and older say "1.8.0".
function javaMajor(line) {
  var m = /version "(\d+)(?:\.(\d+))?/.exec(line)
  if (!m) return 0
  return m[1] === "1" ? Number(m[2] || 0) : Number(m[1])
}

// The probe's output -> facts. docker is false when the command is absent.
function parseProbe(text) {
  var f = { java: 0, suwayomi: false, config: false, unitEnabled: false, unitActive: false, docker: false, container: false }
  String(text).split("\n").forEach(function(line) {
    var sp = line.indexOf(" ")
    var key = sp === -1 ? line : line.slice(0, sp)
    var rest = sp === -1 ? "" : line.slice(sp + 1)
    var words = rest.split(/\s+/)
    if (key === "java") f.java = javaMajor(rest)
    if (key === "suwayomi") f.suwayomi = true
    if (key === "config") f.config = true
    if (key === "unit") {
      f.unitEnabled = words.indexOf("enabled") !== -1
      f.unitActive = words.indexOf("active") !== -1
    }
    if (key === "docker") {
      f.docker = true
      f.container = rest.trim() === "true"
    }
  })
  return f
}

// A GraphQL reply (Model.reply) to SERVER_QUERY -> { flare, syncFolder }.
function parseServer(data) {
  var meta = ((data.metas && data.metas.nodes) || []).filter(function(m) { return m.key === Settings.META_PREFIX + "syncFolder" })[0]
  return { flare: data.settings || {}, syncFolder: meta ? String(meta.value) : "" }
}

// setup.probe: parseProbe() facts, null before the first check.
// setup.server: parseServer() result, null until the server answers.
// setup.job: the id of the running job ("probe" or a step id), or null.
// setup.confirm: the step id waiting for y, or null.
// setup.results: step id -> parseJob() of its last run.
function initial() {
  return { probe: null, server: null, serverMessage: "", job: null, confirm: null, results: {} }
}

function copy(s, changes) {
  var c = {}
  for (var k in s) c[k] = s[k]
  for (var j in changes) c[j] = changes[j]
  return c
}

// event.type:
//   "start"    { id } a job started
//   "finish"   { id, text } a job's collected output
//   "server"   { reply } with reply from Model.reply()
//   "confirm"  { id } the user asked to run a step
//   "cancel"   the user declined
function reduce(s, event) {
  switch (event.type) {
    case "start":
      return copy(s, { job: event.id, confirm: null })
    case "finish":
      if (event.id === "probe") return copy(s, { job: null, probe: parseProbe(event.text) })
      var results = copy(s.results, {})
      results[event.id] = parseJob(event.text)
      return copy(s, { job: null, results: results })
    case "server":
      var r = event.reply
      if (r.state !== "ok") return copy(s, { server: null, serverMessage: r.message || r.state })
      return copy(s, { server: parseServer(r.data), serverMessage: "" })
    case "confirm":
      return copy(s, { confirm: event.id })
    case "cancel":
      return copy(s, { confirm: null })
  }
  return s
}

function step(id) {
  for (var i = 0; i < STEPS.length; i++) if (STEPS[i].id === id) return STEPS[i]
  return null
}

function flareDone(s) {
  var f = s.server.flare
  return s.probe.container && f.flareSolverrEnabled === true && f.flareSolverrUrl === FLARE_URL && f.flareSolverrAsResponseFallback === true
}

// A step's status: { state, detail } with state
// "checking" | "running" | "done" | "todo" | "waiting" | "unavailable".
function status(s, id) {
  var is = function(state, detail) { return { state: state, detail: detail } }
  if (s.job === id) return is("running", "")
  if (!s.probe) return is("checking", "")
  var p = s.probe
  switch (id) {
    case "java":
      if (p.java >= 21) return is("done", "Java " + p.java + " is installed.")
      return is("todo", (p.java ? "Java " + p.java + " is too old." : "Java is not installed.") + " Install it in a terminal, then press Enter to check again.")
    case "suwayomi":
      if (p.suwayomi) return is("done", "/usr/bin/suwayomi-server is installed.")
      return is("todo", "Suwayomi-Server is not installed. Install it in a terminal, then press Enter to check again.")
    case "server":
      if (status(s, "java").state !== "done" || !p.suwayomi) return is("waiting", "Needs Java and Suwayomi-Server first.")
      if (p.config && p.unitEnabled && p.unitActive) return is("done", "miharchy-server is enabled and running.")
      return is("todo", "Press Enter to run server/miharchy-server. It creates the credentials and enables the user service.")
    case "flaresolverr":
      if (!p.docker) return is("unavailable", "Docker is not installed. Cloudflare sources will show \"needs FlareSolverr\".")
      if (status(s, "server").state !== "done" || !s.server) return is("waiting", "Needs the server running first.")
      if (flareDone(s)) return is("done", "The " + CONTAINER + " container runs on 127.0.0.1:8191 and Suwayomi uses it.")
      return is("todo", "Press Enter to start the " + CONTAINER + " container on 127.0.0.1:8191 and turn FlareSolverr on in Suwayomi. Cloudflare sources need it.")
    case "syncFolder":
      if (status(s, "server").state !== "done" || !s.server) return is("waiting", "Needs the server running first.")
      if (s.server.syncFolder) return is("done", s.server.syncFolder)
      return is("todo", "Press Enter to choose the folder Mihon and Miharchy exchange backups through.")
  }
  return is("checking", "")
}

// What Enter does on a step: "check" runs the probe again, "confirm" asks
// before a run, "edit" opens the folder field, null does nothing.
function action(s, id) {
  if (s.job) return null
  var st = status(s, id).state
  if (st === "checking") return null
  var kind = step(id).kind
  if (kind === "install" || st === "waiting" || st === "unavailable") return "check"
  return kind === "run" ? "confirm" : "edit"
}

// True once checked and some required step is not done.
function incomplete(s) {
  if (!s.probe) return false
  return STEPS.some(function(st) { return st.required && status(s, st.id).state !== "done" })
}

// The step the cursor starts on: the first one not done, or the first.
function next(s) {
  for (var i = 0; i < STEPS.length; i++) if (status(s, STEPS[i].id).state !== "done") return i
  return 0
}

// A typed folder -> { folder } or { error }. "~" means home.
function commitFolder(text, home) {
  var t = String(text).trim().replace(/^~(?=\/|$)/, home)
  if (t.charAt(0) !== "/") return { error: "Enter an absolute path, such as ~/Sync/Mihon." }
  return { folder: t.length > 1 ? t.replace(/\/+$/, "") : t }
}

// The server write a successful run calls for, or null. FlareSolverr goes
// through the Settings row so its whenOn fallback rides along.
function savePayload(id, result, folder) {
  if (result.code !== 0) return null
  if (id === "flaresolverr") {
    var row = Settings.ROWS.filter(function(r) { return r.key === "flareSolverrEnabled" })[0]
    var p = Settings.savePayload(row, true)
    p.variables.s.flareSolverrUrl = FLARE_URL
    return p
  }
  if (id === "syncFolder") return Settings.savePayload({ key: "syncFolder", store: "meta" }, folder)
  return null
}

if (typeof module !== "undefined") {
  module.exports = {
    FLARE_URL: FLARE_URL,
    CONTAINER: CONTAINER,
    STEPS: STEPS,
    SERVER_QUERY: SERVER_QUERY,
    probeCommand: probeCommand,
    runCommand: runCommand,
    parseJob: parseJob,
    parseProbe: parseProbe,
    initial: initial,
    reduce: reduce,
    status: status,
    action: action,
    incomplete: incomplete,
    next: next,
    commitFolder: commitFolder,
    savePayload: savePayload
  }
}
