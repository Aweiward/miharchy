const { test } = require("node:test");
const assert = require("node:assert/strict");
const load = require("./load");

// core.test.js covers a request's POST, its secret and an image.
const config = { url: "http://127.0.0.1:4591", secret: "c0ffee" };

// QML's XMLHttpRequest, answering on a later tick.
function install(answer) {
  const requests = [];
  globalThis.XMLHttpRequest = class {
    static DONE = 4;
    constructor() { this.readyState = 0; this.headers = {}; }
    open(method, url) { this.method = method; this.url = url; }
    setRequestHeader(k, v) { this.headers[k] = v; }
    getResponseHeader() { return null; }
    send(body) {
      requests.push({ method: this.method, url: this.url, headers: this.headers, body });
      setImmediate(() => {
        if (this.readyState === 4) return;
        const a = answer();
        this.finish(a.status, a.body);
      });
    }
    abort() { this.finish(0, ""); }
    finish(status, body) {
      this.readyState = 4;
      this.status = status;
      this.responseText = body;
      this.response = body;
      this.onreadystatechange();
    }
  };
  return requests;
}

test("a server that does not answer reads as down", async () => {
  install(() => ({ status: 0, body: "" }));
  const S = load("Session.js");
  assert.equal((await new Promise((resolve) => S.send(config, { route: "library.list" }, resolve))).state, "down");
});

test("abort answers at once as no answer, and the late reply is dropped", async () => {
  install(() => ({ status: 200, body: "{}" }));
  const S = load("Session.js");
  const got = [];
  const handle = S.send(config, { route: "library.list" }, (r) => got.push(r.state));
  handle.abort();
  assert.deepEqual(got, ["down"]);
  await new Promise((r) => setTimeout(r, 20));
  assert.deepEqual(got, ["down"]);
});

test("a payload that is not a core route never leaves", async () => {
  const requests = install(() => ({ status: 200, body: "{}" }));
  const S = load("Session.js");
  const reply = await new Promise((resolve) => S.send(config, { query: "{ mangas { totalCount } }" }, resolve));
  assert.equal(reply.state, "error");
  assert.equal(requests.length, 0);
});
