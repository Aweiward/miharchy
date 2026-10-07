const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { execFileSync } = require("node:child_process");

const launcher = path.join(__dirname, "..", "miharchy");
const dir = path.dirname(fs.realpathSync(launcher));

// Fake quickshell and hyprctl log every call; the env vars below script their replies.
const STUBS = {
  quickshell: `#!/bin/sh
echo "quickshell $* | MIHARCHY_OPEN_CHAPTER=$MIHARCHY_OPEN_CHAPTER\${STUB_VIEW:+ view=$MIHARCHY_OPEN_VIEW peek=$MIHARCHY_PEEK}" >> "$STUB_LOG"
case "$1" in
  -n) touch "$STUB_LOG.started" ;;
  list) if [ -e "$STUB_LOG.started" ] && [ -n "$STUB_LIST_AFTER" ]; then printf '%s\\n' "$STUB_LIST_AFTER"; else printf '%s\\n' "$STUB_LIST"; fi ;;
  ipc) exit "$STUB_IPC_RC" ;;
esac`,
  hyprctl: `#!/bin/sh
echo "hyprctl $*" >> "$STUB_LOG"
case "$1 $2" in
  "clients -j") printf '%s\\n' "$STUB_CLIENTS" ;;
  "dispatch hl.dsp"*) exit "$STUB_LUA_RC" ;;
esac`,
};

const NONE = 'No running instances for "' + dir + '/shell.qml"\nUse --all to list all instances.';
const RUNNING = JSON.stringify([{ config_path: dir + "/shell.qml", pid: 42 }]);
const CLIENTS = JSON.stringify([
  { address: "0xshell", pid: 7, class: "org.quickshell", title: "Miharchy" },
  { address: "0xmiharchy", pid: 42, class: "org.quickshell", title: "Miharchy", workspace: { id: 3, name: "3" } },
]);
const PEEKED = CLIENTS.replace('"name":"3"', '"name":"special:miharchy"');

function run(args, env, starting) {
  const bin = fs.mkdtempSync(path.join(os.tmpdir(), "miharchy-launcher-"));
  if (starting) fs.mkdirSync(path.join(bin, "runtime/miharchy/peek-starting"), { recursive: true });
  for (const [name, body] of Object.entries(STUBS)) fs.writeFileSync(path.join(bin, name), body, { mode: 0o755 });
  const log = path.join(bin, "log");
  fs.writeFileSync(log, "");
  fs.mkdirSync(path.join(bin, "runtime"), { recursive: true });
  execFileSync("sh", [launcher, ...args], {
    env: { PATH: bin + ":" + process.env.PATH, STUB_LOG: log, XDG_RUNTIME_DIR: path.join(bin, "runtime"), STUB_LIST: NONE, STUB_CLIENTS: CLIENTS, STUB_IPC_RC: "1", STUB_LUA_RC: "0", ...env },
  });
  const calls = fs.readFileSync(log, "utf8").trim().split("\n");
  calls.runtime = path.join(bin, "runtime");
  return calls;
}

const LUA_FOCUS = 'hyprctl dispatch hl.dsp.focus({ window = "address:0xmiharchy" })';
const dispatches = (calls) => calls.filter((c) => c.startsWith("hyprctl dispatch"));
const launches = (calls) => calls.filter((c) => c.startsWith("quickshell -n"));

test("with no window running, a launch starts one and focuses nothing", () => {
  const calls = run([]);
  assert.deepEqual(launches(calls), ["quickshell -n -p " + dir + " | MIHARCHY_OPEN_CHAPTER="]);
  assert.deepEqual(dispatches(calls), []);
});

test("with a window running, a launch focuses that window by its instance pid, not by title", () => {
  const calls = run([], { STUB_LIST: RUNNING });
  assert.deepEqual(dispatches(calls), [LUA_FOCUS]);
  assert.deepEqual(launches(calls), []);
});

test("a Hyprland without the Lua dispatcher gets focuswindow", () => {
  const calls = run([], { STUB_LIST: RUNNING, STUB_LUA_RC: "1" });
  assert.deepEqual(dispatches(calls), [LUA_FOCUS, "hyprctl dispatch focuswindow address:0xmiharchy"]);
});

test("an instance with no Hyprland window falls through to quickshell -n", () => {
  const calls = run([], { STUB_LIST: RUNNING, STUB_CLIENTS: "[]" });
  assert.deepEqual(dispatches(calls), []);
  assert.equal(launches(calls).length, 1);
});

test("open-chapter hands the chapter to the running window, then focuses it", () => {
  const calls = run(["open-chapter", "5", "9"], { STUB_LIST: RUNNING, STUB_IPC_RC: "0" });
  assert.equal(calls[0], "quickshell ipc -p " + dir + " call miharchy openChapter 5 9 | MIHARCHY_OPEN_CHAPTER=");
  assert.deepEqual(dispatches(calls), [LUA_FOCUS]);
  assert.deepEqual(launches(calls), []);
});

test("open-updates shows Updates in the running window, then focuses it", () => {
  const calls = run(["open-updates"], { STUB_LIST: RUNNING, STUB_IPC_RC: "0" });
  assert.equal(calls[0], "quickshell ipc -p " + dir + " call miharchy openUpdates | MIHARCHY_OPEN_CHAPTER=");
  assert.deepEqual(dispatches(calls), [LUA_FOCUS]);
  assert.deepEqual(launches(calls), []);
});

test("open-updates with no window running starts one on Updates", () => {
  const calls = run(["open-updates"], { STUB_VIEW: "1" });
  assert.deepEqual(launches(calls), ["quickshell -n -p " + dir + " | MIHARCHY_OPEN_CHAPTER= view=updates peek="]);
});

test("open-chapter with no window running starts one on that chapter", () => {
  const calls = run(["open-chapter", "5", "9"]);
  assert.deepEqual(launches(calls), ["quickshell -n -p " + dir + " | MIHARCHY_OPEN_CHAPTER=5 9"]);
  assert.deepEqual(dispatches(calls), []);
});

const LUA_TOGGLE = 'hyprctl dispatch hl.dsp.workspace.toggle_special("miharchy")';
const LUA_MOVE = 'hyprctl dispatch hl.dsp.window.move({ workspace = "special:miharchy", follow = false, window = "address:0xmiharchy" })';

test("peek shows or hides a window that is already a peek, and sends it nothing", () => {
  const calls = run(["peek"], { STUB_LIST: RUNNING, STUB_CLIENTS: PEEKED, STUB_IPC_RC: "0" });
  assert.deepEqual(dispatches(calls), [LUA_TOGGLE]);
  assert.deepEqual(calls.filter((c) => c.startsWith("quickshell ipc")), []);
  assert.deepEqual(launches(calls), []);
});

test("peek on a window in a normal workspace resumes it and focuses it there, never moving it", () => {
  const calls = run(["peek"], { STUB_LIST: RUNNING, STUB_IPC_RC: "0" });
  assert.ok(calls.includes("quickshell ipc -p " + dir + " call miharchy peek | MIHARCHY_OPEN_CHAPTER="));
  assert.deepEqual(dispatches(calls), [LUA_FOCUS]);
  assert.deepEqual(launches(calls), []);
});

test("peek with no window running starts one as a peek, moves it to the special workspace and shows it", () => {
  const calls = run(["peek"], { STUB_LIST_AFTER: RUNNING, STUB_VIEW: "1" });
  assert.deepEqual(launches(calls), ["quickshell -n -p " + dir + " | MIHARCHY_OPEN_CHAPTER= view= peek=1"]);
  assert.deepEqual(dispatches(calls), [LUA_MOVE, LUA_TOGGLE]);
});

test("a Hyprland without the Lua dispatcher gets movetoworkspacesilent and togglespecialworkspace", () => {
  const calls = run(["peek"], { STUB_LIST_AFTER: RUNNING, STUB_LUA_RC: "1" });
  assert.deepEqual(dispatches(calls), [LUA_MOVE, "hyprctl dispatch movetoworkspacesilent special:miharchy,address:0xmiharchy", LUA_TOGGLE, "hyprctl dispatch togglespecialworkspace miharchy"]);
});

test("peek gives up with an error when the new window never shows up", () => {
  assert.throws(() => run(["peek"]), /Command failed/);
});

test("a second peek while the first window is still starting starts no other window", () => {
  const calls = run(["peek"], { STUB_LIST_AFTER: RUNNING }, true);
  assert.deepEqual(launches(calls), []);
  assert.deepEqual(dispatches(calls), []);
});

test("a peek that started its window, or gave up, leaves no start marker behind", () => {
  const calls = run(["peek"], { STUB_LIST_AFTER: RUNNING });
  assert.equal(launches(calls).length, 1);
  assert.deepEqual(fs.readdirSync(path.join(calls.runtime, "miharchy")), []);
});
