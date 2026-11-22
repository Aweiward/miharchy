// Setup's miharchy-core steps (MIHARCHY_BACKEND=core, #385): build, unit and move.
const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { execFileSync } = require("node:child_process");
const S = require("./load")("Setup.js");
const M = require("./load")("Model.js");

const run = (argv, env) => execFileSync(argv[0], argv.slice(1), { encoding: "utf8", env });
const finish = (s, id, text) => S.reduce(S.reduce(s, { type: "start", id }), { type: "finish", id, text });
const core = (status, body) => M.coreReply(status, JSON.stringify(body));
const READY = "java openjdk version \"26.0.2.1\" 2026-08-18\nsuwayomi\nwebsockets\nconfig\nunit enabled active\nunitCurrent\njavac\n";
const CORE_UP = "coreSource abc\ncoreInstalled abc\ncoreUnit enabled active\ncoreUnitCurrent\ncoreConfig\n";

function write(file, text, mode) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, text, mode ? { mode } : undefined);
}

// A plugin folder with core/ and sync/, a scratch HOME, and a systemctl
// that logs its calls and writes core.json on enable, as core's first start does.
function fakeCore() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "miharchy-core-"));
  const plugin = path.join(dir, "plugin");
  write(path.join(plugin, "sync/src/Main.kt"), "fun main() {}\n");
  write(path.join(plugin, "sync/build/old/junk"), "stale\n");
  write(path.join(plugin, "core/server/src/Main.kt"), "fun main() {}\n");
  write(path.join(plugin, "core/server/build/old/junk"), "stale\n");
  write(path.join(plugin, "core/.gradle/x"), "cache\n");
  write(path.join(plugin, "core/server/miharchy-core.service"), "[Service]\nExecStart=%h/.local/share/miharchy/core-app/bin/miharchy-core\n");
  write(path.join(plugin, "core/gradlew"), [
    "[ \"$*\" = '--no-daemon --console=plain :server:installDist' ] || exit 2",
    "test -e server/build/old && { echo 'build/ was copied'; exit 3; }",
    "test -f ../sync/src/Main.kt || { echo 'sync/ is not beside core/'; exit 4; }",
    "mkdir -p server/build/install/miharchy-core/bin",
    "printf '#!/bin/sh\\necho core\\n' > server/build/install/miharchy-core/bin/miharchy-core",
    "chmod +x server/build/install/miharchy-core/bin/miharchy-core",
    "echo BUILD SUCCESSFUL"
  ].join("\n"));
  const home = path.join(dir, "home");
  const coreJson = path.join(home, ".config/miharchy/core.json");
  const log = path.join(dir, "systemctl.log");
  const bin = path.join(dir, "bin");
  write(path.join(bin, "javac"), "#!/bin/sh\ntrue\n", 0o755);
  write(path.join(bin, "systemctl"), [
    "#!/bin/sh",
    "echo \"$*\" >> " + JSON.stringify(log),
    "case \"$*\" in",
    "  *is-enabled*) test -e " + JSON.stringify(path.join(dir, "enabled")) + " && echo enabled || echo disabled ;;",
    "  *is-active*) test -e " + JSON.stringify(path.join(dir, "enabled")) + " && echo active || echo inactive ;;",
    "  *'enable --now'*) touch " + JSON.stringify(path.join(dir, "enabled")) + "; mkdir -p " + JSON.stringify(path.dirname(coreJson)) + "; echo '{}' > " + JSON.stringify(coreJson) + " ;;",
    "esac"
  ].join("\n"), 0o755);
  fs.mkdirSync(home, { recursive: true });
  const env = { ...process.env, HOME: home, PATH: bin + ":" + process.env.PATH };
  const windowDir = path.join(plugin, "window");
  const probe = (s, coreConfigPath) => finish(s || S.initial(true), "probe", run(S.probeCommand(path.join(home, "none.json"), path.join(plugin, "sync"), windowDir, true, coreConfigPath === undefined ? coreJson : coreConfigPath), env));
  const step = (id) => S.parseJob(run(S.runCommand(id, { windowDir, coreConfigPath: coreJson }), env));
  const calls = () => (fs.existsSync(log) ? fs.readFileSync(log, "utf8").trim().split("\n") : []);
  return { plugin, home, coreJson, probe, step, calls, app: path.join(home, S.CORE_DIR, "bin/miharchy-core") };
}

const tree = (dir) => fs.readdirSync(dir, { recursive: true }).sort().map((f) => f + " " + fs.statSync(path.join(dir, f)).mtimeMs);

test("under the switch the core steps follow Suwayomi's service; without it the steps are as before", () => {
  assert.deepEqual(S.steps(S.initial()).map((s) => s.id), S.STEPS.map((s) => s.id));
  assert.ok(!S.STEPS.some((s) => ["coreBuild", "coreService", "move"].includes(s.id)));
  assert.deepEqual(S.steps(S.initial(true)).map((s) => s.id).slice(0, 6), ["packages", "server", "coreBuild", "coreService", "move", "flaresolverr"]);
  const req = S.steps(S.initial(true)).filter((s) => s.required).map((s) => s.id);
  assert.deepEqual(req, ["packages", "server", "coreBuild", "coreService"]);
  assert.ok(!S.steps(S.initial(true)).some((s) => s.id === "helper"), "nothing runs the helper under the switch");
});

test("core builds from a copy of core/ and sync/, installs outside the plugin, and restarts a running core", () => {
  const t = fakeCore();
  assert.equal(S.status(t.probe(), "coreBuild").state, "todo");
  const before = tree(t.plugin);
  const r = t.step("coreBuild");
  assert.equal(r.code, 0, r.output);
  assert.match(r.output, /BUILD SUCCESSFUL[\s\S]*Installed miharchy-core in .+\/\.local\/share\/miharchy\/core-app\./);
  assert.equal(run([t.app], process.env), "core\n");
  assert.deepEqual(tree(t.plugin), before, "nothing written inside the plugin");
  assert.deepEqual(t.calls().filter((c) => !c.includes("is-")), ["--user try-restart miharchy-core.service"]);
  assert.equal(S.status(t.probe(), "coreBuild").state, "done");
  // Build output anywhere does not count; a source change does.
  write(path.join(t.plugin, "core/host/build/x"), "out\n");
  assert.equal(S.status(t.probe(), "coreBuild").state, "done");
  write(path.join(t.plugin, "sync/src/Main.kt"), "fun main() { println() }\n");
  assert.equal(S.status(t.probe(), "coreBuild").state, "outdated");
  assert.equal(t.step("coreBuild").code, 0);
  assert.equal(S.status(t.probe(), "coreBuild").state, "done");
});

test("the service step installs the unit, starts core, waits for core.json, and restarts only for a changed unit", () => {
  const t = fakeCore();
  t.step("coreBuild");
  let s = t.probe();
  assert.equal(S.status(s, "coreService").state, "todo");
  const r = t.step("coreService");
  assert.equal(r.code, 0, r.output);
  assert.match(r.output, /miharchy-core is running; it wrote .+core\.json\./);
  assert.ok(t.calls().includes("--user enable --now miharchy-core.service"));
  assert.ok(t.calls().includes("--user restart miharchy-core.service"), "a new unit restarts");
  s = t.probe();
  assert.equal(S.status(s, "coreService").state, "done");
  const n = t.calls().length;
  assert.equal(t.step("coreService").code, 0);
  assert.ok(!t.calls().slice(n).includes("--user restart miharchy-core.service"), "the same unit does not restart");
  write(path.join(t.plugin, "core/server/miharchy-core.service"), "[Service]\nExecStart=changed\n");
  s = t.probe();
  assert.equal(S.status(s, "coreBuild").state, "outdated", "the unit is part of core/");
  assert.equal(S.status(s, "coreService").state, "outdated");
});

test("without the switch the probe asks nothing about core", () => {
  const t = fakeCore();
  const s = t.probe(S.initial(), "");
  assert.equal(s.probe.coreSource, "");
  assert.ok(!t.calls().some((c) => c.includes("miharchy-core")), t.calls().join("; "));
});

test("the core steps wait in order, and FlareSolverr is unavailable on core", () => {
  let s = finish(S.initial(true), "probe", READY);
  assert.equal(S.status(s, "coreBuild").state, "todo");
  assert.equal(S.status(s, "coreService").state, "waiting");
  assert.equal(S.status(s, "move").state, "waiting");
  assert.equal(S.status(s, "flaresolverr").state, "unavailable");
  assert.equal(S.status(s, "flaresolverr").label, "not on core");
  assert.ok(S.incomplete(s));
  s = finish(S.initial(true), "probe", READY + CORE_UP);
  assert.equal(S.status(s, "coreService").state, "done");
  assert.ok(!S.incomplete(s));
  // The sync folder waits on core, not on Suwayomi.
  assert.equal(S.status(s, "syncFolder").state, "waiting");
  s = S.reduce(s, { type: "server", reply: core(200, { metas: [{ scope: "global", owner: 0, key: "miharchy.syncFolder", value: "/s" }] }) });
  assert.equal(S.status(s, "syncFolder").state, "done");
  assert.equal(S.status(finish(S.initial(true), "probe", READY.replace("config\n", "") + CORE_UP), "move").state, "unavailable");
});

const IDLE = core(200, { state: "idle", step: null, report: null, error: null });

test("the move runs on core, holds the other steps, and Enter on a done move only checks", () => {
  let s = finish(S.initial(true), "probe", READY + CORE_UP);
  assert.equal(S.status(s, "move").state, "checking", "nothing to offer before core says where the move stands");
  s = S.reduce(s, { type: "move", reply: IDLE });
  assert.equal(S.action(s, "move"), "confirm");
  s = S.reduce(s, { type: "start", id: "move" });
  s = S.reduce(s, { type: "move", reply: core(200, { state: "running", step: "library", report: null, error: null }) });
  assert.equal(S.status(s, "move").state, "running");
  assert.equal(S.status(s, "move").detail, "Moving: library.");
  assert.equal(S.action(s, "coreBuild"), null);
  const report = { repos: 1, extensions: 2, manga: 3, metas: 4, settings: 5, downloads: 6, baselines: [], skipped: ["Setting x: y"] };
  s = S.reduce(s, { type: "move", reply: core(200, { state: "done", step: null, report, error: null }) });
  assert.equal(s.job, null);
  assert.equal(S.status(s, "move").state, "done");
  assert.equal(S.status(s, "move").detail, "Moved 3 manga, 2 extensions, 5 settings, 4 preferences and 6 downloads. Skipped: Setting x: y");
  assert.equal(S.action(s, "move"), "check");
  // A core that does not answer (yet) leaves a done move unknown: Enter only checks.
  s = S.reduce(s, { type: "move", reply: core(0, "") });
  assert.equal(S.status(s, "move").state, "waiting");
  assert.equal(S.action(s, "move"), "check");
  assert.deepEqual(S.offers(S.reduce(s, { type: "server", reply: core(200, { metas: [] }) })).filter((k) => k.startsWith("move")), []);
  // core's error is a failed move, offered again.
  s = S.reduce(S.reduce(s, { type: "start", id: "move" }), { type: "move", reply: core(200, { state: "failed", step: "extensions", report: null, error: { kind: "network", message: "Suwayomi did not answer." } }) });
  // Core's status then carries error, which Model.coreReply reads as the reply's error.
  assert.equal(S.status(s, "move").detail, "The move stopped: Suwayomi did not answer. Press Enter to try again.");
  assert.equal(s.job, null);
  // Read on open: a move still running holds every step, even with another job's slot taken.
  s = S.reduce(S.reduce(finish(S.initial(true), "probe", READY + CORE_UP), { type: "start", id: "phones" }), { type: "move", reply: core(200, { state: "running", step: "metas" }) });
  assert.equal(S.status(s, "move").state, "running");
  s = finish(s, "phones", "");
  assert.equal(S.action(s, "launcher"), null);
});

test("on core the reads and writes are core routes, with the real paths for the move", () => {
  assert.deepEqual(S.serverPayload(true), { route: "meta.get", body: { scope: "global", keys: ["miharchy.syncFolder", "miharchy.setupOffered"] } });
  assert.deepEqual(S.serverPayload(false), { query: S.SERVER_QUERY });
  assert.deepEqual(S.MOVE_STATUS, { route: "move.status", body: {} });
  assert.deepEqual(S.movePayload({ serverConfig: "/h/.config/miharchy/server.json", serverRoot: "/h/.local/share/miharchy/suwayomi", home: "/h" }), {
    route: "move.start", body: { serverConfig: "/h/.config/miharchy/server.json", serverRoot: "/h/.local/share/miharchy/suwayomi", helperSync: "/h/.local/share/miharchy/sync" }
  });
  assert.deepEqual(S.savePayload("syncFolder", { code: 0 }, "/s", true), { route: "meta.set", body: { metas: [{ scope: "global", key: "miharchy.syncFolder", value: "/s" }] } });
  assert.equal(S.savePayload("flaresolverr", { code: 0 }, "", true), null);
  let s = S.reduce(finish(S.initial(true), "probe", READY + CORE_UP), { type: "move", reply: IDLE });
  s = S.reduce(s, { type: "server", reply: core(200, { metas: [] }) });
  assert.deepEqual(S.offers(s), ["move:todo", "syncFolder:todo", "launcher:todo", "peekKey:todo"]);
  assert.deepEqual(S.offerPayload(s), { route: "meta.set", body: { metas: [{ scope: "global", key: "miharchy.setupOffered", value: S.offers(s).join(",") }] } });
});
