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

const READY = "java openjdk version \"26.0.2.1\" 2026-08-18\nsuwayomi\nconfig\nunit enabled active\ndocker \n";
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
  const f = S.parseProbe(S.parseJob(run(S.probeCommand(config), { PATH: bin })).output);
  assert.equal(f.java, 17);
  assert.equal(f.config, true);
  assert.equal(f.unitEnabled, true);
  assert.equal(f.unitActive, false, "inactive is not active");
  assert.equal(f.docker, true);
  assert.equal(f.container, false);

  const bare = S.parseProbe(S.parseJob(run(S.probeCommand(path.join(bin, "none.json")), { PATH: path.join(bin, "empty") })).output);
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
  assert.equal(S.STEPS.find((st) => st.id === "java").command, "sudo pacman -S jre-openjdk");
  assert.equal(S.STEPS.find((st) => st.id === "suwayomi").command, "yay -S suwayomi-server-bin");
  assert.equal(S.runCommand("java", {}), null);
  assert.equal(S.runCommand("suwayomi", {}), null);
  for (const id of ["server", "flaresolverr", "syncFolder"]) assert.doesNotMatch(S.runCommand(id, { serverScript: "x", folder: "/" }).join(" "), /sudo|pacman|yay/, id);
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
  assert.deepEqual(states(s), { java: "done", suwayomi: "done", server: "done", flaresolverr: "waiting", syncFolder: "waiting" });
  assert.equal(S.incomplete(s), false);
  const loaded = server(s, { settings: FLARE_OFF, metas: { nodes: [] } });
  assert.deepEqual(states(loaded), { java: "done", suwayomi: "done", server: "done", flaresolverr: "todo", syncFolder: "todo" });
  assert.equal(S.next(loaded), 3);
});

test("missing pieces: each step says what to do, later steps wait", () => {
  const s = finish(S.initial(), "probe", "java sh: java: not found\nunit  \n");
  assert.deepEqual(states(s), { java: "todo", suwayomi: "todo", server: "waiting", flaresolverr: "unavailable", syncFolder: "waiting" });
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

test("a typed folder must be absolute; ~ means home; trailing slashes go", () => {
  assert.deepEqual(S.commitFolder("  ~/Sync/Mihon/ ", "/home/u"), { folder: "/home/u/Sync/Mihon" });
  assert.deepEqual(S.commitFolder("~", "/home/u"), { folder: "/home/u" });
  assert.deepEqual(S.commitFolder("/", "/home/u"), { folder: "/" });
  for (const bad of ["", "Sync", "~user/x"]) assert.ok(S.commitFolder(bad, "/home/u").error, bad);
});

test("running setup twice changes nothing: a done machine stays done after another check", () => {
  const done = READY.replace("docker \n", "docker true\n");
  const data = { settings: FLARE_ON, metas: { nodes: [{ key: "miharchy.syncFolder", value: "/s" }] } };
  const once = server(finish(S.initial(), "probe", done), data);
  const twice = server(finish(once, "probe", done), data);
  assert.deepEqual(states(twice), { java: "done", suwayomi: "done", server: "done", flaresolverr: "done", syncFolder: "done" });
  assert.deepEqual(states(twice), states(once));
});

test("a server that does not answer keeps the server-backed steps waiting", () => {
  const s = S.reduce(finish(S.initial(), "probe", READY), { type: "server", reply: M.reply(0, "") });
  assert.equal(s.server, null);
  assert.equal(S.status(s, "syncFolder").state, "waiting");
});
