const { test } = require("node:test");
const assert = require("node:assert/strict");
const T = require("./load")("Trackers.js");
const M = require("./load")("Model.js");

const ok = (data) => M.coreReply(200, JSON.stringify(data));
const err = (message) => M.coreReply(400, JSON.stringify({ error: { kind: "invalid", message } }));
const down = () => M.coreReply(0, "");

// The trackers miharchy-core offers, as a logged-out server lists them.
const MAL_URL = "https://myanimelist.net/v1/oauth2/authorize?client_id=3fda277931a4f9bc01fa4a715ce8b91d&code_challenge=3ZUBGuF&response_type=code";
const ANILIST_URL = "https://anilist.co/api/v2/oauth/authorize?client_id=16186&response_type=token";
const nodes = [
  { id: 1, name: "MyAnimeList", isLoggedIn: false, authUrl: MAL_URL },
  { id: 2, name: "AniList", isLoggedIn: false, authUrl: ANILIST_URL },
  { id: 3, name: "Kitsu", isLoggedIn: false, authUrl: null },
  { id: 7, name: "MangaUpdates", isLoggedIn: false, authUrl: null },
  { id: 4, name: "Shikimori", isLoggedIn: false, authUrl: "https://shikimori.one/oauth/authorize?client_id=q&redirect_uri=https%3A%2F%2Ftracker.example%2Ftracker-oauth&response_type=code" },
  { id: 5, name: "Bangumi", isLoggedIn: false, authUrl: "https://bgm.tv/oauth/authorize?client_id=b&response_type=code&redirect_uri=https%3A%2F%2Ftracker.example%2Ftracker-oauth" }
];
const listed = (list) => T.reduce(T.initial(), { type: "list", reply: ok({ trackers: list || nodes }) });
const at = (s, name) => s.list.findIndex((t) => t.name === name);
const loggedIn = (n) => Object.assign({}, n, { isLoggedIn: true, authUrl: null });

test("the list holds every tracker the server offers, each logged out until it says otherwise", () => {
  const s = listed();
  assert.equal(s.state, "ok");
  assert.deepEqual(s.list.map((t) => t.name), ["MyAnimeList", "AniList", "Kitsu", "MangaUpdates", "Shikimori", "Bangumi"]);
  assert.deepEqual(s.list.map((_, i) => T.status(s, i)), Array(6).fill("not logged in"));
  assert.deepEqual(T.listPayload(), { route: "tracker.list" });
  const failed = T.reduce(s, { type: "list", reply: down() });
  assert.equal(failed.state, "down");
  assert.equal(failed.list.length, 6, "a failed reload keeps the list");
});

test("an OAuth login asks for a fresh link first, then waits for the pasted address", () => {
  let s = T.begin(listed(), 0);
  assert.deepEqual(T.loginPayload(s), { route: "tracker.list" });
  assert.equal(T.status(s, 0), "opening the browser");
  assert.equal(T.editing(s), false);
  s = T.reduce(s, { type: "sent" });
  assert.equal(T.loginPayload(s), null, "the link goes out once");
  const fresh = MAL_URL.replace("3ZUBGuF", "newverifier");
  s = T.reduce(s, { type: "link", reply: ok({ trackers: [Object.assign({}, nodes[0], { authUrl: fresh })] }) });
  assert.equal(s.login.step, "paste");
  assert.equal(s.login.url, fresh, "the browser opens the link the server made last, whose verifier it holds");
  assert.equal(T.editing(s), true);
  assert.equal(T.prompt(s.login), "address");
  assert.match(T.note(s), /address bar/);
  assert.ok(T.note(s).endsWith(fresh), "the note carries the link, for when no browser opens");
  assert.equal(T.begin(s, 1), s, "one login at a time");
});

test("the pasted address must carry the key the provider answers with", () => {
  assert.equal(T.callbackError("https://tracker.example/tracker-oauth#access_token=eyJ0eXAi.abc&token_type=Bearer&expires_in=31536000", ANILIST_URL), "");
  assert.equal(T.callbackError("https://tracker.example/tracker-oauth?code=def502&state=x", MAL_URL), "");
  assert.equal(T.callbackError("https://tracker.example/tracker-oauth?code=abc", "https://bgm.tv/oauth/authorize?client_id=b&response_type=code&redirect_uri=x"), "");
  assert.match(T.callbackError("https://tracker.example/tracker-oauth?code=abc", ANILIST_URL), /access_token=/, "AniList never answers with a code");
  for (const bad of ["", "eyJ0eXAi.abc", "https://tracker.example/tracker-oauth", "https://tracker.example/tracker-oauth#access_token=&x=1"]) {
    assert.ok(T.callbackError(bad, ANILIST_URL), JSON.stringify(bad));
  }
});

const pasting = () => T.reduce(T.reduce(T.reduce(T.begin(listed(), 1), { type: "sent" }), { type: "link", reply: ok({ trackers: nodes }) }), { type: "commit", text: "" });

test("a bad paste stays in the field with the reason; a good one goes to the server whole", () => {
  let s = pasting();
  assert.equal(s.login.step, "paste");
  assert.match(T.note(s), /no access_token=/);
  const url = "https://tracker.example/tracker-oauth#access_token=tok&token_type=Bearer&expires_in=31536000";
  s = T.reduce(s, { type: "commit", text: "  " + url + "\n" });
  assert.equal(T.editing(s), false);
  assert.equal(T.status(s, 1), "logging in");
  const p = T.loginPayload(s);
  assert.deepEqual(p, { route: "tracker.login", body: { trackerId: 2, callbackUrl: url } });
});

test("a refused login reopens the field with the server's reason and a way to a fresh link", () => {
  for (const reason of ["cannot find token", "HTTP error 400"]) {
    let s = T.reduce(pasting(), { type: "commit", text: "https://tracker.example/tracker-oauth#access_token=bad" });
    s = T.reduce(T.reduce(s, { type: "sent" }), { type: "reply", reply: err(reason) });
    assert.equal(s.login.step, "paste");
    assert.equal(T.note(s), "AniList did not accept the login: " + reason + ". Press Esc, then Enter for a fresh link.");
    assert.equal(s.list[1].loggedIn, false);
  }
});

test("an accepted login closes the field and marks the tracker logged in", () => {
  let s = T.reduce(pasting(), { type: "commit", text: "https://tracker.example/tracker-oauth#access_token=good" });
  s = T.reduce(T.reduce(s, { type: "sent" }), { type: "reply", reply: ok({ tracker: loggedIn(nodes[1]) }) });
  assert.equal(s.login, null);
  assert.equal(T.status(s, 1), "logged in");
  assert.equal(T.note(s), "");
});

test("Esc in the field drops the login", () => {
  const s = T.reduce(pasting(), { type: "cancel" });
  assert.equal(s.login, null);
  assert.equal(T.status(s, 1), "not logged in");
});

test("a credentials tracker asks for username, then a password, sent once and never kept", () => {
  let s = T.begin(listed(), 2);
  assert.equal(T.loginPayload(s), null, "nothing goes out before the password");
  assert.equal(T.prompt(s.login), "username");
  assert.match(T.note(s), /keeps only its token/);
  s = T.reduce(s, { type: "commit", text: "  " });
  assert.equal(s.login.error, "Enter your Kitsu username.");
  s = T.reduce(s, { type: "commit", text: " reader@example.com " });
  assert.equal(T.prompt(s.login), "password");
  s = T.reduce(s, { type: "commit", text: " pass word " });
  const p = T.loginPayload(s);
  assert.deepEqual(p, { route: "tracker.login", body: { trackerId: 3, username: "reader@example.com", password: " pass word " } }, "a password keeps its spaces");
  s = T.reduce(T.reduce(s, { type: "sent" }), { type: "reply", reply: err("Unable to login") });
  assert.equal(s.login.step, "password");
  assert.equal(s.login.password, "", "a refused password is dropped");
  assert.equal(T.note(s), "Kitsu did not accept the login: Unable to login");
  s = T.reduce(s, { type: "commit", text: "right" });
  s = T.reduce(T.reduce(s, { type: "sent" }), { type: "reply", reply: ok({ tracker: loggedIn(nodes[2]) }) });
  assert.equal(s.login, null, "the password leaves memory with the login");
  assert.equal(T.status(s, 2), "logged in");
});

test("a login the server answers without logging in reads as refused", () => {
  let s = T.reduce(T.reduce(T.begin(listed(), 3), { type: "commit", text: "u" }), { type: "commit", text: "p" });
  s = T.reduce(T.reduce(s, { type: "sent" }), { type: "reply", reply: ok({ tracker: nodes[3] }) });
  assert.equal(T.note(s), "MangaUpdates did not accept the login.");
});

test("Enter on a logged-in tracker logs out", () => {
  let s = listed([loggedIn(nodes[1])]);
  assert.equal(T.status(s, 0), "logged in");
  s = T.begin(s, 0);
  assert.deepEqual(T.loginPayload(s), { route: "tracker.logout", body: { trackerId: 2 } });
  assert.equal(T.status(s, 0), "logging out");
  s = T.reduce(T.reduce(s, { type: "sent" }), { type: "reply", reply: ok({ tracker: nodes[1] }) });
  assert.equal(s.login, null);
  assert.equal(T.status(s, 0), "not logged in");
  const failed = T.reduce(T.reduce(T.begin(listed([loggedIn(nodes[1])]), 0), { type: "sent" }), { type: "reply", reply: down() });
  assert.equal(T.note(failed), "Could not log out of AniList: down");
});

test("a link the server could not make ends the login with the reason", () => {
  const s = T.reduce(T.reduce(T.begin(listed(), 0), { type: "sent" }), { type: "link", reply: down() });
  assert.equal(s.login, null);
  assert.equal(T.note(s), "Could not get the MyAnimeList login link: down");
});

// --- the tracking panel ---

const trackersNode = (id, name, on) => ({
  id, name, isLoggedIn: on,
  scores: ["0", "1", "2", "3", "4", "5", "6", "7", "8", "9", "10"],
  statuses: [{ value: 1, name: "Reading" }, { value: 2, name: "Completed" }, { value: 5, name: "Plan to read" }]
});
const record = (o) => Object.assign({ id: 31, trackerId: 2, remoteId: "30002", title: "Berserk", status: 1, displayScore: "8", lastChapterRead: 12, totalChapters: 380, remoteUrl: "https://anilist.co/manga/30002" }, o);
// The reply T.panelLoad builds from core's two routes.
const panelReply = (records, trackers) => {
  const sent = [];
  let out;
  T.panelLoad((payload, done) => {
    sent.push(payload);
    done(payload.route === "tracker.list"
      ? ok({ trackers: trackers || [trackersNode(1, "MyAnimeList", false), trackersNode(2, "AniList", true), trackersNode(3, "Kitsu", true), trackersNode(7, "MangaUpdates", false)] })
      : ok({ tracks: records }));
  }, T.panel(5, "Berserk"), (r) => { out = r; });
  assert.deepEqual(sent, [{ route: "tracker.list" }, { route: "track.list", body: { mangaIds: [5] } }]);
  return out;
};
const open = (records, trackers) => T.act(T.panel(5, "Berserk"), { type: "loaded", reply: panelReply(records, trackers) }).panel;
const run = (p, event) => T.act(p, event);
const onRow = (p, name) => run(p, { type: "move", delta: p.rows.findIndex((r) => r.tracker.name === name) - p.cursor }).panel;

test("the panel lists logged-in trackers and any tracker holding a track of the manga", () => {
  const p = open([record({ id: 40, trackerId: 1, status: 2, displayScore: "0", lastChapterRead: 380 }), record()]);
  assert.deepEqual(p.rows.map((r) => r.tracker.name), ["MyAnimeList", "AniList", "Kitsu"], "MangaUpdates is logged out with no track");
  assert.deepEqual(p.rows.map(T.summary), ["log in under Settings to change it", "Reading   12 / 380 chapters   score 8", "not tracked"]);
  const unknown = open([record({ totalChapters: 0, lastChapterRead: 12.5, displayScore: "-" })]);
  assert.equal(T.summary(unknown.rows[0]), "Reading   12.5 / ? chapters");
});

test("a logged-out tracker's track shows, but changes wait for the login", () => {
  const p = open([record({ trackerId: 1 })]);
  const r = run(p, { type: "status" });
  assert.equal(r.payload, null);
  assert.equal(r.panel.error, "Log in to MyAnimeList under Settings first.");
});

test("Enter searches the tracker for the manga's title, and a result binds it", () => {
  let p = onRow(open([]), "AniList");
  assert.equal(p.rows[p.cursor].tracker.name, "AniList");
  p = run(p, { type: "search" }).panel;
  assert.equal(p.mode, "query");
  assert.equal(T.fieldStart(p), "Berserk");
  let r = run(p, { type: "query", text: "  " });
  assert.equal(r.payload, null);
  r = run(p, { type: "query", text: " Berserk " });
  assert.deepEqual(r.payload, { route: "track.search", body: { trackerId: 2, query: "Berserk" } });
  p = run(r.panel, { type: "results", reply: ok({ results: [
    { remoteId: "30002", title: "Berserk", publishingType: "MANGA", startDate: "1989-08-25", totalChapters: 0 },
    { remoteId: "86516", title: "Berserk: The Prototype", publishingType: "ONE_SHOT", startDate: "", totalChapters: 1 }
  ] }) }).panel;
  assert.equal(p.mode, "pick");
  assert.deepEqual(p.pick.items.map((i) => [i.label, i.detail]), [["Berserk", "MANGA   1989"], ["Berserk: The Prototype", "ONE_SHOT   1 chapters"]]);
  p = run(p, { type: "move", delta: 5 }).panel;
  assert.equal(p.pick.cursor, 1, "the pick cursor stays on the list");
  p = run(p, { type: "move", delta: -1 }).panel;
  r = run(p, { type: "choose" });
  assert.deepEqual(r.payload, { route: "track.bind", body: { mangaId: 5, trackerId: 2, remoteId: "30002" } });
  assert.equal(r.panel.busy, true);
  assert.equal(r.panel.mode, "list");
  assert.equal(run(r.panel, { type: "status" }).payload, null, "nothing else goes out while a write is in flight");
  // The server pushes the highest read chapter as it binds, so the reply carries it.
  p = run(r.panel, { type: "written", trackerId: 2, reply: ok({ track: record({ lastChapterRead: 40, displayScore: "0" }) }) }).panel;
  assert.equal(p.busy, false);
  assert.equal(T.summary(p.rows[0]), "Reading   40 / 380 chapters");
});

test("a search that fails or finds nothing says so and returns to the list", () => {
  const searching = run(run(onRow(open([]), "AniList"), { type: "search" }).panel, { type: "query", text: "zzz" }).panel;
  const none = run(searching, { type: "results", reply: ok({ results: [] }) }).panel;
  assert.equal(none.mode, "list");
  assert.match(none.error, /Nothing on AniList matches/);
  const failed = run(searching, { type: "results", reply: down() }).panel;
  assert.equal(failed.mode, "list");
  assert.equal(failed.error, "down");
});

test("s, S and c change status, score and chapters read through track.update", () => {
  const p = onRow(open([record()]), "AniList");
  let r = run(p, { type: "status" });
  assert.deepEqual(r.panel.pick.items.map((i) => i.label), ["Reading", "Completed", "Plan to read"]);
  assert.equal(r.panel.pick.cursor, 0, "the pick starts on the current status");
  r = run(run(r.panel, { type: "move", delta: 1 }).panel, { type: "choose" });
  assert.deepEqual(r.payload, { route: "track.update", body: { recordId: 31, status: 2 } });
  // Completed fills chapters read on the server, so the row shows the returned record.
  const done = run(r.panel, { type: "written", trackerId: 2, reply: ok({ track: record({ status: 2, lastChapterRead: 380 }) }) }).panel;
  assert.equal(T.summary(done.rows[0]), "Completed   380 / 380 chapters   score 8");

  r = run(p, { type: "score" });
  assert.equal(r.panel.pick.items[r.panel.pick.cursor].label, "8");
  r = run(run(r.panel, { type: "move", delta: 1 }).panel, { type: "choose" });
  assert.deepEqual(r.payload.body, { recordId: 31, scoreString: "9" });

  const field = run(p, { type: "chapters" }).panel;
  assert.equal(field.mode, "progress");
  assert.equal(T.fieldStart(field), "12");
  assert.equal(run(field, { type: "progress", text: "twelve" }).payload, null);
  assert.match(run(field, { type: "progress", text: "-3" }).panel.error, /number of the last chapter/);
  assert.deepEqual(run(field, { type: "progress", text: " 13.5 " }).payload.body, { recordId: 31, lastChapterRead: 13.5 });
});

test("status, score and chapters need a track first", () => {
  const p = onRow(open([]), "AniList");
  for (const type of ["status", "score", "chapters", "unbind"]) {
    const r = run(p, { type });
    assert.equal(r.payload, null, type);
    assert.equal(r.panel.mode, "list", type);
  }
});

test("x stops tracking: the record goes, the tracker's own list is left alone", () => {
  const p = onRow(open([record()]), "AniList");
  const r = run(p, { type: "unbind" });
  assert.deepEqual(r.payload, { route: "track.unbind", body: { recordId: 31 } });
  const after = run(r.panel, { type: "written", trackerId: 2, reply: ok({ deleted: 31 }) }).panel;
  assert.equal(T.summary(after.rows[0]), "not tracked");
  const failed = run(r.panel, { type: "written", trackerId: 2, reply: M.coreReply(500, "") }).panel;
  assert.equal(failed.busy, false);
  assert.equal(T.summary(failed.rows[0]), "Reading   12 / 380 chapters   score 8", "a failed write keeps the row");
  assert.match(failed.error, /HTTP 500/);
});

test("Esc in a pick list goes back to the trackers", () => {
  const p = run(onRow(open([record()]), "AniList"), { type: "status" }).panel;
  const back = run(p, { type: "back" }).panel;
  assert.equal(back.mode, "list");
  assert.equal(back.pick, null);
});

const dated = () => [trackersNode(1, "MyAnimeList", true), Object.assign(trackersNode(2, "AniList", true), { supportsReadingDates: true, supportsPrivateTracking: true })];

test("reading dates: a YYYY-MM-DD field saved as UTC midnight, empty clears, only where the tracker keeps them", () => {
  const p = onRow(open([record({ startDate: 1767225600000, finishDate: 0, private: true })], dated()), "AniList");
  assert.equal(T.summary(p.rows[p.cursor]), "Reading   12 / 380 chapters   score 8   started 2026-01-01   private");
  const field = run(p, { type: "start" }).panel;
  assert.equal(field.mode, "start");
  assert.equal(T.fieldStart(field), "2026-01-01", "the field starts on the date set");
  assert.equal(T.fieldStart(run(p, { type: "finish" }).panel), "", "no finish date yet");
  assert.deepEqual(run(field, { type: "date", text: " 2026-02-03 " }).payload.body, { recordId: 31, startDate: String(Date.UTC(2026, 1, 3)) });
  assert.deepEqual(run(run(p, { type: "finish" }).panel, { type: "date", text: "2026-03-01" }).payload.body, { recordId: 31, finishDate: String(Date.UTC(2026, 2, 1)) });
  assert.deepEqual(run(field, { type: "date", text: "" }).payload.body, { recordId: 31, startDate: "0" }, "empty clears it");
  for (const bad of ["2026-02-30", "3/2/2026", "2026-2-3"]) {
    const r = run(field, { type: "date", text: bad });
    assert.equal(r.payload, null, bad);
    assert.match(r.panel.error, /2026-01-31/, bad);
  }
  const mal = run(onRow(open([record({ trackerId: 1 })], dated()), "MyAnimeList"), { type: "start" });
  assert.equal(mal.panel.mode, "list");
  assert.match(mal.panel.error, /keeps no reading dates/);
  assert.match(run(onRow(open([], dated()), "AniList"), { type: "finish" }).panel.error, /first/);
});

test("private turns on and off where the tracker has it", () => {
  const p = onRow(open([record({ private: false })], dated()), "AniList");
  const r = run(p, { type: "private" });
  assert.deepEqual(r.payload, { route: "track.update", body: { recordId: 31, private: true } });
  const done = run(r.panel, { type: "written", trackerId: 2, reply: ok({ track: record({ private: true }) }) }).panel;
  assert.match(T.summary(done.rows[done.cursor]), /private$/);
  assert.deepEqual(run(done, { type: "private" }).payload.body, { recordId: 31, private: false });
  const mal = run(onRow(open([record({ trackerId: 1 })], dated()), "MyAnimeList"), { type: "private" });
  assert.equal(mal.payload, null);
  assert.match(mal.panel.error, /no private tracking/);
});

test("the link is the track's page, on a logged-out tracker too", () => {
  const p = open([record({ trackerId: 1, remoteUrl: "https://myanimelist.net/manga/2" })]);
  assert.equal(T.link(p), "https://myanimelist.net/manga/2");
  assert.equal(T.link(onRow(p, "AniList")), "", "no track, no link");
});

test("a panel load that fails carries the connection state", () => {
  const p = T.act(T.panel(5, "x"), { type: "loaded", reply: M.coreReply(401, JSON.stringify({ error: { kind: "unauthorized" } })) }).panel;
  assert.equal(p.state, "unauthorized");
  assert.ok(M.problem(p, "c"));
});
