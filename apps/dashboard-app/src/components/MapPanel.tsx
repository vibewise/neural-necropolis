import { useCallback, useEffect, useRef, useState } from "react";
import {
  Application,
  Container,
  Graphics,
  Sprite,
  Texture,
  settings,
  SCALE_MODES,
} from "pixi.js";
import type {
  DashboardResponse,
  HeroProfile,
  Monster,
  MonsterKind,
  Npc,
  NpcKind,
  TileKind,
} from "@neural-necropolis/protocol-ts";

const TILE = 32;

const HERO_COLORS_HEX = [
  "#5599ff",
  "#55ff99",
  "#ffaa55",
  "#ff55aa",
  "#55aaff",
  "#a8ff7f",
];
const HERO_COLORS_NUM = [
  0x5599ff, 0x55ff99, 0xffaa55, 0xff55aa, 0x55aaff, 0xa8ff7f,
];

const MONSTER_COLORS: Record<string, number> = {
  goblin: 0xff5555,
  spider: 0x88ff44,
  skeleton: 0xcccccc,
  wraith: 0x9966ff,
  orc: 0xff8833,
  mimic: 0xffcc00,
  dragon: 0xff2222,
};

const TILE_DESCRIPTIONS: Partial<Record<TileKind, string>> = {
  door_closed: "Closed door",
  door_locked: "Locked door",
  door_open: "Open door",
  trap_hidden: "Hidden trap",
  trap_visible: "Visible trap",
  trap_triggered: "Triggered trap",
  chest: "Chest",
  chest_locked: "Locked chest",
  chest_open: "Opened chest",
  treasure: "Treasure cache",
  potion: "Potion tile",
  exit: "Exit portal",
  shrine: "Shrine tile",
  merchant: "Merchant tile",
  shallow_water: "Shallow water",
  lava: "Lava",
};

/* ── Texture helpers ── */

function hexNum(hex: string): number {
  return parseInt(hex.replace("#", ""), 16);
}

function starPoints(
  cx: number,
  cy: number,
  points: number,
  outerR: number,
  innerR: number,
): number[] {
  const pts: number[] = [];
  const step = Math.PI / points;
  let angle = -Math.PI / 2;
  for (let i = 0; i < points * 2; i++) {
    const r = i % 2 === 0 ? outerR : innerR;
    pts.push(cx + Math.cos(angle) * r, cy + Math.sin(angle) * r);
    angle += step;
  }
  return pts;
}

function gfxTex(app: Application, drawFn: (g: Graphics) => void): Texture {
  const g = new Graphics();
  drawFn(g);
  const tex = app.renderer.generateTexture(g);
  g.destroy();
  return tex;
}

/* ── Tile texture builders ── */

function buildTileTextures(app: Application): Record<string, Texture> {
  const T = TILE;
  const types: Record<string, (g: Graphics) => void> = {
    floor(g) {
      g.beginFill(0x2d2d3d);
      g.drawRect(0, 0, T, T);
      g.endFill();
      g.beginFill(0x39424f, 0.35);
      g.drawRect(6, 6, 2, 2);
      g.drawRect(22, 16, 2, 2);
      g.drawRect(14, 26, 2, 2);
      g.endFill();
      g.beginFill(0x333348, 0.2);
      g.drawRect(18, 4, 2, 2);
      g.drawRect(4, 20, 2, 2);
      g.drawRect(26, 24, 2, 2);
      g.endFill();
    },
    wall(g) {
      g.beginFill(0x0f1113);
      g.drawRect(0, 0, T, T);
      g.endFill();
      g.beginFill(0x1a1a2a);
      g.drawRect(2, 2, T - 4, T - 4);
      g.endFill();
      g.beginFill(0x3a3a3a, 0.3);
      g.drawRect(4, 4, T - 8, T - 8);
      g.endFill();
      g.beginFill(0x252535, 0.4);
      g.drawRect(6, 6, T - 12, 2);
      g.drawRect(6, T - 8, T - 12, 2);
      g.endFill();
    },
    door_closed(g) {
      g.beginFill(0x2d2d3d);
      g.drawRect(0, 0, T, T);
      g.endFill();
      g.lineStyle(2, 0x8b6914, 0.6);
      g.drawRect(2, 2, T - 4, T - 4);
      g.lineStyle(0);
      g.beginFill(0x8b6914);
      g.drawRect(6, 4, T - 12, T - 8);
      g.endFill();
      g.beginFill(0x6b5010, 0.5);
      g.drawRect(6, T / 2, T - 12, 2);
      g.endFill();
      g.beginFill(0xffd700);
      g.drawCircle(T - 10, T / 2, 3);
      g.endFill();
    },
    door_locked(g) {
      g.beginFill(0x2d2d3d);
      g.drawRect(0, 0, T, T);
      g.endFill();
      g.beginFill(0x8b4513);
      g.drawRect(6, 4, T - 12, T - 8);
      g.endFill();
      g.lineStyle(2, 0xff4444, 0.8);
      g.drawRect(6, 4, T - 12, T - 8);
      g.lineStyle(0);
      g.beginFill(0x6b3010, 0.5);
      g.drawRect(6, T / 2, T - 12, 2);
      g.endFill();
      g.beginFill(0xff4444);
      g.drawCircle(T - 10, T / 2, 3);
      g.endFill();
    },
    door_open(g) {
      g.beginFill(0x2d2d3d);
      g.drawRect(0, 0, T, T);
      g.endFill();
      g.beginFill(0x6b5a14, 0.5);
      g.drawRect(4, 6, 6, T - 12);
      g.endFill();
    },
    trap_hidden(g) {
      g.beginFill(0x2d2d3d);
      g.drawRect(0, 0, T, T);
      g.endFill();
      g.beginFill(0x39424f, 0.35);
      g.drawRect(6, 6, 2, 2);
      g.drawRect(22, 16, 2, 2);
      g.drawRect(14, 26, 2, 2);
      g.endFill();
    },
    trap_visible(g) {
      g.beginFill(0x2d2d3d);
      g.drawRect(0, 0, T, T);
      g.endFill();
      g.lineStyle(2, 0xff6600, 0.7);
      g.drawRect(4, 4, T - 8, T - 8);
      g.lineStyle(0);
      g.beginFill(0xff6600, 0.6);
      g.drawPolygon([T / 2, 8, T - 8, T - 8, 8, T - 8]);
      g.endFill();
    },
    trap_triggered(g) {
      g.beginFill(0x663300);
      g.drawRect(0, 0, T, T);
      g.endFill();
      g.beginFill(0x993300, 0.8);
      g.drawRect(4, 4, T - 8, T - 8);
      g.endFill();
    },
    chest(g) {
      g.beginFill(0x2d2d3d);
      g.drawRect(0, 0, T, T);
      g.endFill();
      g.beginFill(0xb8860b);
      g.drawRoundedRect(4, 8, T - 8, T - 12, 4);
      g.endFill();
      g.beginFill(0x916b08, 0.6);
      g.drawRect(4, T / 2, T - 8, 2);
      g.endFill();
      g.beginFill(0xffd700);
      g.drawRect(T / 2 - 3, 10, 6, 4);
      g.endFill();
    },
    chest_locked(g) {
      g.beginFill(0x2d2d3d);
      g.drawRect(0, 0, T, T);
      g.endFill();
      g.beginFill(0xdaa520);
      g.drawRoundedRect(4, 8, T - 8, T - 12, 4);
      g.endFill();
      g.beginFill(0xb08818, 0.6);
      g.drawRect(4, T / 2, T - 8, 2);
      g.endFill();
      g.beginFill(0xff4444);
      g.drawRect(T / 2 - 3, 10, 6, 4);
      g.endFill();
    },
    chest_open(g) {
      g.beginFill(0x2d2d3d);
      g.drawRect(0, 0, T, T);
      g.endFill();
      g.beginFill(0x444444);
      g.drawRoundedRect(4, 12, T - 8, T - 16, 4);
      g.endFill();
      g.beginFill(0x555555, 0.5);
      g.drawRect(6, 6, T - 12, 6);
      g.endFill();
    },
    treasure(g) {
      g.beginFill(0x2d2d3d);
      g.drawRect(0, 0, T, T);
      g.endFill();
      g.beginFill(0xffd700);
      g.drawPolygon(starPoints(T / 2, T / 2, 5, 12, 6));
      g.endFill();
      g.beginFill(0xffee88, 0.4);
      g.drawCircle(T / 2, T / 2, 4);
      g.endFill();
    },
    potion(g) {
      g.beginFill(0x2d2d3d);
      g.drawRect(0, 0, T, T);
      g.endFill();
      g.beginFill(0x44ff88);
      g.drawRoundedRect(8, 12, T - 16, T - 16, 6);
      g.endFill();
      g.beginFill(0x44ff88, 0.7);
      g.drawRect(T / 2 - 3, 6, 6, 8);
      g.endFill();
      g.beginFill(0x88ffbb, 0.3);
      g.drawCircle(T / 2, T / 2 + 2, 4);
      g.endFill();
    },
    exit(g) {
      g.beginFill(0x0a1020);
      g.drawRect(0, 0, T, T);
      g.endFill();
      g.lineStyle(2, 0x00ffff, 0.8);
      g.drawCircle(T / 2, T / 2, T / 2 - 4);
      g.lineStyle(1, 0x00ffff, 0.4);
      g.drawCircle(T / 2, T / 2, T / 2 - 8);
      g.lineStyle(0);
      g.beginFill(0x00ffff, 0.5);
      g.drawCircle(T / 2, T / 2, 6);
      g.endFill();
    },
    shrine(g) {
      g.beginFill(0x2d2d3d);
      g.drawRect(0, 0, T, T);
      g.endFill();
      g.beginFill(0xbb77ff);
      g.drawPolygon([T / 2, 4, T - 6, T - 4, 6, T - 4]);
      g.endFill();
      g.beginFill(0xeeddff, 0.6);
      g.drawCircle(T / 2, T / 2, 4);
      g.endFill();
    },
    merchant(g) {
      g.beginFill(0x2d2d3d);
      g.drawRect(0, 0, T, T);
      g.endFill();
      g.beginFill(0x5599ff);
      g.drawRoundedRect(6, 6, T - 12, T - 12, 6);
      g.endFill();
      g.beginFill(0xffd700, 0.8);
      g.drawCircle(T / 2, T / 2, 4);
      g.endFill();
    },
    shallow_water(g) {
      g.beginFill(0x234488);
      g.drawRect(0, 0, T, T);
      g.endFill();
      g.beginFill(0x3366aa, 0.4);
      g.drawRect(4, 10, T - 8, 4);
      g.drawRect(8, 20, T - 16, 4);
      g.endFill();
      g.beginFill(0x2a5599, 0.25);
      g.drawRect(6, 4, T - 12, 3);
      g.endFill();
    },
    lava(g) {
      g.beginFill(0xcc2200);
      g.drawRect(0, 0, T, T);
      g.endFill();
      g.beginFill(0xff6600, 0.5);
      g.drawRect(4, 6, 8, 6);
      g.drawRect(16, 16, 10, 6);
      g.endFill();
      g.beginFill(0xffcc00, 0.3);
      g.drawRect(10, 12, 6, 4);
      g.drawRect(6, 22, 8, 4);
      g.endFill();
    },
  };
  const textures: Record<string, Texture> = {};
  for (const [k, fn] of Object.entries(types)) {
    textures[k] = gfxTex(app, fn);
  }
  return textures;
}

/* ── Entity texture helpers — cached per app lifetime ── */

type TexCaches = {
  tile: Record<string, Texture>;
  hero: Record<string, Texture>;
  monster: Record<string, Texture>;
  npc: Record<string, Texture>;
  floorItem: Record<string, Texture>;
  dead: Texture | null;
};

function getHeroTex(
  app: Application,
  caches: TexCaches,
  color: number,
): Texture {
  const k = `hero|${color}`;
  if (caches.hero[k]) return caches.hero[k];
  caches.hero[k] = gfxTex(app, (g) => {
    g.beginFill(color);
    g.drawCircle(TILE / 2, TILE / 2, TILE / 2 - 4);
    g.endFill();
    g.beginFill(0xffffff, 0.6);
    g.drawCircle(TILE / 2 - 2, TILE / 2 - 4, 3);
    g.endFill();
  });
  return caches.hero[k];
}

function getDeadTex(app: Application, caches: TexCaches): Texture {
  if (caches.dead) return caches.dead;
  caches.dead = gfxTex(app, (g) => {
    g.lineStyle(3, 0xff6a7a, 0.9);
    g.moveTo(6, 6);
    g.lineTo(TILE - 6, TILE - 6);
    g.moveTo(TILE - 6, 6);
    g.lineTo(6, TILE - 6);
  });
  return caches.dead;
}

function getMonsterTex(
  app: Application,
  caches: TexCaches,
  kind: MonsterKind,
): Texture {
  if (caches.monster[kind]) return caches.monster[kind];
  const c = MONSTER_COLORS[kind] ?? 0xff5555;
  caches.monster[kind] = gfxTex(app, (g) => {
    g.beginFill(c);
    g.drawPolygon([TILE / 2, 4, TILE - 4, TILE - 4, 4, TILE - 4]);
    g.endFill();
    g.beginFill(0x000000, 0.4);
    g.drawCircle(TILE / 2 - 4, TILE / 2, 2.5);
    g.drawCircle(TILE / 2 + 4, TILE / 2, 2.5);
    g.endFill();
  });
  return caches.monster[kind];
}

function getNpcTex(
  app: Application,
  caches: TexCaches,
  kind: NpcKind,
): Texture {
  if (caches.npc[kind]) return caches.npc[kind];
  if (kind === "shrine") {
    caches.npc[kind] = gfxTex(app, (g) => {
      g.beginFill(0xbb77ff);
      g.drawPolygon([TILE / 2, 2, TILE - 4, TILE - 2, 4, TILE - 2]);
      g.endFill();
      g.beginFill(0xeeddff, 0.7);
      g.drawCircle(TILE / 2, TILE / 2 + 2, 5);
      g.endFill();
    });
  } else if (kind === "merchant") {
    caches.npc[kind] = gfxTex(app, (g) => {
      g.beginFill(0x5599ff);
      g.drawRoundedRect(4, 4, TILE - 8, TILE - 8, 6);
      g.endFill();
      g.beginFill(0xffd700, 0.8);
      g.drawCircle(TILE / 2, TILE / 2, 5);
      g.endFill();
    });
  } else {
    caches.npc[kind] = gfxTex(app, (g) => {
      g.beginFill(0xffcc55);
      g.drawCircle(TILE / 2, TILE / 2, TILE / 2 - 2);
      g.endFill();
    });
  }
  return caches.npc[kind];
}

function getFloorItemTex(
  app: Application,
  caches: TexCaches,
  kind: string,
): Texture {
  if (caches.floorItem[kind]) return caches.floorItem[kind];
  if (kind === "treasure" && caches.tile.chest) {
    caches.floorItem[kind] = caches.tile.chest;
  } else if (kind === "potion" && caches.tile.potion) {
    caches.floorItem[kind] = caches.tile.potion;
  } else {
    caches.floorItem[kind] = gfxTex(app, (g) => {
      g.beginFill(0xdaa520);
      g.drawRoundedRect(6, 6, TILE - 12, TILE - 12, 4);
      g.endFill();
    });
  }
  return caches.floorItem[kind];
}

/* ── Tooltip builder ── */

function buildTooltip(
  snap: DashboardResponse,
  mapX: number,
  mapY: number,
): string {
  const height = snap.map.length;
  const width = snap.map[0]?.length ?? 0;
  if (mapY < 0 || mapY >= height || mapX < 0 || mapX >= width) return "";

  const parts: string[] = [];
  const tileKind = snap.map[mapY]?.[mapX];
  if (tileKind && tileKind !== "floor" && tileKind !== "wall") {
    const desc = TILE_DESCRIPTIONS[tileKind] ?? tileKind.replaceAll("_", " ");
    parts.push(
      `<span class="tt-name">${desc}</span>\n<span class="tt-sub">tile at (${mapX}, ${mapY})</span>`,
    );
  }

  for (const hero of snap.heroes) {
    if (hero.position.x !== mapX || hero.position.y !== mapY) continue;
    const alive = hero.status === "alive";
    parts.push(
      `<span class="tt-name">${alive ? "\u2694\ufe0f " : "\u2620\ufe0f "}${hero.name}</span>\n` +
        `HP ${hero.stats.hp}/${hero.stats.maxHp} \u00b7 ${hero.score} pts\n` +
        `<span class="tt-sub">${hero.trait}</span>\n` +
        `<span class="tt-sub">${hero.strategy ?? ""}</span>`,
    );
  }

  for (const m of snap.monsters) {
    if (m.position.x !== mapX || m.position.y !== mapY) continue;
    parts.push(
      `<span class="tt-name">\ud83d\udc79 ${m.name || m.kind}</span>\n` +
        `HP ${m.hp}/${m.maxHp} \u00b7 ATK ${m.attack} \u00b7 DEF ${m.defense}\n` +
        `<span class="tt-sub">${m.kind} \u00b7 ${m.id}</span>`,
    );
  }

  for (const npc of snap.npcs) {
    if (npc.position.x !== mapX || npc.position.y !== mapY) continue;
    parts.push(
      `<span class="tt-name">${npc.name || npc.kind}</span>\n` +
        `<span class="tt-sub">${npc.kind} at (${mapX}, ${mapY})</span>`,
    );
  }

  for (const fi of snap.floorItems) {
    if (fi.position.x !== mapX || fi.position.y !== mapY) continue;
    parts.push(
      `<span class="tt-name">${fi.item.name}</span>\n` +
        `<span class="tt-sub">${fi.item.kind} \u00b7 val ${fi.item.value}</span>`,
    );
  }

  return parts.join('<hr style="border-color:#2c3854;margin:4px 0">');
}

/* ── Main component ── */

type MapPanelProps = { snapshot: DashboardResponse };

export function MapPanel({ snapshot }: MapPanelProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const appRef = useRef<Application | null>(null);
  const worldRef = useRef<Container | null>(null);
  const tilesRef = useRef<Container | null>(null);
  const entitiesRef = useRef<Container | null>(null);
  const cachesRef = useRef<TexCaches | null>(null);
  const cameraRef = useRef({ x: 0, y: 0, zoom: 1 });
  const hasSetCameraRef = useRef(false);
  const mouseRef = useRef({ x: -1, y: -1 });
  const dragRef = useRef({
    active: false,
    startX: 0,
    startY: 0,
  });
  const snapRef = useRef(snapshot);
  snapRef.current = snapshot;

  const tooltipRef = useRef<HTMLDivElement | null>(null);
  const [tooltipHtml, setTooltipHtml] = useState("");
  const [tooltipPos, setTooltipPos] = useState({ x: 0, y: 0 });
  const [tooltipVisible, setTooltipVisible] = useState(false);

  const applyCam = useCallback(() => {
    const world = worldRef.current;
    if (!world) return;
    const cam = cameraRef.current;
    world.position.set(cam.x, cam.y);
    world.scale.set(cam.zoom);
  }, []);

  /* ── Init PixiJS ── */
  useEffect(() => {
    if (!containerRef.current || appRef.current) return;

    settings.SCALE_MODE = SCALE_MODES.NEAREST;

    const wrap = containerRef.current;
    const w = wrap.clientWidth || 800;
    const h = wrap.clientHeight || 600;

    const app = new Application({
      width: w,
      height: h,
      backgroundColor: 0x090c14,
      antialias: false,
      resolution: window.devicePixelRatio || 1,
      autoDensity: true,
    });

    const canvas = app.view as HTMLCanvasElement;
    canvas.style.width = `${w}px`;
    canvas.style.height = `${h}px`;
    canvas.style.cursor = "grab";
    canvas.style.imageRendering = "pixelated";

    const world = new Container();
    const tileLayer = new Container();
    const entityLayer = new Container();
    world.addChild(tileLayer);
    world.addChild(entityLayer);
    app.stage.addChild(world);
    wrap.appendChild(canvas);

    appRef.current = app;
    worldRef.current = world;
    tilesRef.current = tileLayer;
    entitiesRef.current = entityLayer;

    const caches: TexCaches = {
      tile: buildTileTextures(app),
      hero: {},
      monster: {},
      npc: {},
      floorItem: {},
      dead: null,
    };
    cachesRef.current = caches;

    /* ── Drag-to-pan ── */
    const onMouseDown = (e: MouseEvent) => {
      dragRef.current = {
        active: true,
        startX: e.clientX - cameraRef.current.x,
        startY: e.clientY - cameraRef.current.y,
      };
      canvas.style.cursor = "grabbing";
    };

    const onMouseMove = (e: MouseEvent) => {
      const rect = canvas.getBoundingClientRect();
      mouseRef.current = { x: e.clientX - rect.left, y: e.clientY - rect.top };

      if (dragRef.current.active) {
        cameraRef.current.x = e.clientX - dragRef.current.startX;
        cameraRef.current.y = e.clientY - dragRef.current.startY;
        applyCam();
      }

      /* Tooltip update */
      const cam = cameraRef.current;
      const mx = mouseRef.current.x;
      const my = mouseRef.current.y;
      const mapX = Math.floor((mx - cam.x) / (cam.zoom * TILE));
      const mapY = Math.floor((my - cam.y) / (cam.zoom * TILE));
      const html = buildTooltip(snapRef.current, mapX, mapY);
      if (html) {
        setTooltipHtml(html);
        setTooltipPos({ x: e.clientX + 14, y: e.clientY + 14 });
        setTooltipVisible(true);
      } else {
        setTooltipVisible(false);
      }
    };

    const onMouseUp = () => {
      dragRef.current.active = false;
      canvas.style.cursor = "grab";
    };

    const onMouseLeave = () => {
      mouseRef.current = { x: -1, y: -1 };
      setTooltipVisible(false);
    };

    /* ── Scroll-to-zoom ── */
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const cam = cameraRef.current;
      const zf = e.deltaY < 0 ? 1.12 : 0.89;
      const rect = canvas.getBoundingClientRect();
      const mx = e.clientX - rect.left;
      const my = e.clientY - rect.top;
      cam.x = mx - (mx - cam.x) * zf;
      cam.y = my - (my - cam.y) * zf;
      cam.zoom *= zf;
      applyCam();
    };

    canvas.addEventListener("mousedown", onMouseDown);
    window.addEventListener("mousemove", onMouseMove);
    window.addEventListener("mouseup", onMouseUp);
    canvas.addEventListener("mouseleave", onMouseLeave);
    canvas.addEventListener("wheel", onWheel, { passive: false });

    /* ── Resize ── */
    const ro = new ResizeObserver(() => {
      const nw = wrap.clientWidth || 800;
      const nh = wrap.clientHeight || 600;
      app.renderer.resize(nw, nh);
      canvas.style.width = `${nw}px`;
      canvas.style.height = `${nh}px`;
      hasSetCameraRef.current = false;
    });
    ro.observe(wrap);

    return () => {
      ro.disconnect();
      canvas.removeEventListener("mousedown", onMouseDown);
      window.removeEventListener("mousemove", onMouseMove);
      window.removeEventListener("mouseup", onMouseUp);
      canvas.removeEventListener("mouseleave", onMouseLeave);
      canvas.removeEventListener("wheel", onWheel);
      app.destroy(true, true);
      appRef.current = null;
      worldRef.current = null;
      tilesRef.current = null;
      entitiesRef.current = null;
      cachesRef.current = null;
    };
  }, [applyCam]);

  /* ── Render snapshot ── */
  useEffect(() => {
    const app = appRef.current;
    const tiles = tilesRef.current;
    const entities = entitiesRef.current;
    const caches = cachesRef.current;
    if (!app || !tiles || !entities || !caches) return;

    tiles.removeChildren();
    entities.removeChildren();

    const mapH = snapshot.map.length;
    const mapW = snapshot.map[0]?.length ?? 0;

    /* Tile sprites */
    for (let y = 0; y < mapH; y++) {
      for (let x = 0; x < mapW; x++) {
        const kind = snapshot.map[y]?.[x] ?? "floor";
        const tex = caches.tile[kind] ?? caches.tile.floor;
        const spr = new Sprite(tex);
        spr.position.set(x * TILE, y * TILE);
        tiles.addChild(spr);
      }
    }

    /* Floor items */
    for (const fi of snapshot.floorItems) {
      const tex = getFloorItemTex(app, caches, fi.item.kind);
      const spr = new Sprite(tex);
      spr.position.set(fi.position.x * TILE, fi.position.y * TILE);
      entities.addChild(spr);
    }

    /* Monsters */
    for (const m of snapshot.monsters) {
      const tex = getMonsterTex(app, caches, m.kind);
      const spr = new Sprite(tex);
      spr.position.set(m.position.x * TILE, m.position.y * TILE);
      entities.addChild(spr);
    }

    /* NPCs */
    for (const npc of snapshot.npcs) {
      const tex = getNpcTex(app, caches, npc.kind);
      const spr = new Sprite(tex);
      spr.position.set(npc.position.x * TILE, npc.position.y * TILE);
      entities.addChild(spr);
    }

    /* Heroes */
    snapshot.heroes.forEach((hero, idx) => {
      const color = HERO_COLORS_NUM[idx % HERO_COLORS_NUM.length] ?? 0x5599ff;
      const tex =
        hero.status !== "alive"
          ? getDeadTex(app, caches)
          : getHeroTex(app, caches, color);
      const spr = new Sprite(tex);
      spr.position.set(hero.position.x * TILE, hero.position.y * TILE);
      entities.addChild(spr);
    });

    /* Auto-fit camera on first render or resize */
    if (!hasSetCameraRef.current) {
      const rw = app.renderer.width / (app.renderer.resolution || 1);
      const rh = app.renderer.height / (app.renderer.resolution || 1);
      const zx = rw / (mapW * TILE);
      const zy = rh / (mapH * TILE);
      const cam = cameraRef.current;
      cam.zoom = Math.min(zx, zy) * 0.985;
      cam.x = (rw - mapW * TILE * cam.zoom) / 2;
      cam.y = (rh - mapH * TILE * cam.zoom) / 2;
      hasSetCameraRef.current = true;
      applyCam();
    }
  }, [snapshot, applyCam]);

  return (
    <section className="map-shell">
      <h2>Map</h2>
      <div className="map-wrap">
        <div ref={containerRef} className="map-canvas" />
        {tooltipVisible && (
          <div
            ref={tooltipRef}
            className="map-tooltip"
            style={{
              left: tooltipPos.x,
              top: tooltipPos.y,
            }}
            dangerouslySetInnerHTML={{ __html: tooltipHtml }}
          />
        )}
      </div>
      <div className="legend-grid">
        {[
          ["floor", "#2d2d3d"],
          ["wall", "#1a1a2a"],
          ["treasure", "#ffd700"],
          ["potion", "#44ff88"],
          ["exit", "#00ffff"],
          ["lava", "#cc2200"],
          ["\u2b24 hero", "#5599ff"],
          ["\u25b2 monster", "#ff6a7a"],
        ].map(([label, color]) => (
          <span key={label} className="legend-pill">
            <i className="legend-swatch" style={{ background: color }} />
            {label}
          </span>
        ))}
      </div>
    </section>
  );
}
