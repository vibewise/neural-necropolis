import { useMemo } from "react";
import type {
  HeroProfile,
  DashboardResponse,
} from "@neural-necropolis/protocol-ts";

type HeroDetailPanelProps = {
  hero: HeroProfile;
  snapshot: DashboardResponse;
};

export function HeroDetailPanel({ hero, snapshot }: HeroDetailPanelProps) {
  const alive = hero.status === "alive";
  const gear = [
    hero.equipment.weapon,
    hero.equipment.armor,
    hero.equipment.accessory,
  ].filter(Boolean);

  const heroEvents = useMemo(
    () =>
      (snapshot.recentEvents ?? [])
        .filter((e) =>
          e.summary.toLowerCase().includes(hero.name.toLowerCase()),
        )
        .slice(0, 6),
    [snapshot.recentEvents, hero.name],
  );

  const heroMessages = useMemo(
    () =>
      (snapshot.botMessages ?? [])
        .filter((m) => m.heroId === hero.id)
        .sort((a, b) => b.turn - a.turn)
        .slice(0, 5),
    [snapshot.botMessages, hero.id],
  );

  return (
    <div className="hero-detail-grid">
      <div className="card">
        <h2>
          {hero.name.toUpperCase()}
          {!alive && " \u00b7 INACTIVE"}
        </h2>
        <div className="hero-lines">
          <div>
            <span className="trait-pill">{hero.trait}</span>
          </div>
          <div>
            Position: ({hero.position.x}, {hero.position.y})
          </div>
          <div>
            HP {hero.stats.hp}/{hero.stats.maxHp} | ATK {hero.stats.attack} DEF{" "}
            {hero.stats.defense} SPD {hero.stats.speed} PER{" "}
            {hero.stats.perception}
          </div>
          <div>
            Score {hero.score} | Gold {hero.gold} | Kills {hero.kills} |
            Explored {hero.tilesExplored}
          </div>
          <div>
            Fatigue {hero.fatigue} | Morale {hero.morale} | Status{" "}
            {alive ? hero.status : "inactive"}
          </div>
          <div>Last action: {alive ? hero.lastAction : "session expired"}</div>
          <div className="hero-strategy">{hero.strategy}</div>
        </div>
      </div>

      <div className="card">
        <h2>Loadout</h2>
        <div className="hero-lines">
          <div>
            <div className="small-label">Gear</div>
            {gear.length > 0 ? (
              gear.map((g) => (
                <span key={g!.id} className="pill">
                  {g!.name}
                </span>
              ))
            ) : (
              <span className="small">No gear</span>
            )}
          </div>
          <div>
            <div className="small-label">Effects</div>
            {hero.effects.length > 0 ? (
              hero.effects.map((e) => (
                <span key={`${e.kind}-${e.turnsRemaining}`} className="pill">
                  {e.kind} ({e.turnsRemaining}t)
                </span>
              ))
            ) : (
              <span className="small">No effects</span>
            )}
          </div>
          <div>
            <div className="small-label">Inventory</div>
            {hero.inventory.length > 0 ? (
              hero.inventory.map((i) => (
                <span key={i.id} className="pill">
                  {i.name}
                </span>
              ))
            ) : (
              <span className="small">Inventory empty</span>
            )}
          </div>
        </div>
      </div>

      {/* Decision Trace: bot messages & recent events for this hero */}
      <div className="card span-two">
        <h2>Decision Trace</h2>
        <div className="hero-lines">
          {heroMessages.length > 0 ? (
            heroMessages.map((m) => (
              <div key={m.id} className="trace-entry">
                <span className="trace-turn">T{m.turn}</span>
                <span className="trace-message">{m.message}</span>
              </div>
            ))
          ) : (
            <span className="small">No bot messages for this hero yet.</span>
          )}
          {heroEvents.length > 0 && (
            <>
              <div className="small-label" style={{ marginTop: 8 }}>
                Recent Events
              </div>
              {heroEvents.map((e) => (
                <div key={e.id} className="trace-entry">
                  <span className="trace-turn">T{e.turn}</span>
                  <span className="trace-type">{e.type}</span>
                  <span className="trace-message">{e.summary}</span>
                </div>
              ))}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
