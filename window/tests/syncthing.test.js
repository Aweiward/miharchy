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
    assert.deepEqual(await probe(h), { installed: true, answering: true, myId: DESKTOP, shared: false, pendingDevices: [], pendingFolders: [], qr: h.qr });
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
  assert.deepEqual(await probe(h), { installed: false, answering: false, myId: "", shared: false, pendingDevices: [], pendingFolders: [], qr: "" });
  const st = await syncthing(routes());
  const h2 = home(st.port);
  st.close();
  await new Promise((ok) => setTimeout(ok, 50));
  const f = await probe(h2);
  assert.deepEqual([f.installed, f.answering], [true, false]);
});
