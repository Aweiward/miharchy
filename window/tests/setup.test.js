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
const server = (s, data) => S.reduce(s, { type: "server", reply: M.reply(200, JSON.stringify({ data })) });
const states = (s) => Object.fromEntries(S.STEPS.map((st) => [st.id, S.status(s, st.id).state]));

const READY = "java openjdk version \"26.0.2.1\" 2026-08-18\nsuwayomi\nconfig\nunit enabled active\nunitCurrent\ndocker \n";
const FLARE_ON = { flareSolverrEnabled: true, flareSolverrUrl: "http://127.0.0.1:8191", flareSolverrAsResponseFallback: true };
const FLARE_OFF = { flareSolverrEnabled: false, flareSolverrUrl: "http://localhost:8191", flareSolverrAsResponseFallback: false };

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
  assert.equal(f.config, true);
  assert.equal(f.unitEnabled, true);
  assert.equal(f.unitActive, false, "inactive is not active");
  assert.equal(f.docker, true);
  assert.equal(f.container, false);

  const bare = S.parseProbe(S.parseJob(run(S.probeCommand(path.join(bin, "none.json"), bin, bin), { PATH: path.join(bin, "empty"), HOME: bin })).output);
  assert.deepEqual([bare.java, bare.config, bare.unitEnabled, bare.docker], [0, false, false, false], "no java, config, systemctl or docker");
});

test("a job's output ends with its exit status, even when the script exits early", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "miharchy-setup-"));
  assert.deepEqual(S.parseJob(run(S.runCommand("syncFolder", { folder: dir }))), { code: 0, output: "" });
  assert.deepEqual(S.parseJob(run(S.runCommand("syncFolder", { folder: dir + "/nope" }))), { code: 1, output: dir + "/nope is not a folder." });
  assert.deepEqual(S.parseJob(run(S.runCommand("server", { serverScript: "/bin/false" }))), { code: 1, output: "" });
});

test("java versions parse, old and missing ones are not enough", () => {
  const java = (line) => S.parseProbe("java " + line).java;
  assert.equal(java("openjdk version \"21.0.2\" 2024-01-16"), 21);
  assert.equal(java("java version \"1.8.0_201\""), 8);
  assert.equal(java("sh: line 1: java: command not found"), 0);
  assert.equal(S.status(finish(S.initial(), "probe", "java java version \"1.8.0\""), "java").state, "todo");
});

test("install commands are shown, never run, and no step uses sudo", () => {
  assert.equal(S.STEPS.find((st) => st.id === "java").command, "sudo pacman -S jdk-openjdk");
  assert.equal(S.STEPS.find((st) => st.id === "suwayomi").command, "yay -S suwayomi-server-bin");
  assert.equal(S.runCommand("java", {}), null);
  assert.equal(S.runCommand("suwayomi", {}), null);
  for (const id of ["server", "flaresolverr", "syncFolder", "helper", "launcher"]) assert.doesNotMatch(S.runCommand(id, { serverScript: "x", folder: "/", syncDir: "/s", windowDir: "/w" }).join(" "), /sudo|pacman|yay/, id);
});

test("FlareSolverr runs as a restarting container bound to localhost", () => {
  const script = S.runCommand("flaresolverr", {}).join(" ");
  assert.match(script, /docker start miharchy-flaresolverr/);
  assert.match(script, /docker run -d --name miharchy-flaresolverr --restart unless-stopped -p 127\.0\.0\.1:8191:8191 ghcr\.io\/flaresolverr\/flaresolverr:latest/);
});

test("nothing is decided before the first check", () => {
  const s = S.initial();
  assert.ok(S.STEPS.every((st) => S.status(s, st.id).state === "checking"));
  assert.equal(S.incomplete(s), false);
  assert.ok(S.STEPS.every((st) => S.action(s, st.id) === null));
});

test("a set-up machine shows steps 1-3 done and is complete", () => {
  const s = finish(S.initial(), "probe", READY);
  assert.deepEqual(states(s), { java: "done", suwayomi: "done", server: "done", flaresolverr: "waiting", syncFolder: "waiting", helper: "waiting", launcher: "todo" });
  assert.equal(S.incomplete(s), false);
  const loaded = server(s, { settings: FLARE_OFF, metas: { nodes: [] } });
  assert.deepEqual(states(loaded), { java: "done", suwayomi: "done", server: "done", flaresolverr: "todo", syncFolder: "todo", helper: "waiting", launcher: "todo" });
  assert.equal(S.next(loaded), 3);
});

test("missing pieces: each step says what to do, later steps wait", () => {
  const s = finish(S.initial(), "probe", "java sh: java: not found\nunit  \n");
  assert.deepEqual(states(s), { java: "todo", suwayomi: "todo", server: "waiting", flaresolverr: "unavailable", syncFolder: "waiting", helper: "waiting", launcher: "todo" });
  assert.match(S.status(s, "flaresolverr").detail, /needs FlareSolverr/);
  assert.equal(S.incomplete(s), true);
  assert.equal(S.next(s), 0);
  assert.equal(S.action(s, "java"), "check");
  assert.equal(S.action(s, "server"), "check", "a waiting step only checks again");
});

test("no server config or a stopped unit leaves the server step to do", () => {
  for (const probe of [READY.replace("config\n", ""), READY.replace("enabled active", "disabled inactive")]) {
    const s = finish(S.initial(), "probe", probe);
    assert.equal(S.status(s, "server").state, "todo");
    assert.equal(S.action(s, "server"), "confirm");
    assert.equal(S.incomplete(s), true);
  }
});

test("a run step waits for confirmation and blocks other actions while it runs", () => {
  let s = finish(S.initial(), "probe", READY.replace("config\n", ""));
  s = S.reduce(s, { type: "confirm", id: "server" });
  assert.equal(s.confirm, "server");
  assert.equal(S.reduce(s, { type: "cancel" }).confirm, null);
  s = S.reduce(s, { type: "start", id: "server" });
  assert.equal(s.confirm, null);
  assert.equal(S.status(s, "server").state, "running");
  assert.equal(S.action(s, "java"), null);
  s = S.reduce(s, { type: "finish", id: "server", text: "miharchy-server: running on 127.0.0.1:4590 (config changed: yes)\n\n0\n" });
  assert.deepEqual(s.results.server, { code: 0, output: "miharchy-server: running on 127.0.0.1:4590 (config changed: yes)" });
  assert.equal(s.job, null);
});

test("FlareSolverr is done only with the container running and all three settings", () => {
  const s = finish(S.initial(), "probe", READY.replace("docker \n", "docker true\n"));
  assert.equal(S.status(server(s, { settings: FLARE_ON, metas: { nodes: [] } }), "flaresolverr").state, "done");
  for (const k of Object.keys(FLARE_ON)) {
    const off = Object.assign({}, FLARE_ON, { [k]: FLARE_OFF[k] });
    assert.equal(S.status(server(s, { settings: off, metas: { nodes: [] } }), "flaresolverr").state, "todo", k);
  }
  const stopped = finish(S.initial(), "probe", READY.replace("docker \n", "docker false\n"));
  assert.equal(S.status(server(stopped, { settings: FLARE_ON, metas: { nodes: [] } }), "flaresolverr").state, "todo");
});

test("a successful FlareSolverr run saves enabled, the URL and the fallback in one write", () => {
  const p = S.savePayload("flaresolverr", { code: 0 });
  assert.match(p.query, /setSettings/);
  assert.deepEqual(p.variables.s, FLARE_ON);
  assert.equal(S.savePayload("flaresolverr", { code: 1 }), null, "a failed run writes nothing");
  assert.equal(S.savePayload("server", { code: 0 }), null);
});

test("the sync folder is stored as miharchy.syncFolder meta and read back", () => {
  const p = S.savePayload("syncFolder", { code: 0 }, "/home/u/Sync");
  assert.match(p.query, /setGlobalMeta/);
  assert.deepEqual(p.variables, { key: "miharchy.syncFolder", value: "/home/u/Sync" });
  const s = server(finish(S.initial(), "probe", READY), { settings: FLARE_OFF, metas: { nodes: [{ key: "syncFolder", value: "/x" }, { key: "miharchy.syncFolder", value: "/home/u/Sync" }] } });
  assert.deepEqual(S.status(s, "syncFolder"), { state: "done", detail: "/home/u/Sync" });
  assert.equal(S.action(s, "syncFolder"), "edit", "a done folder can still change");
});

test("running setup twice changes nothing: a done machine stays done after another check", () => {
  const done = READY.replace("docker \n", "docker true\njavac\nhelperSource abc\nhelperInstalled abc\nlauncher\n");
  const data = { settings: FLARE_ON, metas: { nodes: [{ key: "miharchy.syncFolder", value: "/s" }] } };
  const once = server(finish(S.initial(), "probe", done), data);
  const twice = server(finish(once, "probe", done), data);
  assert.deepEqual(states(twice), { java: "done", suwayomi: "done", server: "done", flaresolverr: "done", syncFolder: "done", helper: "done", launcher: "done" });
  assert.deepEqual(states(twice), states(once));
});

test("a server newer than the checked version shows a warning and changes no step", () => {
  const done = READY.replace("docker \n", "docker true\njavac\nhelperSource abc\nhelperInstalled abc\nlauncher\n");
  const data = (version) => ({ settings: FLARE_ON, metas: { nodes: [{ key: "miharchy.syncFolder", value: "/s" }] }, aboutServer: { version } });
  const probed = finish(S.initial(), "probe", done);
  const newer = server(probed, data("v2.5.0"));
  assert.match(S.SERVER_QUERY, /aboutServer \{ version \}/);
  assert.equal(S.warning(newer), "Suwayomi-Server v2.5.0 is newer than the version Miharchy has checked (v2.4.2366). It should work, but report problems.");
  assert.deepEqual(states(newer), states(server(probed, data("v2.4.2366"))));
  assert.equal(S.incomplete(newer), false);
  assert.deepEqual(S.unoffered(newer), []);
  for (const v of ["v2.3.2243", "v2.4.2366"]) assert.equal(S.warning(server(probed, data(v))), "", v);
  assert.equal(S.warning(probed), "", "nothing before the server answers");
});

test("a server that does not answer keeps the server-backed steps waiting", () => {
  const s = S.reduce(finish(S.initial(), "probe", READY), { type: "server", reply: M.reply(0, "") });
  assert.equal(s.server, null);
  assert.equal(S.status(s, "syncFolder").state, "waiting");
});

// A plugin sync/ folder whose gradlew stands in for the real build: it
// installs a helper that prints its own name.
function fakeSync(gradlew) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "miharchy-sync-"));
  const src = path.join(dir, "sync");
  fs.mkdirSync(path.join(src, "src"), { recursive: true });
  fs.mkdirSync(path.join(src, "build", "old"), { recursive: true });
  fs.writeFileSync(path.join(src, "src", "Main.kt"), "fun main() {}\n");
  fs.writeFileSync(path.join(src, "build", "old", "junk"), "stale\n");
  fs.writeFileSync(path.join(src, "gradlew"), gradlew || [
    "[ \"$*\" = '--no-daemon --console=plain installDist' ] || exit 2",
    "test -e build/old && { echo 'build/ was copied'; exit 3; }",
    "mkdir -p build/install/miharchy-sync/bin build/install/miharchy-sync/lib",
    "printf '#!/bin/sh\\necho helper\\n' > build/install/miharchy-sync/bin/miharchy-sync",
    "chmod +x build/install/miharchy-sync/bin/miharchy-sync",
    "echo BUILD SUCCESSFUL"
  ].join("\n"));
  const home = path.join(dir, "home");
  fs.mkdirSync(home);
  const bin = stubs({ javac: "true" });
  const env = { ...process.env, HOME: home, PATH: bin + ":" + process.env.PATH };
  const probe = (s) => finish(s || S.initial(), "probe", run(S.probeCommand(path.join(home, "none.json"), src, "/w"), env));
  const build = () => S.parseJob(run(S.runCommand("helper", { syncDir: src }), env));
  return { src, home, env, probe, build, helper: path.join(home, ".local/share/miharchy/helper/bin/miharchy-sync") };
}

const tree = (dir) => fs.readdirSync(dir, { recursive: true }).sort().map((f) => f + " " + fs.statSync(path.join(dir, f)).mtimeMs);

test("the helper builds from a copy of sync/ and installs outside the plugin folder", () => {
  const t = fakeSync();
  assert.equal(S.status(t.probe(), "helper").state, "todo");
  const before = tree(t.src);
  const r = t.build();
  assert.equal(r.code, 0, r.output);
  assert.match(r.output, /BUILD SUCCESSFUL[\s\S]*Installed the sync helper in .+\/\.local\/share\/miharchy\/helper\./);
  assert.equal(execFileSync(t.helper, { encoding: "utf8" }), "helper\n");
  assert.deepEqual(tree(t.src), before, "nothing written inside the plugin's sync/");
  const s = t.probe();
  assert.equal(S.status(s, "helper").state, "done");
  assert.equal(S.status(s, "helper").detail, "Installed in ~/.local/share/miharchy/helper.");
});

test("a changed sync/ marks the helper out of date until it is built again", () => {
  const t = fakeSync();
  t.build();
  fs.writeFileSync(path.join(t.src, "build", "old", "junk"), "build output does not count\n");
  assert.equal(S.status(t.probe(), "helper").state, "done");
  fs.writeFileSync(path.join(t.src, "src", "Main.kt"), "fun main() { println() }\n");
  const s = t.probe();
  assert.equal(S.status(s, "helper").state, "outdated");
  assert.equal(S.action(s, "helper"), "confirm");
  assert.equal(t.build().code, 0);
  assert.equal(S.status(t.probe(), "helper").state, "done");
});

test("a failed build keeps the helper that was installed", () => {
  const t = fakeSync();
  t.build();
  fs.writeFileSync(path.join(t.src, "gradlew"), "echo 'Could not resolve dependencies.'\nexit 1");
  const r = t.build();
  assert.deepEqual([r.code, r.output], [1, "Could not resolve dependencies."]);
  assert.equal(execFileSync(t.helper, { encoding: "utf8" }), "helper\n");
  assert.equal(S.status(t.probe(), "helper").state, "outdated");
});

test("without javac the helper step waits and names the JDK package", () => {
  const s = finish(S.initial(), "probe", READY + "helperSource abc\n");
  assert.equal(S.status(s, "helper").state, "waiting");
  assert.match(S.status(s, "helper").detail, /sudo pacman -S jdk-openjdk/);
  assert.equal(S.action(s, "helper"), "check");
});

test("the launcher entry opens window/miharchy and a rerun or a moved plugin is detected", () => {
  const t = fakeSync();
  const file = path.join(t.home, ".local/share/applications/miharchy.desktop");
  const probe = (windowDir) => finish(S.initial(), "probe", run(S.probeCommand("/none", t.src, windowDir), t.env));
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

const MACHINE = READY.replace("docker \n", "docker \njavac\nhelperSource new1234567890abcdef\nhelperInstalled old1234567890abcdef\n");
const serverWith = (s, offered) => server(s, { settings: FLARE_OFF, metas: { nodes: [{ key: "miharchy.syncFolder", value: "/sync" }].concat(offered === undefined ? [] : [{ key: "miharchy.setupOffered", value: offered }]) } });

test("optional steps that are due get offered once, keyed by state", () => {
  const s = serverWith(finish(S.initial(), "probe", MACHINE));
  assert.equal(S.incomplete(s), false, "every required step is done");
  const due = ["flaresolverr:todo", "helper:outdated:new123456789", "launcher:todo"];
  assert.deepEqual(S.offers(s), due);
  assert.deepEqual(S.unoffered(s), due);
  assert.deepEqual(S.offerPayload(s).variables, { key: "miharchy.setupOffered", value: due.join(",") });
});

test("a step already offered does not reopen Setup, a newly due one does", () => {
  const seen = serverWith(finish(S.initial(), "probe", MACHINE), "flaresolverr:todo,helper:outdated:new123456789,launcher:todo");
  assert.deepEqual(S.unoffered(seen), []);
  const updated = serverWith(finish(S.initial(), "probe", MACHINE.replace("helperSource new1234567890abcdef", "helperSource zzz9876543210fedcb")), "flaresolverr:todo,helper:outdated:new123456789,launcher:todo");
  assert.deepEqual(S.unoffered(updated), ["helper:outdated:zzz987654321"], "a plugin update that changes sync/ is offered once more");
});

test("nothing is offered before the server answers, and waiting or unavailable steps are never offered", () => {
  assert.deepEqual(S.unoffered(finish(S.initial(), "probe", MACHINE)), [], "no server reply yet");
  const s = serverWith(finish(S.initial(), "probe", READY.replace("docker \n", "")));
  assert.deepEqual(S.offers(s), ["launcher:todo"], "no javac means the helper waits; no docker means FlareSolverr is unavailable");
});

test("the probe reports whether the installed server unit matches the plugin's copy", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "miharchy-unit-"));
  const home = path.join(root, "home");
  fs.mkdirSync(path.join(root, "window"));
  fs.mkdirSync(path.join(root, "server"));
  fs.mkdirSync(path.join(home, ".config/systemd/user"), { recursive: true });
  fs.writeFileSync(path.join(root, "server/miharchy-server.service"), "[Service]\nExecStart=new\n");
  const probe = () => S.parseProbe(S.parseJob(run(S.probeCommand("/none", root, path.join(root, "window")), { PATH: process.env.PATH, HOME: home })).output);
  assert.equal(probe().unitCurrent, false, "no unit installed");
  fs.writeFileSync(path.join(home, ".config/systemd/user/miharchy-server.service"), "[Service]\nExecStart=old\n");
  assert.equal(probe().unitCurrent, false, "an older unit");
  fs.copyFileSync(path.join(root, "server/miharchy-server.service"), path.join(home, ".config/systemd/user/miharchy-server.service"));
  assert.equal(probe().unitCurrent, true);
});

test("server/miharchy-server moves a basic_auth server to ui_login once, keeping its credentials", () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "miharchy-auth-"));
  const log = path.join(home, "systemctl.log");
  const bin = stubs({ systemctl: "echo \"$*\" >> " + log });
  const env = { PATH: bin + ":" + process.env.PATH, HOME: home };
  const script = path.join(__dirname, "../../server/miharchy-server");
  const conf = path.join(home, ".local/share/miharchy/suwayomi/server.conf");
  const creds = { url: "http://127.0.0.1:4590", username: "miharchy", password: "old-password" };
  fs.mkdirSync(path.dirname(conf), { recursive: true });
  fs.mkdirSync(path.join(home, ".config/miharchy"), { recursive: true });
  fs.writeFileSync(path.join(home, ".config/miharchy/server.json"), JSON.stringify(creds));
  run([script], env);
  // Suwayomi rewrites the file in its own form, with the mode it was given.
  fs.writeFileSync(conf, fs.readFileSync(conf, "utf8").replace(/^server\.(\w+) = (.*)$/gm, "server.$1 = $2 # default: x").replace("\"ui_login\"", "\"basic_auth\""));
  fs.writeFileSync(log, "");
  const probe = () => S.parseProbe(S.parseJob(run(S.probeCommand("/none", home, path.join(home, "window")), env)).output);
  assert.equal(probe().basicAuth, true);

  assert.match(run([script], env), /config changed: yes/);
  const text = fs.readFileSync(conf, "utf8");
  assert.match(text, /^server\.authMode = "ui_login"$/m);
  assert.doesNotMatch(text, /basic_auth/);
  assert.match(text, /^server\.authPassword = "old-password"/m);
  assert.match(fs.readFileSync(log, "utf8"), /restart miharchy-server\.service/);
  assert.equal(probe().basicAuth, false);
  assert.match(run([script], env), /config changed: no/, "a rerun changes nothing");
});

test("a running server on basic_auth is due again, and keeps Setup open", () => {
  const old = finish(S.initial(), "probe", READY + "basicAuth\n");
  assert.equal(S.status(old, "server").state, "outdated");
  assert.match(S.status(old, "server").detail, /basic_auth/);
  assert.equal(S.action(old, "server"), "confirm");
  assert.equal(S.incomplete(old), true);
});

test("a running server with an outdated unit is due again, and keeps Setup open", () => {
  const stale = finish(S.initial(), "probe", READY.replace("unitCurrent\n", ""));
  assert.equal(S.status(stale, "server").state, "outdated");
  assert.match(S.status(stale, "server").detail, /changed/);
  assert.equal(S.action(stale, "server"), "confirm");
  assert.equal(S.incomplete(stale), true);
  assert.equal(S.status(finish(S.initial(), "probe", READY), "server").state, "done");
});
