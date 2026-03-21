import type {
  ActionConflictResponse,
  ActionResponse,
  HeartbeatResponse,
  HealthResponse,
  HeroAction,
  HeroLease,
  HeroProfile,
  HeroRegistration,
  HeroLogRequest,
  HeroSessionStatus,
  LogResponse,
  ObserveResponse,
  RegisterResponse,
  TurnState,
  VisionData,
} from "./types.js";

export type {
  ActionConflictResponse,
  ActionResponse,
  HeartbeatResponse,
  HealthResponse,
  HeroAction,
  HeroLease,
  HeroProfile,
  HeroRegistration,
  HeroLogRequest,
  HeroSessionStatus,
  LogResponse,
  ObserveResponse,
  RegisterResponse,
  TurnState,
  VisionData,
} from "./types.js";

export type HeroConnectionOptions = {
  baseUrl?: string;
  authToken?: string;
  headers?: Record<string, string>;
};

export type ResolvedHeroConnection = {
  baseUrl: string;
  authToken?: string;
  headers: Record<string, string>;
};

const DEFAULT_DEV_PLAYER_AUTH_TOKEN =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.neural-necropolis-dev-player.signature";

const DEFAULT_RETRY_DELAY_MS = 250;
const DEFAULT_KEEPALIVE_BUFFER_MS = 1_000;
const DEFAULT_KEEPALIVE_POLL_MS = 500;

export type HeroApiErrorCode =
  | "transport_error"
  | "http_error"
  | "invalid_request"
  | "missing_auth"
  | "invalid_auth"
  | "missing_session"
  | "invalid_session"
  | "expired_session"
  | "wrong_phase"
  | "hero_capacity_reached"
  | "not_found"
  | "server_error"
  | "unknown";

type HeroApiErrorOptions = {
  code: HeroApiErrorCode;
  message: string;
  status?: number;
  requestId?: string;
  turnState?: TurnState;
  retryable?: boolean;
  cause?: unknown;
};

type RequestRetryMode = "none" | "safe" | "idempotent";

type ErrorPayload = {
  error?: string;
  message?: string;
  requestId?: string;
  turnState?: TurnState;
};

export type LeaseKeepaliveOptions = {
  bufferMs?: number;
  pollIntervalMs?: number;
  onError?: (error: HeroApiError) => void;
};

export class HeroApiError extends Error {
  readonly code: HeroApiErrorCode;
  readonly status: number;
  readonly requestId?: string;
  readonly turnState?: TurnState;
  readonly retryable: boolean;

  constructor(options: HeroApiErrorOptions) {
    super(options.message, { cause: options.cause });
    this.name = "HeroApiError";
    this.code = options.code;
    this.status = options.status ?? 0;
    this.requestId = options.requestId;
    this.turnState = options.turnState;
    this.retryable = options.retryable ?? false;
  }

  get sessionExpired(): boolean {
    return this.code === "expired_session";
  }

  get authFailed(): boolean {
    return this.code === "missing_auth" || this.code === "invalid_auth";
  }
}

export class HeroApi {
  private _turnState: TurnState | null = null;
  private _lastVision: VisionData | null = null;
  private _boardId: string | null = null;
  private _lastSubmittedTurnKey: string | null = null;
  private _heroSessionToken: string | null = null;
  private _leaseExpiresAt: number | null = null;
  private _leaseTtlMs: number | null = null;
  private _sessionStatus: HeroSessionStatus | null = null;
  private _keepaliveTimer: ReturnType<typeof setInterval> | null = null;
  private _keepaliveInFlight = false;
  private _backgroundFailure: HeroApiError | null = null;
  private _keepaliveOptions: Required<LeaseKeepaliveOptions> = {
    bufferMs: DEFAULT_KEEPALIVE_BUFFER_MS,
    pollIntervalMs: DEFAULT_KEEPALIVE_POLL_MS,
    onError: () => undefined,
  };
  private readonly baseUrl: string;
  private readonly authToken?: string;
  private readonly headers: Record<string, string>;

  constructor(
    connection: string | HeroConnectionOptions,
    private readonly hero: HeroRegistration,
  ) {
    const resolved = resolveConnectionOptions(connection);
    this.baseUrl = resolved.baseUrl;
    this.authToken = resolved.authToken;
    this.headers = resolved.headers;
  }

  get turnState(): TurnState | null {
    return this._turnState;
  }

  get lastVision(): VisionData | null {
    return this._lastVision;
  }

  get heroSessionToken(): string | null {
    return this._heroSessionToken;
  }

  get lease(): HeroLease | null {
    if (
      this._leaseExpiresAt == null ||
      this._leaseTtlMs == null ||
      this._sessionStatus == null
    ) {
      return null;
    }
    return {
      leaseExpiresAt: this._leaseExpiresAt,
      leaseTtlMs: this._leaseTtlMs,
      sessionStatus: this._sessionStatus,
    };
  }

  get sessionStatus(): HeroSessionStatus | null {
    return this._sessionStatus;
  }

  async getTurnState(): Promise<TurnState> {
    const data = await this.request<HealthResponse>(
      "/api/health",
      {
        method: "GET",
        headers: this.requestHeaders(),
      },
      "safe",
    );
    this._turnState = data.turnState;
    return data.turnState;
  }

  async register(): Promise<RegisterResponse> {
    const result = await this.post<RegisterResponse>(
      "/api/heroes/register",
      this.hero,
      {},
      false,
      "safe",
    );
    this._heroSessionToken = result.sessionToken;
    this._turnState = result.turnState;
    this._boardId = result.boardId;
    this.captureLease(result);
    return result;
  }

  async observe(): Promise<ObserveResponse> {
    const data = await this.request<ObserveResponse>(
      `/api/heroes/${this.hero.id}/observe`,
      {
        method: "GET",
        headers: this.requestHeaders({}, true),
      },
      "safe",
    );
    this._lastVision = data;
    this._boardId = data.boardId;
    this._turnState = data.turnState;
    this.captureLease(data);
    return data;
  }

  async heartbeat(): Promise<HeartbeatResponse> {
    const result = await this.post<HeartbeatResponse>(
      `/api/heroes/${this.hero.id}/heartbeat`,
      {},
      {},
      true,
      "safe",
    );
    this._boardId = result.boardId;
    this._turnState = result.turnState;
    this.captureLease(result);
    return result;
  }

  async maybeHeartbeat(
    bufferMs = DEFAULT_KEEPALIVE_BUFFER_MS,
  ): Promise<HeartbeatResponse | null> {
    if (!this.shouldHeartbeat(bufferMs)) {
      return null;
    }
    return this.heartbeat();
  }

  startLeaseKeepalive(options: LeaseKeepaliveOptions = {}): void {
    this._keepaliveOptions = {
      bufferMs: options.bufferMs ?? DEFAULT_KEEPALIVE_BUFFER_MS,
      pollIntervalMs: options.pollIntervalMs ?? DEFAULT_KEEPALIVE_POLL_MS,
      onError: options.onError ?? (() => undefined),
    };
    if (this._keepaliveTimer) {
      return;
    }
    this._keepaliveTimer = setInterval(() => {
      void this.keepaliveTick();
    }, this._keepaliveOptions.pollIntervalMs);
    this._keepaliveTimer.unref?.();
  }

  stopLeaseKeepalive(): void {
    if (this._keepaliveTimer) {
      clearInterval(this._keepaliveTimer);
      this._keepaliveTimer = null;
    }
    this._keepaliveInFlight = false;
  }

  consumeBackgroundFailure(): HeroApiError | null {
    const failure = this._backgroundFailure;
    this._backgroundFailure = null;
    return failure;
  }

  shouldHeartbeat(bufferMs = DEFAULT_KEEPALIVE_BUFFER_MS): boolean {
    return (
      this._heroSessionToken != null &&
      this._sessionStatus === "active" &&
      this._leaseExpiresAt != null &&
      Date.now() + bufferMs >= this._leaseExpiresAt
    );
  }

  async act(action: HeroAction): Promise<ActionResponse> {
    const turnKey = this.currentTurnKey();
    if (turnKey && turnKey === this._lastSubmittedTurnKey) {
      return {
        accepted: false,
        message: `client duplicate submit blocked for ${turnKey}`,
        requestId: `client-${turnKey}`,
        turnState: this._turnState ?? {
          turn: this._lastVision?.turn ?? 0,
          phase: "submit",
          started: false,
          submitWindowMs: 0,
          resolveWindowMs: 0,
          phaseEndsAt: 0,
          phaseDurationMs: 0,
          phaseElapsedMs: 0,
          seed: this._lastVision?.seed ?? "",
        },
      };
    }
    const idempotencyKey = this.actionIdempotencyKey(action, turnKey);
    const result = await this.post<ActionResponse>(
      `/api/heroes/${this.hero.id}/act`,
      action,
      {
        ...(idempotencyKey ? { "Idempotency-Key": idempotencyKey } : {}),
      },
      true,
      "idempotent",
    );
    this._turnState = result.turnState;
    this.refreshLeaseFromLocalClock();
    if (turnKey) this._lastSubmittedTurnKey = turnKey;
    return result;
  }

  async log(message: string): Promise<LogResponse> {
    const result = await this.post<LogResponse>(
      `/api/heroes/${this.hero.id}/log`,
      {
        message,
      } satisfies HeroLogRequest,
      {},
      true,
      "none",
    );
    this.refreshLeaseFromLocalClock();
    return result;
  }

  private async keepaliveTick(): Promise<void> {
    if (
      this._keepaliveInFlight ||
      !this.shouldHeartbeat(this._keepaliveOptions.bufferMs)
    ) {
      return;
    }
    this._keepaliveInFlight = true;
    try {
      await this.heartbeat();
    } catch (error) {
      const apiError = toHeroApiError(error);
      if (apiError) {
        this._backgroundFailure = apiError;
        this._keepaliveOptions.onError(apiError);
      }
    } finally {
      this._keepaliveInFlight = false;
    }
  }

  private async post<T>(
    pathname: string,
    body: unknown,
    extraHeaders: Record<string, string> = {},
    includeSessionToken = false,
    retryMode: RequestRetryMode = "none",
  ): Promise<T> {
    return this.request<T>(
      pathname,
      {
        method: "POST",
        headers: this.requestHeaders(
          { "Content-Type": "application/json", ...extraHeaders },
          includeSessionToken,
        ),
        body: JSON.stringify(body),
      },
      retryMode,
    );
  }

  private async request<T>(
    pathname: string,
    init: RequestInit,
    retryMode: RequestRetryMode,
  ): Promise<T> {
    const attempts = retryMode === "none" ? 1 : 3;
    let lastError: unknown;

    for (let attempt = 1; attempt <= attempts; attempt += 1) {
      try {
        const res = await fetch(`${this.baseUrl}${pathname}`, init);
        if (res.ok) {
          return (await res.json()) as T;
        }

        const payload = await this.readErrorPayload(res);
        const error = this.createApiError(res, payload);
        if (error.turnState) {
          this._turnState = error.turnState;
        }
        if (error.sessionExpired) {
          this._sessionStatus = "expired";
        }
        if (attempt < attempts && this.canRetry(error, retryMode)) {
          await delay(DEFAULT_RETRY_DELAY_MS * attempt);
          continue;
        }
        throw error;
      } catch (error) {
        const apiError =
          toHeroApiError(error) ?? this.createTransportError(error);
        lastError = apiError;
        if (attempt < attempts && this.canRetry(apiError, retryMode)) {
          await delay(DEFAULT_RETRY_DELAY_MS * attempt);
          continue;
        }
        throw apiError;
      }
    }

    throw (
      toHeroApiError(lastError) ??
      new HeroApiError({
        code: "unknown",
        message: "Unknown client error",
        cause: lastError,
      })
    );
  }

  private currentTurnKey(): string | null {
    const turn = this._turnState?.turn ?? this._lastVision?.turn;
    const boardId = this._boardId ?? this._lastVision?.boardId ?? null;
    if (turn == null || boardId == null) return null;
    return `${boardId}:${turn}`;
  }

  private actionIdempotencyKey(
    action: HeroAction,
    turnKey: string | null,
  ): string | undefined {
    if (!turnKey) return undefined;
    return JSON.stringify({
      turnKey,
      kind: action.kind,
      direction: action.direction ?? null,
      targetId: action.targetId ?? null,
      itemId: action.itemId ?? null,
    });
  }

  private captureLease(lease: Partial<HeroLease> | null | undefined): void {
    if (!lease) {
      return;
    }
    if (typeof lease.leaseExpiresAt === "number") {
      this._leaseExpiresAt = lease.leaseExpiresAt;
    }
    if (typeof lease.leaseTtlMs === "number") {
      this._leaseTtlMs = lease.leaseTtlMs;
    }
    if (lease.sessionStatus === "active" || lease.sessionStatus === "expired") {
      this._sessionStatus = lease.sessionStatus;
    }
  }

  private refreshLeaseFromLocalClock(): void {
    if (this._leaseTtlMs == null || this._sessionStatus === "expired") {
      return;
    }
    this._leaseExpiresAt = Date.now() + this._leaseTtlMs;
    this._sessionStatus = "active";
  }

  private async readErrorPayload(res: Response): Promise<ErrorPayload> {
    const contentType = res.headers.get("content-type") ?? "";
    if (contentType.includes("application/json")) {
      const payload = (await res.json()) as ErrorPayload;
      return payload ?? {};
    }
    const message = (await res.text()).trim();
    return message ? { message } : {};
  }

  private createApiError(res: Response, payload: ErrorPayload): HeroApiError {
    const rawCode = typeof payload.error === "string" ? payload.error : "";
    const code = this.normalizeErrorCode(rawCode, res.status);
    const message =
      payload.message?.trim() ||
      rawCode ||
      `API ${res.status} ${res.statusText}`;
    return new HeroApiError({
      code,
      message,
      status: res.status,
      requestId: payload.requestId,
      turnState: payload.turnState,
      retryable: this.isRetryableStatus(res.status),
    });
  }

  private createTransportError(error: unknown): HeroApiError {
    return new HeroApiError({
      code: "transport_error",
      message:
        error instanceof Error
          ? error.message
          : `Transport error: ${String(error)}`,
      retryable: true,
      cause: error,
    });
  }

  private normalizeErrorCode(
    rawCode: string,
    status: number,
  ): HeroApiErrorCode {
    switch (rawCode) {
      case "missing_auth":
      case "invalid_auth":
      case "missing_session":
      case "invalid_session":
      case "expired_session":
      case "wrong_phase":
      case "hero_capacity_reached":
        return rawCode;
      default:
        break;
    }

    if (status === 400) return "invalid_request";
    if (status === 404) return "not_found";
    if (status >= 500) return "server_error";
    if (status > 0) return "http_error";
    return "unknown";
  }

  private isRetryableStatus(status: number): boolean {
    return status === 408 || status === 425 || status === 429 || status >= 500;
  }

  private canRetry(error: HeroApiError, retryMode: RequestRetryMode): boolean {
    if (!error.retryable) {
      return false;
    }
    return retryMode === "safe" || retryMode === "idempotent";
  }

  private requestHeaders(
    extra: Record<string, string> = {},
    includeSessionToken = false,
  ): Record<string, string> {
    const headers = {
      ...this.headers,
      ...extra,
    };
    if (this.authToken) {
      headers.Authorization = `Bearer ${this.authToken}`;
    }
    if (includeSessionToken && this._heroSessionToken) {
      headers["X-Hero-Session-Token"] = this._heroSessionToken;
    }
    return headers;
  }
}

export type HeroContext = {
  api: HeroApi;
  profile: HeroProfile;
  turnState: TurnState;
  vision?: VisionData;
  log: (msg: string) => void;
};

export type HeroLoop = (ctx: HeroContext) => Promise<void>;

export type HeroBotRuntimeOptions = {
  signal?: AbortSignal;
  sleep?: (ms: number) => Promise<void>;
};

export function resolveBaseUrl(explicit?: string): string {
  const configured =
    explicit?.trim() || (process.env.NEURAL_NECROPOLIS_SERVER_URL ?? "").trim();
  if (configured) return configured.replace(/\/$/, "");

  const host = (
    (process.env.HOST ?? "127.0.0.1").trim() || "127.0.0.1"
  ).replace(/^0\.0\.0\.0$/, "127.0.0.1");
  const port = (process.env.PORT ?? "3000").trim() || "3000";
  return `http://${host}:${port}`;
}

export function resolveAuthToken(explicit?: string): string | undefined {
  const configured =
    explicit?.trim() ||
    (process.env.NEURAL_NECROPOLIS_PLAYER_TOKEN ?? "").trim() ||
    (process.env.NEURAL_NECROPOLIS_AUTH_TOKEN ?? "").trim();
  return configured || DEFAULT_DEV_PLAYER_AUTH_TOKEN;
}

export function resolveConnectionOptions(
  connection: string | HeroConnectionOptions = {},
): ResolvedHeroConnection {
  const options =
    typeof connection === "string" ? { baseUrl: connection } : connection;
  return {
    baseUrl: resolveBaseUrl(options.baseUrl),
    authToken: resolveAuthToken(options.authToken),
    headers: { ...(options.headers ?? {}) },
  };
}

export async function runHeroBot(
  registration: HeroRegistration,
  loop: HeroLoop,
  connection: string | HeroConnectionOptions = {},
  options: HeroBotRuntimeOptions = {},
): Promise<void> {
  const api = new HeroApi(connection, registration);
  const signal = options.signal;
  const sleep = options.sleep ?? delay;
  let profile: HeroProfile | null = null;
  let lobbyAnnounced = false;
  let lastHandledPhase = "";
  let lastQueuedBoardId = "";
  const trace = (msg: string) => {
    console.log(`[${registration.name}] [sdk pid=${process.pid}] ${msg}`);
  };
  const log = (msg: string) => {
    console.log(`[${registration.name}] ${msg}`);
    if (profile) {
      void api.log(msg).catch(() => undefined);
    }
  };

  api.startLeaseKeepalive({
    onError(error) {
      if (!error.retryable && !error.sessionExpired) {
        trace(`lease keepalive error: ${error.code}:${error.message}`);
      }
    },
  });

  try {
    const registerForNextBoard = async (initial = false): Promise<void> => {
      while (true) {
        throwIfAborted(signal);
        try {
          const nextProfile = await api.register();
          profile = null;
          lastHandledPhase = "";
          lobbyAnnounced = false;
          if (nextProfile.boardId !== lastQueuedBoardId) {
            lastQueuedBoardId = nextProfile.boardId;
            log(
              initial
                ? `entered queue on ${nextProfile.boardId} at (${nextProfile.position.x},${nextProfile.position.y}) — HP ${nextProfile.stats.hp} ATK ${nextProfile.stats.attack} DEF ${nextProfile.stats.defense} SPD ${nextProfile.stats.speed} PER ${nextProfile.stats.perception} [${nextProfile.trait}]`
                : `queued for ${nextProfile.boardId} at (${nextProfile.position.x},${nextProfile.position.y})`,
            );
          }
          return;
        } catch (err) {
          throwIfAborted(signal);
          const apiError = toHeroApiError(err);
          const msg =
            apiError?.message ??
            (err instanceof Error ? err.message : String(err));
          if (apiError?.code === "hero_capacity_reached") {
            log("waiting for an open room in the queue...");
            await sleep(500);
            continue;
          }
          if (apiError?.retryable) {
            trace(
              `register retry after transient error: ${apiError.code}:${apiError.message}`,
            );
            await sleep(1_000);
            continue;
          }
          log(initial ? "waiting for server..." : `requeue blocked: ${msg}`);
          await sleep(2_000);
        }
      }
    };

    await registerForNextBoard(true);

    while (true) {
      throwIfAborted(signal);
      try {
        const backgroundFailure = api.consumeBackgroundFailure();
        if (backgroundFailure?.sessionExpired) {
          log("session expired. rejoining an open board...");
          await registerForNextBoard(false);
          await sleep(200);
          continue;
        }

        const vision = await api.observe();
        profile = vision.hero;
        const turnState =
          vision.turnState ?? api.turnState ?? (await api.getTurnState());

        if (
          vision.boardStatus === "completed" ||
          vision.hero.status !== "alive"
        ) {
          await registerForNextBoard(false);
          await sleep(200);
          continue;
        }

        if (!turnState.started) {
          if (!lobbyAnnounced) {
            log("waiting for board start...");
            lobbyAnnounced = true;
          }
          await api.maybeHeartbeat();
          lastHandledPhase = "";
          await sleep(500);
          continue;
        }
        lobbyAnnounced = false;
        const phaseKey = `${turnState.turn}:${turnState.phase}:${vision.boardId ?? lastQueuedBoardId}`;
        if (phaseKey !== lastHandledPhase) {
          lastHandledPhase = phaseKey;
          trace(`dispatch loop for ${phaseKey}`);
          if (turnState.phase === "resolve") {
            await sleep(50);
          }
          await loop({ api, profile, turnState, vision, log });
          throwIfAborted(signal);
        }
      } catch (err) {
        throwIfAborted(signal);
        const apiError = toHeroApiError(err);
        const msg =
          apiError?.message ??
          (err instanceof Error ? err.message : String(err));
        if (apiError?.code === "wrong_phase") {
          await sleep(150);
          continue;
        }
        if (
          apiError?.sessionExpired ||
          apiError?.code === "invalid_session" ||
          apiError?.code === "missing_session"
        ) {
          log("session lost. rejoining an open board...");
          await registerForNextBoard(false);
          await sleep(200);
          continue;
        }
        if (apiError?.retryable) {
          trace(`transient client error: ${apiError.code}:${apiError.message}`);
          await sleep(500);
          continue;
        }
        log(`error: ${msg}`);
      }
      await sleep(200);
    }
  } finally {
    api.stopLeaseKeepalive();
  }
}

function toHeroApiError(error: unknown): HeroApiError | null {
  return error instanceof HeroApiError ? error : null;
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function throwIfAborted(signal?: AbortSignal): void {
  if (!signal?.aborted) {
    return;
  }
  throw abortSignalError(signal);
}

function abortSignalError(signal: AbortSignal): Error {
  if (signal.reason instanceof Error) {
    return signal.reason;
  }
  if (typeof signal.reason === "string" && signal.reason.trim()) {
    return new Error(signal.reason);
  }
  return new Error("Aborted");
}
