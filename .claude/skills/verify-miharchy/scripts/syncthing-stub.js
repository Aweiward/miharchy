// A stand-in Syncthing for a Setup drive: node syncthing-stub.js <port> <sync folder> <request log>. API key "test-key".
// It starts with nothing pending; GET /control/phone makes the phone ask to connect; accepting the device makes
// the phone offer "Mihon backups"; accepting that folder shares it. Never point a drive at the real Syncthing (8384).
const http = require("node:http");
const fs = require("node:fs");
const [port, folder, log] = [Number(process.argv[2]), process.argv[3], process.argv[4]];
const ME = "DESKTOP-AAAAAAA-BBBBBBB-CCCCCCC-DDDDDDD-EEEEEEE-FFFFFFF-GGGGGGG";
const PHONE = "PHONE00-AAAAAAA-BBBBBBB-CCCCCCC-DDDDDDD-EEEEEEE-FFFFFFF-GGGGGGG";
const st = { devices: {}, folders: {}, config: [] };
http.createServer((req, res) => {
  let body = "";
  req.on("data", (c) => { body += c; });
  req.on("end", () => {
    fs.appendFileSync(log, req.method + " " + req.url + " " + body + "\n");
    if (req.url === "/control/phone") { st.devices = { [PHONE]: { name: "Pixel" } }; return res.end("ok"); }
    if (req.headers["x-api-key"] !== "test-key") { res.writeHead(403); return res.end(); }
    if (req.method === "POST" && req.url === "/rest/config/devices") { st.devices = {}; st.folders = { "mihon-ab": { offeredBy: { [PHONE]: { label: "Mihon backups" } } } }; return res.end("{}"); }
    if (req.method === "POST" && req.url === "/rest/config/folders") { st.folders = {}; st.config = [{ id: "mihon-ab", path: JSON.parse(body).path, devices: [{ deviceID: ME }, { deviceID: PHONE }] }]; return res.end("{}"); }
    const r = { "/rest/system/status": { myID: ME }, "/rest/config/folders": st.config, "/rest/cluster/pending/devices": st.devices, "/rest/cluster/pending/folders": st.folders }[req.url];
    res.writeHead(r === undefined ? 404 : 200, { "Content-Type": "application/json" });
    res.end(r === undefined ? "" : JSON.stringify(r));
  });
}).listen(port, "127.0.0.1");
