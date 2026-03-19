import type {
  HeroAction,
  HeroProfile,
  HeroRegistration,
  TurnState,
  VisionData,
} from "../types.js";

type RegistrationResult = HeroProfile & {
  boardId: string;
  turnState?: TurnState;
};

type ActionResult = {
  accepted: boolean;
  message: string;
  turnState?: TurnState;
};

export class HeroApi {
  private _turnState: TurnState | null = null;
  private _lastVision: VisionData | null = null;
  private _boardId: string | null = null;
  private _lastSubmittedTurnKey: string | null = null;

  constructor(
    private readonly baseUrl: string,
    private readonly hero: HeroRegistration,
  ) {}

  get turnState(): TurnState | null {
    return this._turnState;
  }

  get lastVision(): VisionData | null {
    return this._lastVision;
  }

  async getTurnState(): Promise<TurnState> {
    const res = await fetch(`${this.baseUrl}/api/health`);
    if (!res.ok) throw new Error(`health check failed: ${res.status}`);
    const data = (await res.json()) as { turnState: TurnState };
    this._turnState = data.turnState;
    return data.turnState;
  }

  async register(): Promise<RegistrationResult> {
    const result = await this.post<RegistrationResult>(
      "/api/heroes/register",
      this.hero,
    );
    if (result.turnState) this._turnState = result.turnState;
    this._boardId = result.boardId;
    return result;
  }

  async observe(): Promise<VisionData> {
    const res = await fetch(
      `${this.baseUrl}/api/heroes/${this.hero.id}/observe`,
    );
    if (!res.ok) throw new Error(`observe failed: ${res.status}`);
    const data = (await res.json()) as VisionData;
    this._lastVision = data;
    this._boardId = data.boardId ?? this._boardId;
    if (data.turnState) this._turnState = data.turnState;
    return data;
  }

  async act(action: HeroAction): Promise<ActionResult> {
    const turnKey = this.currentTurnKey();
    if (turnKey && turnKey === this._lastSubmittedTurnKey) {
      return {
        accepted: false,
        message: `client duplicate submit blocked for ${turnKey}`,
        turnState: this._turnState ?? undefined,
      };
    }
    const result = await this.post<ActionResult>(
      `/api/heroes/${this.hero.id}/act`,
      action,
    );
    if (result.turnState) this._turnState = result.turnState;
    if (turnKey) this._lastSubmittedTurnKey = turnKey;
    return result;
  }

  async log(message: string): Promise<void> {
    await this.post<{ ok: boolean }>(`/api/heroes/${this.hero.id}/log`, {
      message,
    });
  }

  private async post<T>(pathname: string, body: unknown): Promise<T> {
    const res = await fetch(`${this.baseUrl}${pathname}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      if (res.status === 409) {
        const payload = (await res.json()) as {
          error?: string;
          turnState?: TurnState;
          message?: string;
        };
        if (payload.turnState) this._turnState = payload.turnState;
        const errorCode = payload.error ?? "unknown";
        throw new Error(`${errorCode}:${payload.message ?? res.statusText}`);
      }
      throw new Error(`API ${res.status} ${res.statusText}`);
    }
    return res.json() as Promise<T>;
  }

  private currentTurnKey(): string | null {
    const turn = this._turnState?.turn ?? this._lastVision?.turn;
    const boardId = this._boardId ?? this._lastVision?.boardId ?? null;
    if (turn == null || boardId == null) return null;
    return `${boardId}:${turn}`;
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

function resolveBaseUrl(): string {
  const port = (process.env.PORT ?? "3000").trim();
  const configured = (process.env.MMORPH_SERVER_URL ?? "").trim();
  if (!configured) return `http://127.0.0.1:${port}`;
  try {
    const parsed = new URL(configured);
    const host = parsed.hostname.toLowerCase();
    const localHost = host === "127.0.0.1" || host === "localhost";
    if (localHost && process.env.PORT) {
      parsed.port = port;
      return parsed.toString().replace(/\/$/, "");
    }
  } catch {
    return configured;
  }
  return configured;
}

export async function runHeroBot(
  registration: HeroRegistration,
  loop: HeroLoop,
  baseUrl = resolveBaseUrl(),
): Promise<void> {
  const api = new HeroApi(baseUrl, registration);
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

  const registerForNextBoard = async (initial = false): Promise<void> => {
    while (true) {
      try {
        const nextProfile = await api.register();
        profile = nextProfile;
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
        const msg = err instanceof Error ? err.message : String(err);
        if (msg.includes("hero_capacity_reached")) {
          log("waiting for an open room in the queue...");
          await new Promise((r) => setTimeout(r, 500));
          continue;
        }
        log(initial ? "waiting for server..." : `requeue blocked: ${msg}`);
        await new Promise((r) => setTimeout(r, 2_000));
      }
    }
  };

  await registerForNextBoard(true);

  while (true) {
    try {
      const vision = await api.observe();
      profile = vision.hero;
      const turnState =
        vision.turnState ?? api.turnState ?? (await api.getTurnState());

      if (
        vision.boardStatus === "completed" ||
        vision.hero.status !== "alive"
      ) {
        await registerForNextBoard(false);
        await new Promise((r) => setTimeout(r, 200));
        continue;
      }

      if (!turnState.started) {
        if (!lobbyAnnounced) {
          log("waiting for board start...");
          lobbyAnnounced = true;
        }
        lastHandledPhase = "";
        await new Promise((r) => setTimeout(r, 500));
        continue;
      }
      lobbyAnnounced = false;
      const phaseKey = `${turnState.turn}:${turnState.phase}:${vision.boardId ?? lastQueuedBoardId}`;
      if (phaseKey !== lastHandledPhase) {
        lastHandledPhase = phaseKey;
        trace(`dispatch loop for ${phaseKey}`);
        if (turnState.phase === "resolve") {
          await new Promise((r) => setTimeout(r, 50));
        }
        await loop({ api, profile, turnState, vision, log });
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.startsWith("wrong_phase:")) {
        await new Promise((r) => setTimeout(r, 150));
        continue;
      }
      log(`error: ${msg}`);
    }
    await new Promise((r) => setTimeout(r, 200));
  }
}
