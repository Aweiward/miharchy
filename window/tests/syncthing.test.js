const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const http = require("node:http");
const execFile = require("node:util").promisify(require("node:child_process").execFile);
const S = require("./load")("Setup.js");

const DESKTOP = "DESKTOP-AAAAAAA-BBBBBBB-CCCCCCC-DDDDDDD-EEEEEEE-FFFFFFF-GGGGGGG";
const PHONE = "PHONE00-AAAAAAA-BBBBBBB-CCCCCCC-DDDDDDD-EEEEEEE-FFFFFFF-GGGGGGG";

// A stand-in Syncthing: GET answers from routes, POST bodies recorded. It
// answers only with the right API key, as Syncthing does.
async function syncthing(routes) {
  const posts = [];
  const server = http.createServer((req, res) => {
    let body = "";
    req.on("data", (c) => { body += c; });
    req.on("end", () => {
      if (req.headers["x-api-key"] !== "test-key") { res.writeHead(403); return res.end("CSRF Error"); }
      if (req.method === "POST") { posts.push({ path: req.url, body: JSON.parse(body) }); res.writeHead(200); return res.end("{}"); }
      const r = routes[req.url];
      res.writeHead(r === undefined ? 404 : 200, { "Content-Type": "application/json" });
      res.end(r === undefined ? "" : JSON.stringify(r));
    });
  });
  await new Promise((ok) => server.listen(0, "127.0.0.1", ok));
  return { port: server.address().port, posts, close: () => server.close() };
}

// A HOME whose config.xml points at the stand-in, a sync folder, and a qrencode stub that writes its text.
function home(port) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "miharchy-st-"));
  const cfg = path.join(dir, ".local/state/syncthing");
  fs.mkdirSync(cfg, { recursive: true });
  if (port) fs.writeFileSync(path.join(cfg, "config.xml"), `<configuration version="37">
    <device id="${DESKTOP}" name="desktop"><address>dynamic</address></device>
    <gui enabled="true" tls="false">
        <address>127.0.0.1:${port}</address>
        <apikey>test-key</apikey>
    </gui>
</configuration>\n`);
  const bin = path.join(dir, "bin");
  fs.mkdirSync(bin);
  fs.writeFileSync(path.join(bin, "qrencode"), "#!/bin/sh\n# qrencode -o FILE TEXT\nprintf '%s' \"$3\" > \"$2\"\n", { mode: 0o755 });
  fs.mkdirSync(path.join(dir, "Sync/mihon-backups"), { recursive: true });
  return { dir, folder: path.join(dir, "Sync/mihon-backups"), qr: path.join(dir, "id.png"), env: { HOME: dir, PATH: bin + ":/usr/bin:/bin" } };
}

const routes = (extra) => Object.assign({
  "/rest/system/status": { myID: DESKTOP },
  "/rest/config/folders": [],
  "/rest/config/devices": [{ deviceID: DESKTOP, name: "desktop" }],
  "/rest/cluster/pending/devices": {},
  "/rest/cluster/pending/folders": {}
}, extra);

async function probe(h) {
  const argv = S.syncthingProbeCommand(h.folder, h.qr);
  const { stdout } = await execFile(argv[0], argv.slice(1), { env: h.env });
  return S.parseSyncthing(S.parseJob(stdout).output);
}

test("the Syncthing check reads nothing pending, writes the desktop ID as a QR code, and never sends the key elsewhere", async () => {
  const st = await syncthing(routes());
  const h = home(st.port);
  try {
    assert.deepEqual(await probe(h), { installed: true, answering: true, myId: DESKTOP, shared: false, knowsPhone: false, pendingDevices: [], pendingFolders: [], qr: h.qr });
    assert.equal(fs.readFileSync(h.qr, "utf8"), DESKTOP);
  } finally { st.close(); }
});

test("a sync folder Syncthing already shares with a device counts as paired, under ~ too", async () => {
  const st = await syncthing(routes({ "/rest/config/folders": [
    { id: "other", path: "/elsewhere", devices: [{ deviceID: DESKTOP }, { deviceID: PHONE }] },
    { id: "mihon", path: "~/Sync/mihon-backups/", devices: [{ deviceID: DESKTOP }, { deviceID: PHONE }] }
  ] }));
  const h = home(st.port);
  try { assert.equal((await probe(h)).shared, true); } finally { st.close(); }
  const lone = await syncthing(routes({ "/rest/config/folders": [{ id: "mihon", path: "~/Sync/mihon-backups", devices: [{ deviceID: DESKTOP }] }] }));
  const h2 = home(lone.port);
  try { assert.equal((await probe(h2)).shared, false, "a folder shared with no other device is not paired"); } finally { lone.close(); }
});

test("the check knows whether Syncthing has a device besides this desktop", async () => {
  const st = await syncthing(routes({ "/rest/config/devices": [{ deviceID: DESKTOP, name: "desktop" }, { deviceID: PHONE, name: "Pixel" }] }));
  const h = home(st.port);
  try { assert.equal((await probe(h)).knowsPhone, true); } finally { st.close(); }
});

test("the check lists the phone's pending device and folders", async () => {
  const st = await syncthing(routes({
    "/rest/cluster/pending/devices": { [PHONE]: { time: "2026-10-09T12:00:00Z", name: "Pixel", address: "192.168.1.5:22000" } },
    "/rest/cluster/pending/folders": { "abcd-1234": { offeredBy: { [PHONE]: { time: "2026-10-09T12:01:00Z", label: "Mihon backups", receiveEncrypted: false, remoteEncrypted: false } } } }
  }));
  const h = home(st.port);
  try {
    const f = await probe(h);
    assert.deepEqual(f.pendingDevices, [{ id: PHONE, name: "Pixel" }]);
    assert.deepEqual(f.pendingFolders, [{ id: "abcd-1234", label: "Mihon backups", device: PHONE }]);
  } finally { st.close(); }
});

test("no Syncthing config, or a Syncthing that does not answer, says so", async () => {
  const h = home(null);
  assert.deepEqual(await probe(h), { installed: false, answering: false, myId: "", shared: false, knowsPhone: false, pendingDevices: [], pendingFolders: [], qr: "" });
  const st = await syncthing(routes());
  const h2 = home(st.port);
  st.close();
  await new Promise((ok) => setTimeout(ok, 50));
  const f = await probe(h2);
  assert.deepEqual([f.installed, f.answering], [true, false]);
});

// Setup's state: a done machine whose sync folder holds no phone backup yet, then the Syncthing check's facts.
const M = require("./load")("Model.js");
const finish = (s, id, text) => S.reduce(S.reduce(s, { type: "start", id }), { type: "finish", id, text });
const READY = "java openjdk version \"26.0.2.1\" 2026-08-18\nsuwayomi\nwebsockets\nconfig\nunit enabled active\nunitCurrent\ndocker \n";
const F = "/home/u/Sync/mihon-backups";
const waiting = finish(S.reduce(finish(S.initial(), "probe", READY), { type: "server", reply: M.reply(200, JSON.stringify({ data: { settings: {}, metas: { nodes: [{ key: "miharchy.syncFolder", value: F }] } } })) }), "phones", "phones 0\nnewest \n\n0\n");
const facts = (f) => finish(waiting, "syncthing", [
  f.installed === false ? "" : "installed", f.answering === false ? "" : "answering", "myID " + DESKTOP, f.shared ? "shared" : "", f.knows ? "knowsPhone" : "",
  "pendingDevices " + JSON.stringify(f.devices || []), "pendingFolders " + JSON.stringify(f.folders || []), f.noQr ? "" : "qr /run/user/1000/miharchy/syncthing-id.png"
].join("\n") + "\n\n0\n");
const MIHON = "In Mihon, turn on automatic backups (More → Settings → Data and storage), then tap Create backup, or wait for the automatic one.";

test("the step says how to get Syncthing going, and skips pairing when the folder is already shared", () => {
  assert.deepEqual(S.status(facts({ installed: false }), "phoneBackups"), { state: "todo",
    command: "omarchy-pkg-add syncthing && systemctl --user enable --now syncthing",
    prompt: "Install and start Syncthing in a terminal?",
    detail: "No phone backup in " + F + " yet. To share it with your phone through Syncthing, press Enter to install and start it in a terminal; you type your password there. Any other way to share the folder works too. Setup checks again on its own." });
  assert.equal(S.action(facts({ installed: false }), "phoneBackups"), "confirm");
  assert.deepEqual(S.status(facts({ answering: false }), "phoneBackups"), { state: "todo",
    command: "systemctl --user enable --now syncthing",
    prompt: "Start Syncthing in a terminal?",
    detail: "No phone backup in " + F + " yet. Syncthing does not answer: press Enter to start it in a terminal. Setup checks again on its own." });
  assert.equal(S.action(facts({ answering: false }), "phoneBackups"), "confirm");
  const launched = finish(facts({ installed: false }), "phoneBackups", "\n0\n");
  assert.equal(S.status(launched, "phoneBackups").detail, "Installing Syncthing in the terminal. Setup checks again on its own; Enter opens the terminal again.");
  assert.equal(S.action(launched, "phoneBackups"), "confirm");
  assert.deepEqual(S.status(facts({ shared: true }), "phoneBackups"), { state: "todo",
    detail: "No phone backup in " + F + " yet. Syncthing shares this folder with your phone. " + MIHON + " Setup checks again on its own." });
  assert.equal(S.action(facts({ shared: true }), "phoneBackups"), "check");
});

test("with nothing pending, the step shows the desktop ID as a QR code to scan on the phone", () => {
  assert.deepEqual(S.status(facts({}), "phoneBackups"), { state: "todo", qr: "/run/user/1000/miharchy/syncthing-id.png",
    detail: "In Syncthing-Fork on your phone, add this desktop: scan the code, or enter " + DESKTOP + ". Then share Mihon's autobackup folder with it. Setup checks again on its own." });
});

test("without qrencode the step gives the ID as text and the command that shows it as a code", () => {
  assert.deepEqual(S.status(facts({ noQr: true }), "phoneBackups"), { state: "todo",
    detail: "In Syncthing-Fork on your phone, add this desktop: enter " + DESKTOP + ". Then share Mihon's autobackup folder with it. To show the ID as a QR code, install qrencode: sudo pacman -S qrencode. Setup checks again on its own." });
});

test("once Syncthing knows the phone, the step asks for the folder share, not the QR code again", () => {
  assert.deepEqual(S.status(facts({ knows: true }), "phoneBackups"), { state: "todo",
    detail: "Syncthing knows your phone. In Syncthing-Fork, share Mihon's autobackup folder with this desktop. Setup checks again on its own." });
  assert.equal(S.action(facts({ knows: true }), "phoneBackups"), "check");
});

test("a phone waiting to connect, or one folder it offers, is accepted with y", () => {
  const device = facts({ devices: [{ id: PHONE, name: "Pixel" }] });
  assert.deepEqual(S.status(device, "phoneBackups"), { state: "todo", prompt: "Accept Pixel in Syncthing?",
    detail: "Your phone Pixel wants to connect through Syncthing. Press Enter, then y, to accept it. Then, in Syncthing-Fork, share Mihon's autobackup folder with this desktop." });
  assert.equal(S.action(device, "phoneBackups"), "confirm");

  const one = facts({ folders: [{ id: "abcd-1234", label: "Mihon backups", device: PHONE }] });
  assert.deepEqual(S.status(one, "phoneBackups"), { state: "todo", prompt: "Accept the folder \"Mihon backups\" into " + F + "?",
    detail: "Your phone offers the folder \"Mihon backups\". Press Enter, then y, to receive it in " + F + "." });
  assert.equal(S.action(one, "phoneBackups"), "confirm");

  const named = facts({ folders: [{ id: "camera", label: "Camera", device: PHONE }, { id: "x1", label: "autobackup", device: PHONE }] });
  assert.equal(S.status(named, "phoneBackups").prompt, "Accept the folder \"autobackup\" into " + F + "?", "of several, the one named autobackup");
});

test("several folders and none named autobackup: the step lists them and points to Syncthing's page", () => {
  const several = facts({ folders: [{ id: "camera", label: "Camera", device: PHONE }, { id: "docs", label: "Documents", device: PHONE }] });
  assert.deepEqual(S.status(several, "phoneBackups"), { state: "todo",
    detail: "Your phone offers several folders: Camera, Documents. Accept Mihon's autobackup folder at http://127.0.0.1:8384, with " + F + " as its folder path. Setup checks again on its own." });
  assert.equal(S.action(several, "phoneBackups"), "check");
});

async function accept(h, pair) {
  const argv = S.runCommand("phoneBackups", { folder: h.folder, pair: pair });
  const { stdout } = await execFile(argv[0], argv.slice(1), { env: h.env });
  return S.parseJob(stdout);
}

test("y adds the phone's device to Syncthing, then the folder it offers at the sync folder, send and receive", async () => {
  const st = await syncthing(routes());
  const h = home(st.port);
  try {
    assert.deepEqual(await accept(h, { device: { id: PHONE, name: "Pixel" }, folder: null }), { code: 0, output: "Syncthing now knows Pixel." });
    assert.deepEqual(await accept(h, { device: null, folder: { id: "abcd-1234", label: "Mihon backups", device: PHONE } }),
      { code: 0, output: "Syncthing now receives \"Mihon backups\" in " + h.folder + "." });
    assert.deepEqual(st.posts, [
      { path: "/rest/config/devices", body: { deviceID: PHONE, name: "Pixel" } },
      { path: "/rest/config/folders", body: { id: "abcd-1234", label: "Mihon backups", path: h.folder, type: "sendreceive", devices: [{ deviceID: PHONE }] } }
    ]);
  } finally { st.close(); }
});

test("a Syncthing that refuses the change fails the step and says so", async () => {
  const st = await syncthing(routes());
  const h = home(st.port);
  fs.writeFileSync(path.join(h.dir, ".local/state/syncthing/config.xml"),
    fs.readFileSync(path.join(h.dir, ".local/state/syncthing/config.xml"), "utf8").replace("test-key", "wrong-key"));
  try {
    assert.deepEqual(await accept(h, { device: { id: PHONE, name: "Pixel" }, folder: null }), { code: 1, output: "Syncthing did not take the device. Accept it at http://127.0.0.1:" + st.port + "." });
    assert.deepEqual(st.posts, []);
  } finally { st.close(); }
});

test("y on a Syncthing to install or start opens Omarchy's terminal on that command", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "miharchy-st-term-"));
  fs.writeFileSync(path.join(dir, "omarchy-launch-floating-terminal-with-presentation"), "#!/bin/sh\nprintf '%s' \"$*\" > \"$(dirname \"$0\")/launched\"\n", { mode: 0o755 });
  const install = S.status(facts({ installed: false }), "phoneBackups").command;
  const argv = S.runCommand("phoneBackups", { folder: F, pair: S.pairing(facts({ installed: false })), install: install });
  const out = S.parseJob(require("node:child_process").execFileSync(argv[0], argv.slice(1), { encoding: "utf8", env: { PATH: dir + ":/usr/bin:/bin", HOME: dir } }));
  assert.equal(out.code, 0);
  assert.equal(fs.readFileSync(path.join(dir, "launched"), "utf8"), "omarchy-pkg-add syncthing && systemctl --user enable --now syncthing");
});
