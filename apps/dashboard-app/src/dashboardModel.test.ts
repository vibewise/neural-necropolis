import { describe, expect, it } from "vitest";

import {
  buildLauncherState,
  buildControlNotice,
  buildFeedItems,
  buildHeaderStatus,
  shouldApplyStreamSnapshot,
} from "./dashboardModel";

describe("dashboardModel", () => {
  it("applies active-board stream snapshots when no board is pinned", () => {
    expect(
      shouldApplyStreamSnapshot(null, {
        boardId: "board-a",
      } as never),
    ).toBe(true);
  });

  it("ignores stream snapshots for a different pinned board", () => {
    expect(
      shouldApplyStreamSnapshot("board-b", {
        boardId: "board-a",
      } as never),
    ).toBe(false);
  });

  it("combines stream, event, and bot feed items in descending order", () => {
    const items = buildFeedItems(
      {
        recentEvents: [
          {
            id: "event-1",
            turn: 3,
            type: "system",
            summary: "Board running.",
          },
        ],
        botMessages: [
          {
            id: "bot-1",
            heroId: "hero-1",
            heroName: "Scout",
            turn: 4,
            createdAt: 200,
            message: "Moving east.",
          },
        ],
      } as never,
      [
        {
          id: "stream-1",
          message:
            "[arena:arena-12345678][match:match-87654321][duel:0] Turn 4 submissions locked.",
          createdAt: 300,
          boardId: null,
          arenaId: "arena-12345678",
          matchId: "match-87654321",
          duelIndex: 0,
        },
      ],
    );

    expect(items).toHaveLength(3);
    expect(items[0]?.label).toBe(
      "Stream · Arena arena-12 · Match match-87 · Duel 1",
    );
    expect(items[0]?.detail).toContain("submissions locked");
    expect(items[1]?.detail).toContain("Moving east");
    expect(items[2]?.detail).toContain("Board running");
  });

  it("builds a ready header status from the lobby snapshot", () => {
    const status = buildHeaderStatus({
      lobby: {
        status: "waiting",
        attachedHeroes: 3,
        requiredHeroes: 3,
        maxHeroes: 3,
        canStart: true,
      },
    } as never);

    expect(status.label).toBe("Board ready");
    expect(status.tone).toBe("ready");
    expect(status.attached).toBe("3/3");
  });

  it("describes paused staged boards in the control notice", () => {
    const notice = buildControlNotice({
      gameSettings: { paused: true },
      lobby: {
        status: "waiting",
        attachedHeroes: 2,
        requiredHeroes: 3,
        joinWindowRemainingMs: 8_000,
        canStart: false,
      },
    } as never);

    expect(notice).toContain("Turns are OFF");
    expect(notice).toContain("2/3 heroes");
  });

  it("builds launcher guidance for a server with no heroes attached", () => {
    const launcher = buildLauncherState({
      boards: [{ boardId: "b1", boardName: "Vault", status: "open" }] as never,
      serverReachable: true,
      snapshot: {
        world: { dungeonName: "Vault" },
        lobby: { attachedHeroes: 0 },
        gameSettings: { paused: true },
      } as never,
    });

    expect(launcher.headline).toBe("Attach your first hero");
    expect(launcher.nextAction).toContain("Run a local demo");
    expect(
      launcher.checklist.find((item) => item.label === "Server")?.state,
    ).toBe("ready");
  });
});
