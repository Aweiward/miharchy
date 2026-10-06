const { test } = require("node:test");
const assert = require("node:assert/strict");
const load = require("./load");

const config = { url: "http://127.0.0.1:4590", username: "miharchy", password: "s3cret" };
const UNAUTHORIZED = "Exception while fetching data (/mangas) : Unauthorized\r\n\r\nsuwayomi.tachidesk.server.user.UnauthorizedException: Unauthorized";

// A ui_login server as measured on Suwayomi v2.3: GraphQL refuses a missing
// or expired token with 200 and an Unauthorized error, an image with 401.
function fakeServer() {
  const server = { password: "s3cret", access: new Set(), refresh: new Set(), requests: [], down: false, issued: 0 };
  server.expire = () => server.access.clear();
  const bearer = (headers) => (headers.Authorization || "").replace(/^Bearer /, "");
  server.answer = (req) => {
    server.requests.push(req);
    if (server.down) return { status: 0, body: "" };
    const token = bearer(req.headers);
    if (req.method === "GET") return server.access.has(token) ? { status: 200, body: "bytes", type: "image/png" } : { status: 401, body: "" };
    const { query, variables } = JSON.parse(req.body);
    const json = (o) => ({ status: 200, body: JSON.stringify(o) });
    const error = (m) => json({ errors: [{ message: m }] });
    if (/login\(/.test(query)) {
      if (server.access.has(token)) return error("Exception while fetching data (/login) : Cannot login while already logged-in");
      if (variables.username !== "miharchy" || variables.password !== server.password) return error("Exception while fetching data (/login) : Incorrect username or password.");
      const t = { accessToken: "a" + ++server.issued, refreshToken: "r" + server.issued };
      server.access.add(t.accessToken);
      server.refresh.add(t.refreshToken);
      return json({ data: { login: t } });
    }
    if (/refreshToken\(/.test(query)) {
      if (!server.refresh.has(variables.refreshToken)) return error("Exception while fetching data (/refreshToken) : The token was expected to have 3 parts, but got 0.");
      const accessToken = "a" + ++server.issued;
      server.access.add(accessToken);
      return json({ data: { refreshToken: { accessToken } } });
    }
    return server.access.has(token) ? json({ data: { ok: true } }) : error(UNAUTHORIZED);
  };
  return server;
}

// QML's XMLHttpRequest, answering from the fake server on a later tick.
function install(server) {
  globalThis.XMLHttpRequest = class {
    static DONE = 4;
    constructor() { this.readyState = 0; this.headers = {}; }
    open(method, url) { this.method = method; this.url = url; }
    setRequestHeader(k, v) { this.headers[k] = v; }
    getResponseHeader(k) { return k === "Content-Type" ? this.type : null; }
    send(body) {
      setImmediate(() => {
        if (this.readyState === 4) return;
        const a = server.answer({ method: this.method, url: this.url, headers: this.headers, body });
        this.finish(a.status, a.body, a.type);
      });
    }
    abort() { this.finish(0, "", null); }
    finish(status, body, type) {
      this.readyState = 4;
      this.status = status;
      this.responseText = body;
      this.response = body;
      this.type = type;
      this.onreadystatechange();
    }
  };
}

function setup() {
  const server = fakeServer();
  install(server);
  const S = load("Session.js");
  const send = (payload = { query: "{ mangas { totalCount } }" }) => new Promise((resolve) => S.send(config, payload, resolve));
  const image = () => new Promise((resolve) => S.image(config, config.url + "/api/v1/manga/1/thumbnail", resolve));
  return { server, S, send, image };
}

const isLogin = (r) => r.body && /login\(/.test(r.body);
const isRefresh = (r) => r.body && /refreshToken\(/.test(r.body);

test("the first requests share one login, then carry only the access token", async () => {
  const { server, send } = setup();
  const replies = await Promise.all([send(), send(), send()]);
  assert.deepEqual(replies.map((r) => r.state), ["ok", "ok", "ok"]);
  assert.equal((await send()).state, "ok");
  const logins = server.requests.filter(isLogin);
  assert.equal(logins.length, 1);
  assert.equal(logins[0].headers.Authorization, undefined, "login refuses a request that carries a token");
  for (const r of server.requests.filter((r) => !isLogin(r))) {
    assert.equal(r.headers.Authorization, "Bearer a1");
    assert.doesNotMatch(r.body, /s3cret/, "only the login carries the password");
  }
});

test("an expired token refreshes once for every refused request, and each goes once more", async () => {
  const { server, send } = setup();
  await send();
  server.expire();
  const replies = await Promise.all([send(), send()]);
  assert.deepEqual(replies.map((r) => r.state), ["ok", "ok"]);
  const refreshes = server.requests.filter(isRefresh);
  assert.equal(refreshes.length, 1);
  assert.equal(refreshes[0].headers.Authorization, undefined);
  assert.equal(JSON.parse(refreshes[0].body).variables.refreshToken, "r1");
  assert.equal(server.requests.filter(isLogin).length, 1);
  assert.equal(server.requests.at(-1).headers.Authorization, "Bearer a2");
});

test("a failed refresh falls back to a fresh login", async () => {
  const { server, send } = setup();
  await send();
  server.expire();
  server.refresh.clear();
  assert.equal((await send()).state, "ok");
  assert.equal(server.requests.filter(isRefresh).length, 1);
  assert.equal(server.requests.filter(isLogin).length, 2);
});

test("a wrong password answers every waiting request unauthorized, without a loop", async () => {
  const { server, send } = setup();
  server.password = "changed";
  const replies = await Promise.all([send(), send()]);
  assert.deepEqual(replies.map((r) => r.state), ["unauthorized", "unauthorized"]);
  assert.equal(server.requests.length, 1);
});

test("a request still refused after a new token answers unauthorized", async () => {
  const { server, S } = setup();
  // A token that the server refuses at once: it never stays valid.
  const answer = server.answer;
  server.answer = (req) => {
    const a = answer(req);
    if (!isLogin(req) && !isRefresh(req)) server.expire();
    return isLogin(req) || isRefresh(req) ? a : { status: 200, body: JSON.stringify({ errors: [{ message: UNAUTHORIZED }] }) };
  };
  const reply = await new Promise((resolve) => S.send(config, { query: "{ x }" }, resolve));
  assert.equal(reply.state, "unauthorized");
  assert.equal(server.requests.filter((r) => !isLogin(r) && !isRefresh(r)).length, 2);
});

test("a server that does not answer reads as down", async () => {
  const { server, send } = setup();
  server.down = true;
  assert.equal((await send()).state, "down");
});

test("an image refused with 401 refreshes and loads", async () => {
  const { server, send, image } = setup();
  await send();
  server.expire();
  const r = await image();
  assert.deepEqual(r, { status: 200, data: "bytes", contentType: "image/png" });
  assert.equal(server.requests.at(-1).method, "GET");
  assert.equal(server.requests.at(-1).headers.Authorization, "Bearer a2");
});

test("an image whose login fails answers status 0", async () => {
  const { server, image } = setup();
  server.password = "changed";
  assert.equal((await image()).status, 0);
});

test("abort answers at once as no answer, and a request waiting on the login never goes", async () => {
  const { server, S } = setup();
  const got = [];
  const handle = S.send(config, { query: "{ x }" }, (r) => got.push(r.state));
  handle.abort();
  assert.deepEqual(got, ["down"]);
  await new Promise((r) => setTimeout(r, 20));
  assert.deepEqual(got, ["down"]);
  assert.deepEqual(server.requests.filter((r) => !isLogin(r)), []);
});

test("a changed server.json logs in again with the new credentials", async () => {
  const { server, S } = setup();
  await new Promise((resolve) => S.send(config, { query: "{ x }" }, resolve));
  const other = { ...config, url: "http://127.0.0.1:4591" };
  await new Promise((resolve) => S.send(other, { query: "{ x }" }, resolve));
  assert.equal(server.requests.filter(isLogin).length, 2);
  assert.equal(server.requests.at(-1).url, "http://127.0.0.1:4591/api/graphql");
});
