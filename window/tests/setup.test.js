const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { execFileSync } = require("node:child_process");
const S = require("./load")("Setup.js");
const M = require("./load")("Model.js");

const run = (argv, env) => execFileSync(argv[0], argv.slice(1), { encoding: "utf8", env: env || process.env });
const finish = (s, id, text) => S.reduce(S.reduce(s, { type: "start", id }), { type: "finish", id, text });
// core's meta.get reply for the given [{ key, value }] metas.
const server = (s, metas) => S.reduce(s, { type: "server", reply: M.coreReply(200, JSON.stringify({ metas: metas || [] })) });
const states = (s) => Object.fromEntries(S.STEPS.map((st) => [st.id, S.status(s, st.id).state]));

// A machine with Java 26, javac, qt6-websockets and a current, running miharchy-core.
const CORE_UP = "coreSource abc\ncoreInstalled abc\ncoreUnit enabled active\ncoreUnitCurrent\ncoreConfig\n";
const READY = "java openjdk version \"26.0.2.1\" 2026-08-18\nwebsockets\njavac\n" + CORE_UP;
const DONE_STATES = { packages: "done", coreBuild: "done", coreService: "done", move: "unavailable", suwayomiOff: "unavailable", flaresolverr: "unavailable", syncFolder: "waiting", phoneBackups: "waiting", launcher: "todo", peekKey: "todo" };

function stubs(files) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "miharchy-setup-"));
  for (const [name, body] of Object.entries(files)) fs.writeFileSync(path.join(dir, name), "#!/bin/sh\n" + body + "\n", { mode: 0o755 });
  fs.symlinkSync("/usr/bin/head", path.join(dir, "head"));
  return dir;
}

test("the probe script reports each fact, with stubs standing in for the system", () => {
  const bin = stubs({
    java: "echo 'openjdk version \"17.0.9\" 2023-10-17' >&2",
    systemctl: "[ \"$2\" = is-enabled ] && echo enabled || echo inactive",
    docker: "echo false"
  });
  const config = path.join(bin, "server.json");
  fs.writeFileSync(config, "{}");
  const f = S.parseProbe(S.parseJob(run(S.probeCommand(config, bin, bin), { PATH: bin, HOME: bin })).output);
  assert.equal(f.java, 17);
  assert.equal(f.config, true, "server.json is a Suwayomi install to move");
  assert.equal(f.unitEnabled, true);
  assert.equal(f.unitActive, false, "inactive is not active");
  assert.equal(f.docker, true);
  assert.equal(f.container, false);
  assert.equal(f.coreSource, "", "no core path: no core facts");

  const bare = S.parseProbe(S.parseJob(run(S.probeCommand(path.join(bin, "none.json"), bin, bin), { PATH: path.join(bin, "empty"), HOME: bin })).output);
  assert.deepEqual([bare.java, bare.config, bare.unitEnabled, bare.docker, bare.javac], [0, false, false, false, false], "no java, config, systemctl, docker or javac");
});

test("a job's output ends with its exit status, even when the script exits early", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "miharchy-setup-"));
  assert.deepEqual(S.parseJob(run(S.runCommand("syncFolder", { folder: dir }))), { code: 0, output: "" });
  assert.deepEqual(S.parseJob(run(S.runCommand("syncFolder", { folder: dir + "/nope" }))), { code: 1, output: dir + "/nope is not a folder." });
});

test("a job its cap or deadline cut short fails", () => {
  assert.equal(S.parseJob("Building\n42 tasks").code, -1, "no status line: a digit-led line is no status");
  const s = S.reduce(S.initial(), { type: "finish", id: "launcher", text: "x".repeat(20000) + "\n0\n" });
  assert.deepEqual(s.results.launcher, { code: -1, output: "The job printed more than 16384 bytes." });
});

test("java versions parse, old and missing ones are not enough", () => {
  const java = (line) => S.parseProbe("java " + line).java;
  assert.equal(java("openjdk version \"21.0.2\" 2024-01-16"), 21);
  assert.equal(java("java version \"1.8.0_201\""), 8);
  assert.equal(java("sh: line 1: java: command not found"), 0);
  assert.equal(S.status(finish(S.initial(), "probe", "java java version \"1.8.0\"\nwebsockets\njavac\n"), "packages").state, "todo");
});

test("no step but packages installs anything, and none runs sudo itself", () => {
  const ctx = { folder: "/", syncDir: "/s", windowDir: "/w", coreConfigPath: "/c.json" };
  for (const id of ["flaresolverr", "syncFolder", "coreBuild", "coreService", "suwayomiOff", "launcher", "peekKey"]) assert.doesNotMatch(S.runCommand(id, ctx).join(" "), /sudo|pacman|yay/, id);
});

test("the Suwayomi server and sync helper steps are gone", () => {
  for (const id of ["server", "helper"]) {
    assert.ok(!S.STEPS.some((st) => st.id === id), id);
    assert.equal(S.runCommand(id, {}), null, id + " runs nothing");
  }
});

test("FlareSolverr runs as a restarting container bound to localhost", () => {
  const script = S.runCommand("flaresolverr", {}).join(" ");
  assert.match(script, /docker start miharchy-flaresolverr/);
  assert.match(script, /docker run -d --name miharchy-flaresolverr --restart unless-stopped -p 127\.0\.0\.1:8191:8191 ghcr\.io\/flaresolverr\/flaresolverr@sha256:[0-9a-f]{64} /);
});

test("nothing is decided before the first check", () => {
  const s = S.initial();
  assert.ok(S.STEPS.every((st) => S.status(s, st.id).state === "checking"));
  assert.equal(S.incomplete(s), false);
  assert.ok(S.STEPS.every((st) => S.action(s, st.id) === null));
});

test("a set-up machine shows its required steps done and is complete", () => {
  const s = finish(S.initial(), "probe", READY);
  assert.deepEqual(states(s), DONE_STATES);
  assert.equal(S.incomplete(s), false);
  const loaded = server(s, []);
  assert.deepEqual(states(loaded), Object.assign({}, DONE_STATES, { syncFolder: "todo" }));
  assert.equal(S.next(loaded), S.STEPS.findIndex((st) => st.id === "move"), "the cursor starts on the first step that is not done, an unavailable one included");
});

test("live updates need qt6-websockets, one of the packages", () => {
  const s = finish(S.initial(), "probe", READY.replace("websockets\n", ""));
  assert.equal(S.status(s, "packages").state, "todo");
  assert.equal(S.status(s, "packages").command, "omarchy-pkg-add qt6-websockets");
  assert.equal(S.incomplete(s), true, "Downloads and Updates stop changing without it");
  const probed = S.parseProbe(S.parseJob(run(S.probeCommand("/none", "/none", "/none"), { PATH: "/none", HOME: "/none" })).output);
  assert.equal(probed.websockets, fs.existsSync("/usr/lib/qt6/qml/QtWebSockets/qmldir"), "the probe looks where pacman installs the module");
});

test("a JRE without javac still needs the JDK, and the core build waits for it", () => {
  const s = finish(S.initial(), "probe", READY.replace("javac\n", ""));
  assert.equal(S.status(s, "packages").state, "todo");
  assert.equal(S.status(s, "packages").command, "omarchy-pkg-add jdk-openjdk");
  assert.equal(S.status(s, "coreBuild").state, "waiting");
  assert.match(S.status(s, "coreBuild").detail, /sudo pacman -S jdk-openjdk/);
  assert.equal(S.action(s, "coreBuild"), "check");
  assert.equal(S.incomplete(s), true);
});

test("missing pieces: each step says what to do, later steps wait", () => {
  const s = finish(S.initial(), "probe", "java sh: java: not found\nunit  \n");
  assert.deepEqual(states(s), { packages: "todo", coreBuild: "waiting", coreService: "waiting", move: "unavailable", suwayomiOff: "unavailable", flaresolverr: "unavailable", syncFolder: "waiting", phoneBackups: "waiting", launcher: "todo", peekKey: "todo" });
  assert.equal(S.incomplete(s), true);
  assert.equal(S.next(s), 0);
  assert.equal(S.action(s, "packages"), "confirm");
  assert.equal(S.action(s, "coreService"), "check", "a waiting step only checks again");
});

test("a stopped unit or a missing core.json leaves the service step to do", () => {
  for (const probe of [READY.replace("enabled active", "disabled inactive"), READY.replace("coreUnit enabled active", "coreUnit disabled inactive"), READY.replace("coreConfig\n", "")]) {
    const s = finish(S.initial(), "probe", probe);
    assert.equal(S.status(s, "coreService").state, "todo", probe);
    assert.equal(S.action(s, "coreService"), "confirm");
    assert.equal(S.incomplete(s), true);
  }
});

test("a run step waits for confirmation and blocks other actions while it runs", () => {
  let s = finish(S.initial(), "probe", READY.replace(/coreInstalled abc\n/, ""));
  assert.equal(S.status(s, "coreBuild").state, "todo");
  s = S.reduce(s, { type: "confirm", id: "coreBuild" });
  assert.equal(s.confirm, "coreBuild");
  assert.equal(S.reduce(s, { type: "cancel" }).confirm, null);
  s = S.reduce(s, { type: "start", id: "coreBuild" });
  assert.equal(s.confirm, null);
  assert.equal(S.status(s, "coreBuild").state, "running");
  assert.equal(S.action(s, "packages"), null);
  s = S.reduce(s, { type: "finish", id: "coreBuild", text: "BUILD SUCCESSFUL\nInstalled miharchy-core in /h/.local/share/miharchy/core-app.\n\n0\n" });
  assert.deepEqual(s.results.coreBuild, { code: 0, output: "BUILD SUCCESSFUL\nInstalled miharchy-core in /h/.local/share/miharchy/core-app." });
  assert.equal(s.job, null);
});

test("the sync folder is stored as miharchy.syncFolder meta and read back", () => {
  const p = S.savePayload("syncFolder", { code: 0 }, "/home/u/Sync");
  assert.deepEqual(p, { route: "meta.set", body: { metas: [{ scope: "global", key: "miharchy.syncFolder", value: "/home/u/Sync" }] } });
  assert.equal(S.savePayload("syncFolder", { code: 1 }, "/home/u/Sync"), null, "a failed run writes nothing");
  const s = server(finish(S.initial(), "probe", READY), [{ key: "syncFolder", value: "/x" }, { key: "miharchy.syncFolder", value: "/home/u/Sync" }]);
  assert.deepEqual(S.status(s, "syncFolder"), { state: "done", detail: "/home/u/Sync" });
  assert.equal(S.action(s, "syncFolder"), "edit", "a done folder can still change");
});

test("running setup twice changes nothing: a done machine stays done after another check", () => {
  const done = READY + "launcher\npeekKey\nnextKey\n";
  const metas = [{ key: "miharchy.syncFolder", value: "/s" }];
  const phones = "phones 1\nnewest app.mihon_2026-10-09_05-31.tachibk\n\n0\n";
  const once = finish(server(finish(S.initial(), "probe", done), metas), "phones", phones);
  const twice = finish(server(finish(once, "probe", done), metas), "phones", phones);
  assert.deepEqual(states(twice), { packages: "done", coreBuild: "done", coreService: "done", move: "unavailable", suwayomiOff: "unavailable", flaresolverr: "unavailable", syncFolder: "done", phoneBackups: "done", launcher: "done", peekKey: "done" });
  assert.deepEqual(states(twice), states(once));
  assert.equal(S.incomplete(twice), false);
});

test("a server that does not answer keeps the server-backed steps waiting", () => {
  const s = S.reduce(finish(S.initial(), "probe", READY), { type: "server", reply: M.coreReply(0, "") });
  assert.equal(s.server, null);
  assert.equal(S.status(s, "syncFolder").state, "waiting");
});

// A scratch HOME with the real PATH, for the launcher entry's probe and run.
function fakeHome() {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "miharchy-home-"));
  return { home, env: { ...process.env, HOME: home } };
}

test("the launcher entry opens window/miharchy and a rerun or a moved plugin is detected", () => {
  const t = fakeHome();
  const file = path.join(t.home, ".local/share/applications/miharchy.desktop");
  const probe = (windowDir) => finish(S.initial(), "probe", run(S.probeCommand("/none", "/none", windowDir), t.env));
  assert.equal(S.status(probe("/p/window"), "launcher").state, "todo");
  const r = S.parseJob(run(S.runCommand("launcher", { windowDir: "/p/window" }), t.env));
  assert.equal(r.code, 0, r.output);
  assert.equal(fs.readFileSync(file, "utf8"), S.desktopEntry("/p/window"));
  assert.match(S.desktopEntry("/p/window"), /^\[Desktop Entry\]\nType=Application\nName=Miharchy\n[\s\S]*Exec="\/p\/window\/miharchy"\nIcon=\/p\/icons\/miharchy\.svg\n/);
  assert.equal(S.status(probe("/p/window"), "launcher").state, "done");
  assert.equal(S.status(probe("/q/window"), "launcher").state, "todo", "a plugin in another folder needs a new entry");
});


test("the launcher Exec line survives spaces, quotes, $ and backslashes", () => {
  assert.ok(S.desktopEntry('/a b/"q"/$x/b\\s').includes(String.raw`Exec="/a b/\\"q\\"/\\$x/b\\\\s/miharchy"` + "\n"));
});

const MACHINE = READY;
// A server that names a sync folder, where the phone check found a phone backup.
const serverWith = (s, offered) => finish(server(s, [{ key: "miharchy.syncFolder", value: "/sync" }].concat(offered === undefined ? [] : [{ key: "miharchy.setupOffered", value: offered }])), "phones", "phones 1\nnewest app.mihon_2026-10-09_05-31.tachibk\n\n0\n");

test("optional steps that are due get offered once, keyed by state", () => {
  const s = serverWith(finish(S.initial(), "probe", MACHINE));
  assert.equal(S.incomplete(s), false, "every required step is done");
  const due = ["launcher:todo", "peekKey:todo"];
  assert.deepEqual(S.offers(s), due);
  assert.deepEqual(S.unoffered(s), due);
  assert.deepEqual(S.offerPayload(s), { route: "meta.set", body: { metas: [{ scope: "global", key: "miharchy.setupOffered", value: due.join(",") }] } });
});

test("a step already offered does not reopen Setup, a newly due one does", () => {
  const seen = serverWith(finish(S.initial(), "probe", MACHINE), "launcher:todo,peekKey:todo");
  assert.deepEqual(S.unoffered(seen), []);
  const changed = serverWith(finish(S.initial(), "probe", MACHINE + "launcher\npeekKey\n"), "launcher:todo,peekKey:todo");
  assert.deepEqual(S.unoffered(changed), ["peekKey:outdated"], "a step that changes state is offered once more");
});

test("nothing is offered before the server answers, and waiting or unavailable steps are never offered", () => {
  assert.deepEqual(S.unoffered(finish(S.initial(), "probe", MACHINE)), [], "no server reply yet");
  const s = serverWith(finish(S.initial(), "probe", READY.replace("javac\n", "")));
  assert.deepEqual(S.offers(s), ["launcher:todo", "peekKey:todo"], "the move, Suwayomi's service and FlareSolverr are unavailable, so they are not offered");
});

test("a user with only the peek key is offered the step once more, for the next key", () => {
  const s = serverWith(finish(S.initial(), "probe", MACHINE + "peekKey\n"), "launcher:todo,peekKey:todo");
  assert.equal(S.status(s, "peekKey").state, "outdated");
  assert.deepEqual(S.unoffered(s), ["peekKey:outdated"]);
});

// The peek key step, against a temporary HOME and a stub hyprctl whose binds are the [modmask, key] pairs given (64 SUPER, 65 SUPER + SHIFT).
function peekHome(bindings, taken, hyprctl) {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "miharchy-peek-"));
  const file = path.join(home, ".config/hypr/bindings.lua");
  if (bindings !== null) {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, bindings);
  }
  const binds = JSON.stringify((taken || []).concat([[8, "M"]]).map(([modmask, key]) => ({ modmask, key })));
  fs.mkdirSync(path.join(home, ".config/hypr"), { recursive: true });
  fs.writeFileSync(path.join(home, ".config/hypr/bindings.conf"), "# old\n");
  const bin = stubs({ hyprctl: hyprctl || "[ \"$*\" = 'binds -j' ] && echo '" + binds + "'" });
  const env = { ...process.env, HOME: home, PATH: bin + ":" + process.env.PATH };
  return {
    file,
    read: () => fs.readFileSync(file, "utf8"),
    add: () => S.parseJob(run(S.runCommand("peekKey", { windowDir: "/p q/window" }), env)),
    conf: () => fs.readFileSync(path.join(home, ".config/hypr/bindings.conf"), "utf8"),
    state: () => S.status(finish(S.initial(), "probe", run(S.probeCommand("/none", "/s", "/p q/window"), env)), "peekKey").state
  };
}
const PEEK_LINE = "o.bind(\"SUPER + M\", \"Miharchy peek\", \"'/p q/window/miharchy' peek\")";
const NEXT_LINE = "o.bind(\"SUPER + CTRL + M\", \"Miharchy next manga\", \"'/p q/window/miharchy' peek-next\")";

test("the peek key step adds SUPER + M and SUPER + CTRL + M to bindings.lua once, then counts as done", () => {
  const t = peekHome("-- mine\n");
  assert.equal(t.state(), "todo");
  const r = t.add();
  assert.equal(r.code, 0, r.output);
  assert.equal(t.read(), "-- mine\n\n" + PEEK_LINE + "\n\n" + NEXT_LINE + "\n");
  assert.equal(t.state(), "done");
  assert.equal(t.add().code, 0);
  assert.equal(t.read(), "-- mine\n\n" + PEEK_LINE + "\n\n" + NEXT_LINE + "\n", "a rerun writes nothing");
  assert.equal(t.conf(), "# old\n", "bindings.conf stays as it is");
});

test("with one of the two binds present, the step is not done and adds only the other", () => {
  const peekOnly = peekHome("-- mine\n" + PEEK_LINE + "\n");
  assert.equal(peekOnly.state(), "outdated");
  assert.equal(peekOnly.add().code, 0);
  assert.equal(peekOnly.read(), "-- mine\n" + PEEK_LINE + "\n\n" + NEXT_LINE + "\n");
  assert.equal(peekOnly.state(), "done");
  const nextOnly = peekHome(NEXT_LINE + "\n");
  assert.equal(nextOnly.state(), "outdated", "peek-next does not count as the peek key");
  assert.equal(nextOnly.add().code, 0);
  assert.equal(nextOnly.read(), NEXT_LINE + "\n\n" + PEEK_LINE + "\n");
});

test("Omarchy's Music on SUPER + SHIFT + M leaves the next key free", () => {
  const t = peekHome("-- mine\n", [[65, "m"]]);
  assert.equal(t.add().code, 0);
  assert.equal(t.state(), "done");
});

test("a taken SUPER + CTRL + M leaves its line to paste and still adds SUPER + M", () => {
  const t = peekHome("-- mine\n", [[68, "m"]]);
  const r = t.add();
  assert.notEqual(r.code, 0);
  assert.ok(r.output.includes("SUPER + CTRL + M is taken") && r.output.includes(NEXT_LINE), r.output);
  assert.equal(t.read(), "-- mine\n\n" + PEEK_LINE + "\n");
  assert.equal(t.state(), "outdated");
});

test("the peek key step shows the lines instead when SUPER + M is taken or bindings.lua is missing", () => {
  const taken = peekHome("-- mine\n", [[64, "M"]]);
  const r = taken.add();
  assert.notEqual(r.code, 0);
  assert.ok(r.output.includes(PEEK_LINE), r.output);
  assert.equal(taken.read(), "-- mine\n\n" + NEXT_LINE + "\n");
  const missing = peekHome(null);
  const m = missing.add();
  assert.notEqual(m.code, 0);
  assert.ok(m.output.includes(PEEK_LINE) && m.output.includes(NEXT_LINE), m.output);
  assert.equal(fs.existsSync(missing.file), false);
});

test("binds the user moved to other keys count as done and are left alone", () => {
  const moved = "o.bind(\"SUPER + ALT + P\", \"Peek\", \"/p/window/miharchy peek\")\no.bind(\"SUPER + ALT + N\", \"Next\", \"/p/window/miharchy peek-next\")\n";
  const t = peekHome(moved);
  assert.equal(t.state(), "done");
  t.add();
  assert.equal(t.read(), moved);
});

test("commented-out binds do not count, and a hyprctl that cannot list the binds leaves the lines to paste", () => {
  const commented = peekHome("-- " + PEEK_LINE + "\n-- " + NEXT_LINE + "\n");
  assert.equal(commented.state(), "todo");
  const blind = peekHome("-- mine\n", [], "exit 1");
  const r = blind.add();
  assert.notEqual(r.code, 0);
  assert.ok(r.output.includes(PEEK_LINE) && r.output.includes(NEXT_LINE), r.output);
  assert.equal(blind.read(), "-- mine\n");
});

test("only a window started with no open target makes the one-time offer", () => {
  assert.equal(S.offersOnStart({}), true, "a plain launch");
  assert.equal(S.offersOnStart({ MIHARCHY_PEEK: "1" }), false, "a peek opens the reader");
  assert.equal(S.offersOnStart({ MIHARCHY_OPEN_CHAPTER: "5 9" }), false, "an update row opens the reader");
  assert.equal(S.offersOnStart({ MIHARCHY_OPEN_VIEW: "updates" }), false, "a notification opens Updates");
  assert.equal(S.offersOnStart({ MIHARCHY_OPEN_CHAPTER: "", MIHARCHY_OPEN_VIEW: "" }), true, "empty values are no target");
});

test("the phone check counts phone backups at the top of the sync folder and spots Mihon's storage folder", () => {
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), "miharchy-phones-"));
  const t = Math.floor(Date.now() / 1000);
  const put = (name, age) => { const p = path.join(folder, name); fs.writeFileSync(p, ""); fs.utimesSync(p, t - age, t - age); };
  const phones = () => S.parsePhones(S.parseJob(run(S.phoneProbeCommand(folder))).output);

  assert.deepEqual(phones(), { count: 0, newest: "", autobackup: false }, "an empty folder");
  put("miharchy-2026-10-09_09-28-12.tachibk", 10);
  put("notes.txt", 10);
  assert.deepEqual(phones(), { count: 0, newest: "", autobackup: false }, "desktop backups are no phone backups");
  fs.mkdirSync(path.join(folder, "autobackup"));
  fs.writeFileSync(path.join(folder, "autobackup", "app.mihon_2026-10-09_05-31.tachibk"), "");
  assert.deepEqual(phones(), { count: 0, newest: "", autobackup: true }, "phone backups one folder down do not count");
  put("app.mihon_2026-10-08_20-30.tachibk", 3600);
  put("app.mihon_2026-10-09_05-31.tachibk", 60);
  assert.deepEqual(phones(), { count: 2, newest: "app.mihon_2026-10-09_05-31.tachibk", autobackup: true });
});

test("the phone backups step waits for the sync folder, then is done once a phone backup has landed", () => {
  const folder = [{ key: "miharchy.syncFolder", value: "/home/u/Sync/mihon-backups" }];
  const ready = server(finish(S.initial(), "probe", READY), []);
  assert.deepEqual(S.status(ready, "phoneBackups"), { state: "waiting", detail: "Needs the sync folder first." });
  const named = server(finish(S.initial(), "probe", READY), folder);
  assert.equal(S.status(named, "phoneBackups").state, "checking");

  const landed = finish(named, "phones", "phones 2\nnewest app.mihon_2026-10-09_05-31.tachibk\n\n0\n");
  assert.deepEqual(S.status(landed, "phoneBackups"), { state: "done", detail: "2 phone backups in the sync folder, the newest app.mihon_2026-10-09_05-31.tachibk." });

  const none = finish(named, "phones", "phones 0\nnewest \n\n0\n");
  assert.deepEqual(S.status(none, "phoneBackups"), { state: "todo", detail: "No phone backup in /home/u/Sync/mihon-backups yet. In Mihon, turn on automatic backups (More → Settings → Data and storage) and share its autobackup folder with this folder. Then tap Create backup in Mihon, or wait for the automatic one. Setup checks again on its own." });

  const storage = finish(named, "phones", "phones 0\nnewest \nautobackup\n\n0\n");
  assert.deepEqual(S.status(storage, "phoneBackups"), { state: "todo", detail: "/home/u/Sync/mihon-backups looks like Mihon's storage folder: its phone backups are in the autobackup folder below. Set the sync folder to /home/u/Sync/mihon-backups/autobackup, or share only that folder. Setup checks again on its own." });
});

test("Enter on the phone backups step checks again, and a phone with no backup yet is offered once", () => {
  const named = server(finish(S.initial(), "probe", READY), [{ key: "miharchy.syncFolder", value: "/s" }]);
  const none = finish(named, "phones", "phones 0\nnewest \n\n0\n");
  const landed = finish(named, "phones", "phones 1\nnewest app.mihon_2026-10-09_05-31.tachibk\n\n0\n");
  assert.equal(S.action(none, "phoneBackups"), "check");
  assert.equal(S.action(landed, "phoneBackups"), "check");
  assert.ok(S.offers(none).includes("phoneBackups:todo"));
  assert.ok(!S.offers(landed).some((k) => k.startsWith("phoneBackups")));
  assert.deepEqual(S.offers(named), [], "nothing is offered before the phone check answers, so the one offer can include it");
});

test("the packages step is done once Java 21+ with javac and Qt WebSockets are in, and keeps Setup open until then", () => {
  assert.deepEqual(S.status(finish(S.initial(), "probe", READY), "packages"), { state: "done", detail: "Java 26 and Qt WebSockets are installed." });
  const none = finish(S.initial(), "probe", "java java version \"1.8.0\"\n");
  assert.deepEqual(S.status(none, "packages"), { state: "todo",
    command: "omarchy-pkg-add jdk-openjdk qt6-websockets",
    prompt: "Install jdk-openjdk and qt6-websockets in a terminal?",
    detail: "Missing: jdk-openjdk (Java 21 or newer, with javac), qt6-websockets. Press Enter to install them through Omarchy in a terminal; you type your password there." });
  assert.equal(S.action(none, "packages"), "confirm");
  assert.equal(S.incomplete(none), true);
  const onlyJava = finish(S.initial(), "probe", READY.replace("26.0.2.1", "17.0.9"));
  assert.equal(S.status(onlyJava, "packages").prompt, "Install jdk-openjdk in a terminal?");
  assert.equal(S.status(onlyJava, "packages").detail, "Missing: jdk-openjdk (Java 21 or newer, with javac). Press Enter to install it through Omarchy in a terminal; you type your password there.");
});

test("after the terminal opens, the step says it is installing and offers the terminal again", () => {
  const none = finish(S.initial(), "probe", "java java version \"1.8.0\"\n");
  const launched = finish(none, "packages", "\n0\n");
  assert.equal(S.status(launched, "packages").detail, "Installing in the terminal. Setup checks again every 5 s; Enter opens the terminal again.");
  assert.equal(S.installing(launched), true);
  assert.equal(S.installing(finish(launched, "probe", READY)), false, "done ends it");
  assert.equal(S.action(launched, "packages"), "confirm");
});

test("y on the packages step opens Omarchy's terminal on exactly the missing packages, and returns at once", () => {
  const record = (cmd) => {
    const bin = stubs({ "omarchy-launch-floating-terminal-with-presentation": "printf '%s' \"$*\" > \"$(dirname \"$0\")/launched\"" });
    const out = S.parseJob(run(S.runCommand("packages", { install: cmd }), { PATH: bin + ":/usr/bin:/bin", HOME: bin }));
    return [out.code, fs.readFileSync(path.join(bin, "launched"), "utf8")];
  };
  const all = S.status(finish(S.initial(), "probe", "java java version \"1.8.0\"\n"), "packages").command;
  assert.deepEqual(record(all), [0, "omarchy-pkg-add jdk-openjdk qt6-websockets"]);
  const websocketsOnly = S.status(finish(S.initial(), "probe", READY.replace("websockets\n", "")), "packages").command;
  assert.deepEqual(record(websocketsOnly), [0, "omarchy-pkg-add qt6-websockets"]);
});
