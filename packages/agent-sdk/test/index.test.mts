import assert from "node:assert/strict";
import { afterEach, test } from "node:test";

import { HeroApi, HeroApiError, runHeroBot } from "../src/index.ts";

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
});

test("register captures session lease metadata", async () => {
  const fetchMock = installFetchMock([
    jsonResponse(200, makeRegisterResponse()),
  ]);
  const api = new HeroApi("http://example.test", makeRegistration());

  const result = await api.register();

  assert.equal(result.sessionToken, "session-1");
  assert.equal(api.heroSessionToken, "session-1");
  assert.equal(api.sessionStatus, "active");
  assert.deepEqual(api.lease, {
    leaseExpiresAt: 1_700_000_000_000,
    leaseTtlMs: 5_000,
    sessionStatus: "active",
  });
  assert.equal(fetchMock.calls.length, 1);
  assert.equal(
    fetchMock.calls[0].url,
    "http://example.test/api/heroes/register",
  );
  assert.equal(
    headerValue(fetchMock.calls[0].init.headers, "authorization"),
    "Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.neural-necropolis-dev-player.signature",
  );
});

test("observe retries safe requests and preserves session token header", async () => {
  const fetchMock = installFetchMock([
    jsonResponse(503, { error: "server_unavailable", message: "try later" }),
    jsonResponse(200, makeObserveResponse()),
  ]);
  const api = new HeroApi("http://example.test", makeRegistration());
  api._heroSessionToken = "session-1";

  const result = await api.observe();

  assert.equal(result.boardId, "board-a");
  assert.equal(fetchMock.calls.length, 2);
  assert.equal(
    headerValue(fetchMock.calls[0].init.headers, "x-hero-session-token"),
    "session-1",
  );
  assert.equal(
    headerValue(fetchMock.calls[1].init.headers, "x-hero-session-token"),
    "session-1",
  );
});

test("act sends one idempotent request and blocks client-side duplicates", async () => {
  const fetchMock = installFetchMock([
    jsonResponse(200, {
      accepted: true,
      message: "queued",
      requestId: "req-1",
      turnState: makeTurnState({ turn: 7, started: true }),
    }),
  ]);
  const api = new HeroApi("http://example.test", makeRegistration());
  api._heroSessionToken = "session-1";
  api._boardId = "board-a";
  api._turnState = makeTurnState({ turn: 7, started: true });

  const first = await api.act({ kind: "wait" });
  const second = await api.act({ kind: "wait" });

  assert.equal(first.accepted, true);
  assert.equal(second.accepted, false);
  assert.match(second.message, /client duplicate submit blocked/);
  assert.equal(fetchMock.calls.length, 1);
  assert.ok(headerValue(fetchMock.calls[0].init.headers, "idempotency-key"));
});

test("expired sessions throw typed errors and update local session status", async () => {
  const fetchMock = installFetchMock([
    jsonResponse(401, {
      error: "expired_session",
      message: "Hero session expired. Re-register for an open board.",
      requestId: "req-expired",
      turnState: makeTurnState({ turn: 3, started: true }),
    }),
  ]);
  const api = new HeroApi("http://example.test", makeRegistration());
  api._heroSessionToken = "session-1";
  api._sessionStatus = "active";

  await assert.rejects(api.observe(), (error) => {
    assert.ok(error instanceof HeroApiError);
    assert.equal(error.code, "expired_session");
    assert.equal(error.status, 401);
    assert.equal(error.sessionExpired, true);
    return true;
  });

  assert.equal(fetchMock.calls.length, 1);
  assert.equal(api.sessionStatus, "expired");
});

test("maybeHeartbeat only calls the API when the lease is near expiry", async () => {
  const fetchMock = installFetchMock([
    jsonResponse(200, {
      ok: true,
      boardId: "board-a",
      requestId: "req-heartbeat",
      turnState: makeTurnState({ turn: 4, started: false }),
      leaseExpiresAt: 1_700_000_010_000,
      leaseTtlMs: 5_000,
      sessionStatus: "active",
    }),
  ]);
  const api = new HeroApi("http://example.test", makeRegistration());
  api._heroSessionToken = "session-1";
  api._sessionStatus = "active";
  api._leaseTtlMs = 5_000;
  api._leaseExpiresAt = Date.now() + 30_000;

  const skipped = await api.maybeHeartbeat();
  assert.equal(skipped, null);
  assert.equal(fetchMock.calls.length, 0);

  api._leaseExpiresAt = Date.now() + 250;
  const renewed = await api.maybeHeartbeat(500);

  assert.ok(renewed);
  assert.equal(fetchMock.calls.length, 1);
  assert.equal(
    headerValue(fetchMock.calls[0].init.headers, "x-hero-session-token"),
    "session-1",
  );
});

test("runHeroBot re-registers after an expired session and resumes the loop", async () => {
  const sleepCalls = [];
  const controller = new AbortController();
  const registration = makeRegistration();
  const observedBoards = [];
  const fetchMock = installFetchMock([
    jsonResponse(
      200,
      makeRegisterResponse({ boardId: "board-a", sessionToken: "session-a" }),
    ),
    jsonResponse(401, {
      error: "expired_session",
      message: "Hero session expired. Re-register for an open board.",
      requestId: "req-expired",
      turnState: makeTurnState({ turn: 1, started: false }),
    }),
    jsonResponse(
      200,
      makeRegisterResponse({
        boardId: "board-b",
        sessionToken: "session-b",
        position: { x: 2, y: 3 },
      }),
    ),
    jsonResponse(
      200,
      makeObserveResponse({
        boardId: "board-b",
        hero: makeHero({ id: registration.id, name: registration.name }),
        turnState: makeTurnState({ turn: 2, started: true }),
      }),
    ),
  ]);

  await assert.rejects(
    runHeroBot(
      registration,
      async ({ vision }) => {
        observedBoards.push(vision?.boardId ?? "missing");
        controller.abort(new Error("stop-bot"));
      },
      "http://example.test",
      {
        signal: controller.signal,
        sleep: async (ms) => {
          sleepCalls.push(ms);
        },
      },
    ),
    /stop-bot/,
  );

  const registerCalls = fetchMock.calls.filter((call) =>
    call.url.endsWith("/api/heroes/register"),
  );
  assert.equal(registerCalls.length, 2);
  assert.deepEqual(observedBoards, ["board-b"]);
  assert.ok(sleepCalls.includes(200));
});

function makeRegistration(overrides = {}) {
  return {
    id: "hero-1",
    name: "HarnessBot",
    trait: "reckless",
    strategy: "SDK harness",
    ...overrides,
  };
}

function makeTurnState(overrides = {}) {
  return {
    turn: 1,
    phase: "submit",
    started: false,
    submitWindowMs: 5_000,
    resolveWindowMs: 2_500,
    phaseEndsAt: 1_700_000_000_000,
    phaseDurationMs: 5_000,
    phaseElapsedMs: 100,
    seed: "seed-1",
    ...overrides,
  };
}

function makeHero(overrides = {}) {
  return {
    id: "hero-1",
    name: "HarnessBot",
    trait: "reckless",
    strategy: "SDK harness",
    status: "alive",
    position: { x: 1, y: 2 },
    score: 10,
    gold: 0,
    kills: 0,
    tilesExplored: 0,
    fatigue: 0,
    morale: 0,
    lastAction: "observing",
    stats: {
      hp: 12,
      maxHp: 12,
      attack: 4,
      defense: 2,
      speed: 3,
      perception: 5,
    },
    equipment: {
      weapon: null,
      armor: null,
      accessory: null,
    },
    effects: [],
    inventory: [],
    ...overrides,
  };
}

function makeRegisterResponse(overrides = {}) {
  return {
    ...makeHero(),
    boardId: "board-a",
    sessionToken: "session-1",
    requestId: "req-register",
    turnState: makeTurnState(),
    leaseExpiresAt: 1_700_000_000_000,
    leaseTtlMs: 5_000,
    sessionStatus: "active",
    ...overrides,
  };
}

function makeObserveResponse(overrides = {}) {
  return {
    seed: "seed-1",
    turn: 1,
    boardId: "board-a",
    boardStatus: "running",
    hero: makeHero(),
    visibleTiles: [],
    visibleMonsters: [],
    visibleHeroes: [],
    visibleNpcs: [],
    visibleItems: [],
    recentEvents: [],
    legalActions: [{ kind: "wait" }],
    turnState: makeTurnState({ started: true }),
    requestId: "req-observe",
    gameSettings: {
      paused: false,
      includeLandmarks: false,
      includePlayerPositions: false,
      autoPauseAfterBoard: false,
    },
    leaseExpiresAt: 1_700_000_000_000,
    leaseTtlMs: 5_000,
    sessionStatus: "active",
    ...overrides,
  };
}

function jsonResponse(status, body) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json",
    },
  });
}

function installFetchMock(plans) {
  const calls = [];
  globalThis.fetch = async (input, init = {}) => {
    const url = typeof input === "string" ? input : input.url;
    calls.push({ url, init });
    const next = plans.shift();
    if (!next) {
      throw new Error(`Unexpected fetch: ${url}`);
    }
    if (next instanceof Error) {
      throw next;
    }
    return next;
  };
  return { calls };
}

function headerValue(headers, name) {
  const needle = name.toLowerCase();
  if (!headers) {
    return undefined;
  }
  if (headers instanceof Headers) {
    return headers.get(name) ?? undefined;
  }
  const entries = Array.isArray(headers) ? headers : Object.entries(headers);
  for (const [key, value] of entries) {
    if (String(key).toLowerCase() === needle) {
      return String(value);
    }
  }
  return undefined;
}
