.pragma library
.import "Settings.js" as Settings
.import "Session.js" as Session

// The setup screen's steps and state. Pure, so tests/setup.test.js pins it;
// SetupView.qml runs the commands built here and feeds their output back.
// Every step detects its own "done" from a fresh check, so setup can run
// any number of times.

var FLARE_URL = "http://127.0.0.1:8191"
var CONTAINER = "miharchy-flaresolverr"
// Under $HOME. The shell reloads a plugin on any write inside its folder,
// so the helper builds and installs here, never in the plugin's sync/.
var HELPER_DIR = ".local/share/miharchy/helper"
var UNIT_FILE = ".config/systemd/user/miharchy-server.service"
var SERVER_CONF = ".local/share/miharchy/suwayomi/server.conf"
var DESKTOP_FILE = ".local/share/applications/miharchy.desktop"
var BINDINGS_FILE = ".config/hypr/bindings.lua"
var PEEK_KEY = "SUPER + M"
// A bindings.lua line that runs `miharchy peek` (peekLine quotes the path)
// and is not a Lua comment.
var HAS_PEEK_KEY = "grep -qsE \"^[[:space:]]*[^[:space:]-].*miharchy'? peek\""

// kind "install": Setup installs packages through Omarchy in a terminal the
//                 user sees, after y (ADR 0007); done, Enter checks again.
// kind "run":     Miharchy runs the step after the user confirms with y;
//                 prompt is the question it asks.
// kind "folder":  the user types a path.
// kind "check":   the user acts elsewhere (on the phone); Enter checks again.
// required: the window opens on setup while one of these is not done.
var STEPS = [
  { id: "packages", title: "Packages", kind: "install", required: true },
  { id: "server", title: "Server service and credentials", kind: "run", required: true, prompt: "Run server/miharchy-server now?" },
  { id: "flaresolverr", title: "FlareSolverr (optional)", kind: "run", prompt: "Start the FlareSolverr container and turn it on in Suwayomi?" },
  { id: "syncFolder", title: "Sync folder", kind: "folder" },
  { id: "phoneBackups", title: "Phone backups", kind: "check" },
  { id: "helper", title: "Sync helper", kind: "run", prompt: "Build the sync helper now? It takes a few minutes." },
  { id: "launcher", title: "App launcher entry", kind: "run", prompt: "Add Miharchy to the app launcher?" },
  { id: "peekKey", title: "Peek key", kind: "run", prompt: "Add " + PEEK_KEY + ", which shows and hides a peek, to your Hyprland bindings?" }
]

// sha256 over every file in a sync/ folder except build output, so a
// rebuild is due exactly when the sources or build files change.
var FINGERPRINT = "fingerprint() { (cd \"$1\" && find . -path ./build -prune -o -path ./.gradle -prune -o -path ./.kotlin -prune -o -type f -print | LC_ALL=C sort | xargs -d '\\n' sha256sum | sha256sum | cut -c1-64); }"

// $1 is the server.json path, $2 the plugin's sync/, $3 desktopEntry(),
// $4 the plugin's server unit, $5 "1" to skip the AUR query.
// Each line prints one fact; parseProbe reads them.
var PROBE = [
  FINGERPRINT,
  "echo \"java $(java -version 2>&1 | head -n 1)\"",
  "test -x /usr/bin/suwayomi-server && echo suwayomi",
  // While Suwayomi-Server is missing: the AUR's version, so the install can
  // warn about one newer than Miharchy checked (ADR 0007). "?" when yay
  // cannot tell; skipped on rechecks ($5 = 1).
  "command -v suwayomi-server >/dev/null || [ \"$5\" = 1 ] || { v=$(yay -Si suwayomi-server-bin 2>/dev/null | while IFS=: read -r k val; do case $k in Version*) echo $val;; esac; done); v=${v%-*}; echo \"aurSuwayomi ${v:-?}\"; }",
  "test -e /usr/lib/qt6/qml/QtWebSockets/qmldir && echo websockets",
  "test -s \"$1\" && echo config",
  "echo \"unit $(systemctl --user is-enabled miharchy-server 2>/dev/null) $(systemctl --user is-active miharchy-server 2>/dev/null)\"",
  "cmp -s \"$4\" \"$HOME/" + UNIT_FILE + "\" && echo unitCurrent",
  "grep -qiE '^server\\.authMode *= *\"?basic_auth' \"$HOME/" + SERVER_CONF + "\" 2>/dev/null && echo basicAuth",
  "command -v docker >/dev/null && echo \"docker $(docker inspect -f '{{.State.Running}}' " + CONTAINER + " 2>/dev/null)\"",
  "command -v javac >/dev/null && echo javac",
  "echo \"helperSource $(fingerprint \"$2\")\"",
  "echo \"helperInstalled $(test -x \"$HOME/" + HELPER_DIR + "/bin/miharchy-sync\" && cat \"$HOME/" + HELPER_DIR + "/source.sha256\")\"",
  "printf '%s' \"$3\" | cmp -s - \"$HOME/" + DESKTOP_FILE + "\" && echo launcher",
  HAS_PEEK_KEY + " \"$HOME/" + BINDINGS_FILE + "\" && echo peekKey"
].join("\n")

// $1 is peekLine(). A bind the user already has, on any key, stays as it
// is; a taken key, binds hyprctl cannot list or a missing file leave the
// line to paste.
var PEEK_SCRIPT = [
  "file=$HOME/" + BINDINGS_FILE,
  HAS_PEEK_KEY + " \"$file\" && { echo \"$file already has a peek key.\"; exit 0; }",
  "test -f \"$file\" || { echo \"There is no $file. Add this line to your Hyprland bindings: $1\"; exit 1; }",
  "binds=$(hyprctl binds -j 2>/dev/null) || { echo \"Hyprland did not list its binds. Add this line to $file with a free key: $1\"; exit 1; }",
  "printf '%s' \"$binds\" | jq -e '.[] | select(.modmask == 64 and (.key | ascii_upcase) == \"M\")' >/dev/null && { echo \"" + PEEK_KEY + " is taken. Add this line to $file with a free key: $1\"; exit 1; }",
  "printf '\\n%s\\n' \"$1\" >> \"$file\" && echo \"Added " + PEEK_KEY + " to $file.\""
].join("\n")

// $1 is the plugin's sync/. Gradle writes build/, .gradle/ and .kotlin/
// into the folder it builds, so it builds a copy. The old helper stays
// until the new one is complete.
var BUILD_SCRIPT = [
  FINGERPRINT,
  "work=$HOME/.local/share/miharchy/sync-src",
  "helper=$HOME/" + HELPER_DIR,
  "rm -rf \"$work\" \"$helper.new\" && mkdir -p \"$work\" || exit",
  "tar -C \"$1\" --exclude=./build --exclude=./.gradle --exclude=./.kotlin -cf - . | tar -C \"$work\" -xf - || exit",
  "cd \"$work\" && sh ./gradlew --no-daemon --console=plain installDist || exit",
  "cp -r build/install/miharchy-sync \"$helper.new\" && fingerprint \"$work\" > \"$helper.new/source.sha256\" || exit",
  "rm -rf \"$helper\" && mv \"$helper.new\" \"$helper\" || exit",
  "echo \"Installed the sync helper in $helper.\""
].join("\n")

// docker start makes a rerun reuse the container; the loop waits for the
// first answer so the step only reports done once FlareSolverr serves.
var FLARE_SCRIPT = [
  "docker start " + CONTAINER + " >/dev/null 2>&1 || docker run -d --name " + CONTAINER + " --restart unless-stopped -p 127.0.0.1:8191:8191 ghcr.io/flaresolverr/flaresolverr:latest || exit",
  "for i in $(seq 60); do curl -fs " + FLARE_URL + " >/dev/null && echo \"FlareSolverr answers on " + FLARE_URL + "\" && exit 0; sleep 1; done",
  "echo \"FlareSolverr did not answer on " + FLARE_URL + " within 60 s.\"",
  "exit 1"
].join("\n")

var SERVER_QUERY = "{ settings { flareSolverrEnabled flareSolverrUrl flareSolverrAsResponseFallback } metas { nodes { key value } } aboutServer { version } }"

// A job's argv. The script's output, stderr included, ends with its exit
// status on the last line, because Process gives no order between its exit
// and the end of its output.
function command(script, args) {
  return ["/bin/sh", "-c", "(\n" + script + "\n) 2>&1\nprintf '\\n%s\\n' \"$?\"", "sh"].concat(args || [])
}

// The launcher entry for the plugin's window/. Exec quotes its path as the
// desktop entry spec says: \ " ` $ escaped, then \ escaped again for the
// key file. A % in the path stays unsupported: GLib, which gtk-launch uses,
// refuses an entry whose program path holds the spec's %% escape.
function desktopEntry(windowDir) {
  var exec = String(windowDir + "/miharchy").replace(/["`$\\]/g, "\\$&").replace(/\\/g, "\\\\")
  return [
    "[Desktop Entry]",
    "Type=Application",
    "Name=Miharchy",
    "Comment=Read manga",
    "Exec=\"" + exec + "\"",
    "Icon=" + windowDir.replace(/\/window$/, "") + "/icons/miharchy.svg",
    "Terminal=false",
    "Categories=Graphics;Viewer;",
    ""
  ].join("\n")
}

// The bindings.lua line for the plugin's window/: Omarchy's o.bind runs its
// command through a shell, so the path is single-quoted inside a Lua string.
function peekLine(windowDir) {
  var cmd = "'" + String(windowDir + "/miharchy").replace(/'/g, "'\\''") + "' peek"
  return "o.bind(\"" + PEEK_KEY + "\", \"Miharchy peek\", " + JSON.stringify(cmd) + ")"
}

// $1 is the sync folder. Phone backups count only at its top, where the
// sync reads them; an autobackup folder below means Mihon's storage folder
// was shared instead of its autobackup folder.
var PHONE_PROBE = [
  "list=$(find \"$1\" -maxdepth 1 -type f -name '*.tachibk' ! -name 'miharchy-*' -printf '%T@ %f\\n' 2>/dev/null | sort -n)",
  "echo \"phones $(printf '%s' \"$list\" | grep -c .)\"",
  "echo \"newest $(printf '%s\\n' \"$list\" | tail -n 1 | cut -d' ' -f2-)\"",
  "test -d \"$1/autobackup\" && echo autobackup"
].join("\n")

function phoneProbeCommand(folder) {
  return command(PHONE_PROBE, [folder])
}

// The phone check's output -> { count, newest, autobackup }.
function parsePhones(text) {
  var f = { count: 0, newest: "", autobackup: false }
  String(text).split("\n").forEach(function(line) {
    var sp = line.indexOf(" ")
    var key = sp === -1 ? line : line.slice(0, sp)
    var rest = sp === -1 ? "" : line.slice(sp + 1).trim()
    if (key === "phones") f.count = parseInt(rest, 10) || 0
    if (key === "newest") f.newest = rest
    if (key === "autobackup") f.autobackup = true
  })
  return f
}

// Syncthing's own config names its API address and key. Read by the
// phone check's Syncthing part and by the accept, never shown.
var SYNCTHING_API = [
  "cfg=$HOME/.local/state/syncthing/config.xml",
  "[ -f \"$cfg\" ] || cfg=$HOME/.config/syncthing/config.xml",
  "addr=$(awk '/<gui[ >]/{g=1} g&&/<address>/{gsub(/.*<address>|<\\/address>.*/,\"\"); print; exit}' \"$cfg\" 2>/dev/null)",
  "key=$(sed -n 's:.*<apikey>\\(.*\\)</apikey>.*:\\1:p' \"$cfg\" 2>/dev/null | head -n 1)",
  "api() { curl -fsS -m 3 -H \"X-API-Key: $key\" \"http://$addr/rest/$1\"; }"
].join("\n")

// $1 is the sync folder, $2 where to write the desktop ID as a QR code.
// Each line prints one fact; parseSyncthing reads them.
var SYNCTHING_PROBE = SYNCTHING_API + "\n" + [
  "[ -f \"$cfg\" ] || exit 0",
  "echo installed",
  "status=$(api system/status 2>/dev/null) || exit 0",
  "echo answering",
  "id=$(printf '%s' \"$status\" | jq -r .myID)",
  "echo \"myID $id\"",
  "want=$(realpath -m \"$1\")",
  "api config/folders | jq -r --arg home \"$HOME\" '.[] | select((.devices | length) > 1) | .path | sub(\"^~\"; $home)' | while IFS= read -r p; do [ \"$(realpath -m \"$p\")\" = \"$want\" ] && echo shared; done | head -n 1",
  "api config/devices | jq -e --arg me \"$id\" 'any(.[]; .deviceID != $me)' >/dev/null && echo knowsPhone",
  "echo \"pendingDevices $(api cluster/pending/devices | jq -c '[to_entries[] | {id: .key, name: .value.name}]')\"",
  "echo \"pendingFolders $(api cluster/pending/folders | jq -c '[to_entries[] | .key as $id | .value.offeredBy | to_entries[] | {id: $id, label: .value.label, device: .key}]')\"",
  "command -v qrencode >/dev/null && mkdir -p \"$(dirname \"$2\")\" && qrencode -o \"$2\" \"$id\" && echo \"qr $2\""
].join("\n")

// $1 the sync folder; $2 and $3 the phone's device id and name, or empty;
// $4, $5, $6 the offered folder's id, label and device, or empty. Syncthing
// adds this desktop to a folder on its own (ensureDevicePresent in its
// lib/config/folderconfiguration.go).
var SYNCTHING_ACCEPT = SYNCTHING_API + "\n" + [
  "post() { curl -fsS -m 5 -H \"X-API-Key: $key\" -H \"Content-Type: application/json\" -X POST -d \"$2\" \"http://$addr/rest/$1\" >/dev/null 2>&1; }",
  "if [ -n \"$2\" ]; then",
  "  post config/devices \"$(jq -nc --arg id \"$2\" --arg name \"$3\" '{deviceID: $id, name: $name}')\" || { echo \"Syncthing did not take the device. Accept it at http://$addr.\"; exit 1; }",
  "  echo \"Syncthing now knows $3.\"",
  "fi",
  "if [ -n \"$4\" ]; then",
  "  post config/folders \"$(jq -nc --arg id \"$4\" --arg label \"$5\" --arg path \"$1\" --arg dev \"$6\" '{id: $id, label: $label, path: $path, type: \"sendreceive\", devices: [{deviceID: $dev}]}')\" || { echo \"Syncthing did not take the folder. Accept it at http://$addr.\"; exit 1; }",
  "  echo \"Syncthing now receives \\\"$5\\\" in $1.\"",
  "fi"
].join("\n")

function syncthingProbeCommand(folder, qrPath) {
  return command(SYNCTHING_PROBE, [folder, qrPath])
}

// The Syncthing check's output -> { installed (Syncthing wrote its config,
// so it was installed and started once), answering, myId, shared,
// knowsPhone (a device besides this desktop is configured),
// pendingDevices: [{ id, name }], pendingFolders: [{ id, label, device }], qr }.
function parseSyncthing(text) {
  var f = { installed: false, answering: false, myId: "", shared: false, knowsPhone: false, pendingDevices: [], pendingFolders: [], qr: "" }
  String(text).split("\n").forEach(function(line) {
    var sp = line.indexOf(" ")
    var key = sp === -1 ? line : line.slice(0, sp)
    var rest = sp === -1 ? "" : line.slice(sp + 1).trim()
    if (key === "installed") f.installed = true
    if (key === "answering") f.answering = true
    if (key === "myID") f.myId = rest
    if (key === "shared") f.shared = true
    if (key === "knowsPhone") f.knowsPhone = true
    if (key === "qr") f.qr = rest
    if (key === "pendingDevices" || key === "pendingFolders") try { f[key] = JSON.parse(rest) } catch (e) { f[key] = [] }
  })
  return f
}

function probeCommand(configPath, syncDir, windowDir, skipAur) {
  return command(PROBE, [configPath, syncDir, desktopEntry(windowDir), windowDir.replace(/\/window$/, "") + "/server/miharchy-server.service", skipAur ? "1" : ""])
}

// The job a confirmed or committed step runs.
// ctx: { serverScript, folder, syncDir, windowDir, pair: pairing() }.
function runCommand(id, ctx) {
  switch (id) {
    case "server": return command("\"$1\"", [ctx.serverScript])
    case "flaresolverr": return command(FLARE_SCRIPT)
    case "syncFolder": return command("test -d \"$1\" || { echo \"$1 is not a folder.\"; exit 1; }", [ctx.folder])
    case "helper": return command(BUILD_SCRIPT, [ctx.syncDir])
    case "phoneBackups":
      var d = ctx.pair.device, f = ctx.pair.folder
      return command(SYNCTHING_ACCEPT, [ctx.folder, d ? d.id : "", d ? d.name : "", f ? f.id : "", f ? f.label : "", f ? f.device : ""])
    case "peekKey": return command(PEEK_SCRIPT, [peekLine(ctx.windowDir)])
    case "launcher": return command("file=$HOME/" + DESKTOP_FILE + "\nmkdir -p \"$(dirname \"$file\")\" && printf '%s' \"$1\" > \"$file\" && echo \"Wrote $file.\"", [desktopEntry(ctx.windowDir)])
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
  var f = { java: 0, suwayomi: false, websockets: false, config: false, unitEnabled: false, unitActive: false, docker: false, container: false, javac: false, helperSource: "", helperInstalled: "", aurSuwayomi: "", launcher: false, peekKey: false, unitCurrent: false, basicAuth: false }
  String(text).split("\n").forEach(function(line) {
    var sp = line.indexOf(" ")
    var key = sp === -1 ? line : line.slice(0, sp)
    var rest = sp === -1 ? "" : line.slice(sp + 1)
    var words = rest.split(/\s+/)
    if (key === "java") f.java = javaMajor(rest)
    if (key === "suwayomi") f.suwayomi = true
    if (key === "websockets") f.websockets = true
    if (key === "config") f.config = true
    if (key === "unit") {
      f.unitEnabled = words.indexOf("enabled") !== -1
      f.unitActive = words.indexOf("active") !== -1
    }
    if (key === "docker") {
      f.docker = true
      f.container = rest.trim() === "true"
    }
    if (key === "javac") f.javac = true
    if (key === "launcher") f.launcher = true
    if (key === "peekKey") f.peekKey = true
    if (key === "unitCurrent") f.unitCurrent = true
    if (key === "basicAuth") f.basicAuth = true
    if (key === "helperSource") f.helperSource = rest.trim()
    if (key === "helperInstalled") f.helperInstalled = rest.trim()
    if (key === "aurSuwayomi") f.aurSuwayomi = rest.trim()
  })
  return f
}

var OFFERED_META = Settings.META_PREFIX + "setupOffered"

// A GraphQL reply (Model.reply) to SERVER_QUERY -> { flare, syncFolder,
// offered, version }.
function parseServer(data) {
  var metas = (data.metas && data.metas.nodes) || []
  var value = function(key) {
    var m = metas.filter(function(n) { return n.key === key })[0]
    return m ? String(m.value) : ""
  }
  var offered = value(OFFERED_META)
  return { flare: data.settings || {}, syncFolder: value(Settings.META_PREFIX + "syncFolder"), offered: offered ? offered.split(",") : [], version: (data.aboutServer && data.aboutServer.version) || "" }
}

// The newer-server warning above the steps, or "". It opens nothing and
// leaves every step's state alone.
function warning(s) {
  return s.server ? Session.versionWarning(s.server.version) : ""
}

// setup.probe: parseProbe() facts, null before the first check.
// setup.server: parseServer() result, null until the server answers.
// setup.job: the id of the running job ("probe" or a step id), or null.
// setup.confirm: the step id waiting for y, or null.
// setup.results: step id -> parseJob() of its last run.
// setup.phones: parsePhones() of the sync folder, null before the phone check.
// setup.syncthing: parseSyncthing(), null before its check.
function initial() {
  return { probe: null, server: null, serverMessage: "", job: null, confirm: null, results: {}, phones: null, syncthing: null }
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
      if (event.id === "phones") return copy(s, { job: null, phones: parsePhones(parseJob(event.text).output) })
      if (event.id === "syncthing") return copy(s, { job: null, syncthing: parseSyncthing(parseJob(event.text).output) })
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

// The packages a stock Omarchy lacks, as the probe found them.
function missingPackages(p) {
  var m = []
  if (p.java < 21) m.push({ pkg: "jdk-openjdk", label: "jdk-openjdk (Java 21 or newer)" })
  if (!p.websockets) m.push({ pkg: "qt6-websockets", label: "qt6-websockets" })
  if (!p.suwayomi) m.push({ pkg: "suwayomi-server-bin", label: "suwayomi-server-bin", aur: true })
  return m
}

// The command the terminal runs: Omarchy's installers, Arch then the AUR.
function installCommand(missing) {
  var arch = missing.filter(function(m) { return !m.aur }).map(function(m) { return m.pkg })
  var parts = []
  if (arch.length) parts.push("omarchy-pkg-add " + arch.join(" "))
  if (missing.some(function(m) { return m.aur })) parts.push("omarchy-pkg-aur-add suwayomi-server-bin")
  return parts.join(" && ")
}

function andList(xs) {
  return xs.length < 2 ? xs.join("") : xs.slice(0, -1).join(", ") + " and " + xs[xs.length - 1]
}

// The terminal opened (its launcher returns at once) and packages are still
// missing: Setup rechecks until they are in.
function installing(s) {
  var r = s.results.packages
  return !!(r && r.code === 0 && s.probe && missingPackages(s.probe).length)
}

// A step's status: { state, detail } with state
// "checking" | "running" | "done" | "todo" | "outdated" | "waiting" | "unavailable".
// A step may add prompt (its y/n question), command (shown to the user) or qr.
function status(s, id) {
  var is = function(state, detail) { return { state: state, detail: detail } }
  if (s.job === id) return is("running", "")
  if (!s.probe) return is("checking", "")
  var p = s.probe
  switch (id) {
    case "packages":
      var missing = missingPackages(p)
      if (!missing.length) return is("done", "Java " + p.java + ", Suwayomi-Server and Qt WebSockets are installed.")
      var names = andList(missing.map(function(m) { return m.pkg }))
      var prompt = "Install " + names + " in a terminal?"
      if (!p.suwayomi && Session.newerThanApproved(p.aurSuwayomi)) prompt = "The AUR has Suwayomi-Server " + p.aurSuwayomi + "; Miharchy is checked with " + Session.APPROVED_SUWAYOMI + ", and login may fail. Install " + names + " anyway?"
      else if (!p.suwayomi && p.aurSuwayomi === "?") prompt = "yay could not tell the AUR's Suwayomi-Server version. " + prompt
      return { state: "todo", command: installCommand(missing), prompt: prompt,
        detail: installing(s) ? "Installing in the terminal. Setup checks again every 5 s; Enter opens the terminal again."
          : "Missing: " + missing.map(function(m) { return m.label }).join(", ") + ". Press Enter to install them through Omarchy in a terminal; you type your password there." }
    case "server":
      if (status(s, "packages").state !== "done") return is("waiting", "Needs the packages first.")
      // Miharchy logs in with tokens (ADR 0005); servers set up before that run basic_auth.
      if (p.config && p.unitEnabled && p.unitActive && p.basicAuth) return is("outdated", "The server still uses basic_auth. Press Enter to run server/miharchy-server again; it moves the server to token login and keeps your credentials.")
      if (p.config && p.unitEnabled && p.unitActive && !p.unitCurrent) return is("outdated", "The plugin's server unit changed. Press Enter to run server/miharchy-server again; it keeps your credentials.")
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
    case "phoneBackups":
      if (status(s, "syncFolder").state !== "done") return is("waiting", "Needs the sync folder first.")
      if (!s.phones) return is("checking", "")
      var folder = s.server.syncFolder
      var ph = s.phones
      if (ph.count) return is("done", ph.count + " phone backup" + (ph.count === 1 ? "" : "s") + " in the sync folder, the newest " + ph.newest + ".")
      if (ph.autobackup) return is("todo", folder + " looks like Mihon's storage folder: its phone backups are in the autobackup folder below. Set the sync folder to " + folder + "/autobackup, or share only that folder. Setup checks again on its own.")
      return phoneTodo(s, folder)
    case "helper":
      if (!p.javac) return is("waiting", "Building needs a JDK. Install it with: sudo pacman -S jdk-openjdk. Then press Enter to check again.")
      if (p.helperInstalled && p.helperInstalled === p.helperSource) return is("done", "Installed in ~/" + HELPER_DIR + ".")
      if (p.helperInstalled) return is("outdated", "The plugin's sync/ changed since the last build. Press Enter to build it again.")
      return is("todo", "Press Enter to build the sync helper into ~/" + HELPER_DIR + ". The first build downloads Gradle and libraries.")
    case "launcher":
      if (p.launcher) return is("done", "Miharchy is in the app launcher.")
      return is("todo", "Press Enter to add Miharchy to the app launcher: ~/" + DESKTOP_FILE + ".")
    case "peekKey":
      if (p.peekKey) return is("done", "A key in ~/" + BINDINGS_FILE + " shows and hides a peek.")
      return is("todo", "Press Enter to add " + PEEK_KEY + ", which shows and hides a peek, to ~/" + BINDINGS_FILE + ".")
  }
  return is("checking", "")
}

var AGAIN = " Setup checks again on its own."

// What the phone backups step asks while no phone backup has landed: the
// Mihon steps, led by where Syncthing stands when it was checked.
function phoneTodo(s, folder) {
  var st = s.syncthing
  var none = "No phone backup in " + folder + " yet. "
  if (!st) return { state: "todo", detail: none + "In Mihon, turn on automatic backups (More → Settings → Data and storage) and share its autobackup folder with this folder. Then tap Create backup in Mihon, or wait for the automatic one." + AGAIN }
  if (!st.installed) return { state: "todo", detail: none + "To share it with your phone through Syncthing, install and start it: sudo pacman -S syncthing, then systemctl --user enable --now syncthing." + AGAIN }
  if (!st.answering) return { state: "todo", detail: none + "Syncthing does not answer: start it with systemctl --user enable --now syncthing." + AGAIN }
  if (st.shared) return { state: "todo", detail: none + "Syncthing shares this folder with your phone. In Mihon, turn on automatic backups (More → Settings → Data and storage), then tap Create backup, or wait for the automatic one." + AGAIN }
  var pair = pairing(s)
  if (pair.device) return { state: "todo", prompt: "Accept " + pair.device.name + " in Syncthing?", detail: "Your phone " + pair.device.name + " wants to connect through Syncthing. Press Enter, then y, to accept it. Then, in Syncthing-Fork, share Mihon's autobackup folder with this desktop." }
  if (pair.folder) return { state: "todo", prompt: "Accept the folder \"" + pair.folder.label + "\" into " + folder + "?", detail: "Your phone offers the folder \"" + pair.folder.label + "\". Press Enter, then y, to receive it in " + folder + "." }
  if (st.pendingFolders.length) return { state: "todo", detail: "Your phone offers several folders: " + st.pendingFolders.map(function(f) { return f.label }).join(", ") + ". Accept Mihon's autobackup folder at http://127.0.0.1:8384, with " + folder + " as its folder path." + AGAIN }
  // Accepted, but its folder share has not arrived yet: no new QR code.
  if (st.knowsPhone) return { state: "todo", detail: "Syncthing knows your phone. In Syncthing-Fork, share Mihon's autobackup folder with this desktop." + AGAIN }
  if (!st.qr) return { state: "todo", detail: "In Syncthing-Fork on your phone, add this desktop: enter " + st.myId + ". Then share Mihon's autobackup folder with it. To show the ID as a QR code, install qrencode: sudo pacman -S qrencode." + AGAIN }
  return { state: "todo", qr: st.qr, detail: "In Syncthing-Fork on your phone, add this desktop: scan the code, or enter " + st.myId + ". Then share Mihon's autobackup folder with it." + AGAIN }
}

// What y accepts in Syncthing: the phone's pending device, or the folder it
// offers when it offers one, or one named autobackup among several.
function pairing(s) {
  var st = s.syncthing
  var folders = st ? st.pendingFolders : []
  var named = folders.filter(function(f) { return /autobackup/i.test(f.label + " " + f.id) })
  return {
    device: st && st.pendingDevices.length ? st.pendingDevices[0] : null,
    folder: folders.length === 1 ? folders[0] : named.length === 1 ? named[0] : null
  }
}

// What Enter does on a step: "check" runs the probe again, "confirm" asks
// before a run, "edit" opens the folder field, null does nothing.
function action(s, id) {
  if (s.job) return null
  var st = status(s, id).state
  if (st === "checking") return null
  var kind = step(id).kind
  if (kind === "check" && status(s, id).prompt) return "confirm"
  if (kind === "install") return st === "todo" ? "confirm" : "check"
  if (kind === "install" || kind === "check" || st === "waiting" || st === "unavailable") return "check"
  return kind === "run" ? "confirm" : "edit"
}

// True once checked and some required step is not done.
function incomplete(s) {
  if (!s.probe) return false
  return STEPS.some(function(st) { return st.required && status(s, st.id).state !== "done" })
}

// The optional steps that are due, one key each: "launcher:todo", or for
// an out-of-date helper its source fingerprint, so each plugin update that
// changes sync/ is offered once. Empty until the probe and the server reply
// are both in, since some steps depend on the server, and until the phone
// check is in once a sync folder is set.
function offers(s) {
  if (!s.probe || !s.server || (s.server.syncFolder && !s.phones)) return []
  var keys = []
  STEPS.forEach(function(st) {
    if (st.required) return
    var state = status(s, st.id).state
    if (state === "todo") keys.push(st.id + ":todo")
    if (state === "outdated") keys.push(st.id + ":outdated:" + s.probe.helperSource.slice(0, 12))
  })
  return keys
}

// Whether this window makes the one-time offer. One started on a target
// (a peek, a chapter, Updates) opens something else, so Setup would never
// show and the offer would be lost; the next plain launch makes it.
// env: the window's MIHARCHY_PEEK, MIHARCHY_OPEN_CHAPTER, MIHARCHY_OPEN_VIEW.
function offersOnStart(env) {
  return !env.MIHARCHY_PEEK && !env.MIHARCHY_OPEN_CHAPTER && !env.MIHARCHY_OPEN_VIEW
}

// Due steps the user has not been shown yet; Setup opens once for these.
function unoffered(s) {
  var seen = s.server ? s.server.offered : []
  return offers(s).filter(function(k) { return seen.indexOf(k) === -1 })
}

// Records what is due now as offered, so a step the user skips stays quiet
// until it changes.
function offerPayload(s) {
  return {
    query: "mutation($key: String!, $value: String!) { setGlobalMeta(input: { meta: { key: $key, value: $value } }) { meta { key } } }",
    variables: { key: OFFERED_META, value: offers(s).join(",") }
  }
}

// The step the cursor starts on: the first one not done, or the first.
function next(s) {
  for (var i = 0; i < STEPS.length; i++) if (status(s, STEPS[i].id).state !== "done") return i
  return 0
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
    HELPER_DIR: HELPER_DIR,
    STEPS: STEPS,
    SERVER_QUERY: SERVER_QUERY,
    command: command,
    probeCommand: probeCommand,
    phoneProbeCommand: phoneProbeCommand,
    parsePhones: parsePhones,
    syncthingProbeCommand: syncthingProbeCommand,
    parseSyncthing: parseSyncthing,
    pairing: pairing,
    installing: installing,
    desktopEntry: desktopEntry,
    runCommand: runCommand,
    parseJob: parseJob,
    parseProbe: parseProbe,
    initial: initial,
    reduce: reduce,
    status: status,
    warning: warning,
    action: action,
    incomplete: incomplete,
    offers: offers,
    offersOnStart: offersOnStart,
    unoffered: unoffered,
    offerPayload: offerPayload,
    next: next,
    savePayload: savePayload
  }
}
