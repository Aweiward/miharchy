const { test } = require("node:test");
const assert = require("node:assert/strict");
const L = require("./load")("Live.js");

// Messages as Suwayomi v2.3 and v2.4 send them in ui_login.
const UNAUTHORIZED = JSON.stringify({ type: "error", id: "1", payload: [{ message: "Exception while fetching data (/downloadStatusChanged) : Unauthorized\r\n\r\nsuwayomi.tachidesk.server.user.UnauthorizedException: Unauthorized\n\tat suwayomi.tachidesk.server.user.UserTypeKt.requireUser(UserType.kt:23)" }] });

test("the socket speaks graphql-transport-ws on the server's /api/graphql", () => {
  assert.equal(L.PROTOCOL, "graphql-transport-ws");
  assert.equal(L.url({ url: "http://127.0.0.1:4590" }), "ws://127.0.0.1:4590/api/graphql");
  assert.equal(L.url({ url: "https://manga.example" }), "wss://manga.example/api/graphql");
});

test("connection_init carries the bare access token, never Bearer", () => {
  assert.deepEqual(JSON.parse(L.initMessage("eyJ.a.b")), { type: "connection_init", payload: { Authorization: "eyJ.a.b" } });
  assert.deepEqual(JSON.parse(L.subscribeMessage("subscription { x }", 0.123)), { id: "miharchy-123", type: "subscribe", payload: { query: "subscription { x }" } });
});

test("each subscribe takes its own id: the server refuses one in use on any socket", () => {
  assert.notEqual(JSON.parse(L.subscribeMessage("q", 0.25)).id, JSON.parse(L.subscribeMessage("q", 0.5)).id);
});

test("the socket pings well inside the server's 30 s idle timeout", () => {
  assert.ok(L.PING_MS < 30000);
  assert.deepEqual(JSON.parse(L.PING), { type: "ping" });
  assert.deepEqual(JSON.parse(L.PONG), { type: "pong" });
});

test("each server message says what the socket does next", () => {
  assert.deepEqual(L.parse('{"type":"connection_ack"}'), { type: "ack" });
  assert.deepEqual(L.parse('{"type":"ping"}'), { type: "ping" });
  assert.deepEqual(L.parse('{"type":"pong"}'), { type: "none" });
  assert.deepEqual(L.parse('{"type":"next","id":"1","payload":{"data":{"downloadStatusChanged":{"state":"STOPPED","initial":[]}}}}'),
    { type: "data", data: { downloadStatusChanged: { state: "STOPPED", initial: [] } } });
  assert.deepEqual(L.parse(UNAUTHORIZED), { type: "unauthorized" }, "a stale token: renew, then connect again");
  assert.deepEqual(L.parse('{"type":"next","id":"1","payload":{"errors":[{"message":"Exception while fetching data (/x) : Unauthorized"}]}}'), { type: "unauthorized" });
  assert.deepEqual(L.parse('{"type":"error","id":"1","payload":[{"message":"Validation error"}]}'), { type: "ended", message: "Validation error" });
  assert.deepEqual(L.parse('{"type":"complete","id":"1"}'), { type: "ended", message: "" });
  assert.deepEqual(L.parse("not json"), { type: "none" });
});

test("reconnects back off from 1 s to at most 15 s", () => {
  assert.deepEqual([0, 1, 2, 3, 4, 5, 20].map(L.backoff), [1000, 2000, 4000, 8000, 15000, 15000, 15000]);
});
