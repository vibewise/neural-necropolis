export const dashboardHtml = /* html */ `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Neural Necropolis</title>
  <script src="https://cdn.jsdelivr.net/npm/pixi.js@7.3.3/dist/pixi.min.js"></script>
  <style>
    :root{--bg:#0b0f18;--panel:#131a29;--panel2:#182133;--ink:#dde7ff;--muted:#8a94af;--gold:#ffcf5a;--red:#ff6a7a;--green:#60efac;--cyan:#67dbff;--blue:#7eaaff;--purple:#d48cff;--line:#2c3854;--shadow:0 12px 28px rgba(0,0,0,.26)}
    *{box-sizing:border-box;margin:0;padding:0}
    body{font-family:Consolas,'Courier New',monospace;background:radial-gradient(circle at top,#17233d 0%,#0b0f18 56%);color:var(--ink);min-height:100vh}
    .shell{height:100vh;padding:12px;display:grid;grid-template-rows:minmax(340px,50vh) minmax(320px,1fr);gap:12px;transition:grid-template-rows 0.3s ease;}
    .shell.collapsed{grid-template-rows:1fr 50px;}
    .shell.collapsed .tab-content, .shell.collapsed .comm{display:none;}
    .panel{background:rgba(19,26,41,.95);border:1px solid var(--line);border-radius:16px;box-shadow:var(--shadow)}
    .top{display:grid;grid-template-rows:auto 1fr auto;gap:10px;padding:12px;min-height:0}
    header{display:flex;justify-content:space-between;align-items:flex-start;gap:12px;flex-wrap:wrap}
    .brand-block{display:flex;flex-direction:column;gap:4px;min-width:min(520px,100%)}
    .brand-kicker{font-size:10px;letter-spacing:1.6px;text-transform:uppercase;color:var(--cyan)}
    h1{font-size:clamp(28px,4vw,42px);line-height:.95;color:#fff4c7;letter-spacing:1.2px;text-shadow:0 0 24px rgba(255,207,90,.16),0 6px 22px rgba(0,0,0,.35)}
    .subtitle{display:inline-flex;align-self:flex-start;padding:4px 10px;border-radius:999px;border:1px solid rgba(126,170,255,.35);background:linear-gradient(90deg,rgba(126,170,255,.12),rgba(212,140,255,.08));font-size:11px;color:#dfe8ff;letter-spacing:.55px}
    .board-headline{font-size:12px;color:var(--muted);letter-spacing:.35px}
    .meta{display:flex;gap:12px;flex-wrap:wrap;font-size:12px;color:var(--muted)}
    .meta b{color:var(--ink)}
    .controls{display:flex;gap:10px;align-items:center;flex-wrap:wrap;justify-content:flex-end}
    .control-buttons{display:flex;gap:8px;align-items:center;flex-wrap:wrap}
    .countdown{font-size:12px;color:var(--ink)}
    .lobby-badge{display:flex;align-items:center;gap:8px;padding:7px 10px;border-radius:999px;background:#1a2235;border:1px solid #41517a;font-size:11px;color:var(--ink)}
    .lobby-badge.ready{border-color:#4ea878;color:#d7ffe8;background:#16271f}
    .lobby-badge.waiting{border-color:#82613d;color:#ffe2a8;background:#241d15}
    .lobby-badge.running{border-color:#4e7bd6;color:#dce8ff;background:#17233d}
    .lobby-badge.completed{border-color:#9c7af2;color:#f0e6ff;background:#201830}
    button{border:1px solid #41517a;background:#1a2235;color:var(--ink);border-radius:8px;padding:8px 12px;cursor:pointer;font:inherit}
    button:hover{border-color:#6d82bf} button:disabled{opacity:.55;cursor:wait}
    .btn-primary{border-color:#4ea878;background:#173124}
    .btn-danger{border-color:#8a4153;background:#311822}
    .control-notice{min-height:16px;font-size:11px;color:var(--muted);text-align:right}
    .control-notice.info{color:var(--cyan)}
    .control-notice.warn{color:#ffe2a8}
    .control-notice.error{color:var(--red)}
    .phase-wrap{min-width:240px;flex:1}
    .phase-bar{height:8px;border-radius:999px;background:#212942;overflow:hidden}
    .phase-fill{height:100%;border-radius:999px;transition:width .3s linear}.phase-fill.submit{background:linear-gradient(90deg,var(--cyan),#339aff)}.phase-fill.resolve{background:linear-gradient(90deg,#ff9a62,var(--red))}
    .map-wrap{background:#090c14;border:1px solid #212942;border-radius:12px;padding:8px;overflow:hidden;display:flex;justify-content:center;align-items:flex-start;min-height:0;cursor:grab;}
    .map-wrap canvas{display:block;image-rendering:pixelated;transform-origin:top left;}
    .legend{font-size:10px;color:var(--muted);display:flex;gap:10px;flex-wrap:wrap}
    .legend span{display:flex;align-items:center;gap:4px}.legend i{display:inline-block;width:10px;height:10px;border-radius:2px}
    .bottom{display:grid;grid-template-columns:3fr 1fr;gap:12px;min-height:0}
    .left{display:grid;grid-template-rows:auto 1fr;min-height:0}
    .tabs{display:flex;gap:8px;flex-wrap:wrap;padding:12px 12px 0;min-height:42px;align-items:center}
    .tab{border:1px solid #35425f;background:#141b2b;color:var(--muted);border-radius:999px;padding:7px 12px;font-size:12px;cursor:pointer}
    .tab.active{background:#243453;border-color:#7eaaff;color:var(--ink)}
    .tab-content{padding:12px;overflow:auto;min-height:0}
    .overview-grid,.hero-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px}
    .card{background:var(--panel2);border:1px solid var(--line);border-radius:12px;padding:10px;min-height:0}
    .card h2{font-size:12px;color:var(--gold);margin-bottom:8px;letter-spacing:1px}
    .list{display:flex;flex-direction:column;gap:6px}
    .row{display:flex;justify-content:space-between;align-items:flex-start;gap:10px;padding:6px 0;border-bottom:1px solid #222b44;font-size:11px}
    .row:last-child{border-bottom:none}
    .name{font-weight:bold;color:var(--blue)} .name.dead{color:var(--red);text-decoration:line-through} .name.escaped{color:var(--cyan)}
    .trait{color:var(--muted);font-size:10px;font-style:italic}
    .score{color:var(--gold);font-weight:bold}
    .small{font-size:10px;color:var(--muted)}
    .hero-lines{display:flex;flex-direction:column;gap:8px;font-size:11px}
    .pill{display:inline-flex;padding:3px 7px;border-radius:999px;background:#212b46;border:1px solid #35425f;font-size:10px;color:var(--ink);margin:2px 4px 0 0}
    .comm{display:grid;grid-template-rows:auto 1fr;min-height:0}
    .comm-header{padding:12px 12px 0}
    .comm-stream{padding:12px;overflow:auto;display:flex;flex-direction:column;gap:8px;min-height:0}
    .msg{background:#171f31;border:1px solid #2c3854;border-radius:10px;padding:8px;font-size:11px}
    .msg-meta{display:flex;justify-content:space-between;gap:8px;font-size:10px;color:var(--muted);margin-bottom:4px}
    @media(max-width:980px){.shell{grid-template-rows:minmax(280px,42vh) minmax(420px,1fr)}.bottom{grid-template-columns:1fr}.overview-grid,.hero-grid{grid-template-columns:1fr}}
    #tooltip{position:fixed;pointer-events:none;display:none;z-index:9999;background:rgba(13,18,32,.97);border:1px solid var(--blue);border-radius:8px;padding:8px 10px;font-size:11px;line-height:1.5;color:var(--ink);white-space:pre;box-shadow:0 6px 18px rgba(0,0,0,.5);max-width:240px;}
    #tooltip .tt-name{font-weight:bold;color:var(--gold);font-size:12px;}
    #tooltip .tt-sub{color:var(--muted);font-style:italic;}
  </style>
</head>
<body>
  <div id="tooltip"></div>
  <div class="shell">
    <section class="panel top">
      <header>
        <div class="brand-block">
          <div class="brand-kicker">Arena Of Recursive Ruin</div>
          <h1 id="title">Neural Necropolis</h1>
          <div class="subtitle">Where Dead Code Dreams of Vengeance</div>
          <div id="boardHeadline" class="board-headline">Awaiting active board...</div>
          <div class="meta">
            <span>Turn <b id="turn">-</b></span>
            <span>Phase <b id="phase">-</b></span>
            <span>Seed <b id="seed">-</b></span>
            <span>Heroes <b id="heroCount">0</b></span>
          </div>
        </div>
        <div class="controls">
          <div id="lobbyBadge" class="lobby-badge waiting"><span id="lobbyStatus">Lobby waiting</span><span>Attached <b id="attachedBots">0/0</b></span></div>
          <span class="countdown">Window ends in <b id="countdown">-</b></span>
          <div class="control-buttons">
            <button id="startBtn" class="btn-primary" type="button">Start Duel</button>
            <button id="stopBtn" class="btn-danger" type="button">End Duel</button>
            <button id="newWorldBtn" type="button">New World</button>
          </div>
          <div id="controlNotice" class="control-notice"></div>
          <div class="phase-wrap"><div class="phase-bar"><div class="phase-fill" id="phaseFill"></div></div></div>
        </div>
      </header>
      <div class="map-wrap"><div id="map" style="width:100%;height:100%;"></div></div>
      <div class="legend">
        <span><i style="background:#2d2d3d"></i>floor</span>
        <span><i style="background:#1a1a2a"></i>wall</span>
        <span><i style="background:#ffd700"></i>treasure</span>
        <span><i style="background:#44ff88"></i>potion</span>
        <span><i style="background:#00ffff"></i>exit</span>
        <span><i style="background:#8b6914"></i>door</span>
        <span><i style="background:#ff6600"></i>trap</span>
        <span><i style="background:#bb77ff"></i>shrine</span>
        <span><i style="background:#5599ff"></i>merchant</span>
        <span><i style="background:#cc2200"></i>lava</span>
      </div>
    </section>

    <section class="bottom">
      <div class="panel left">
        <div style="display:flex;justify-content:space-between;align-items:flex-start;padding-right:12px;">
          <div id="tabs" class="tabs" style="flex:1;"></div>
          <button id="toggleBottomBtn" type="button" style="margin-top:12px;border:1px solid var(--muted);background:#141b2b;color:var(--muted);border-radius:999px;padding:7px 12px;font-size:12px;cursor:pointer;">▼ Collapse</button>
        </div>
        <div id="tabContent" class="tab-content"></div>
      </div>
      <aside class="panel comm">
        <div class="comm-header">
          <h2 style="font-size:12px;color:var(--gold);letter-spacing:1px">BOT COMMUNICATIONS</h2>
          <div id="commTarget" class="small" style="margin-top:6px">Overview</div>
        </div>
        <div id="commStream" class="comm-stream"></div>
      </aside>
    </section>
  </div>

  <script>
  const $=id=>document.getElementById(id);
  const TILE=16;
  var camera={x:0,y:0,zoom:1};
  var isDragging=false, dragStart={x:0,y:0}, hasSetCamera=false;
  var mouseX=-1, mouseY=-1;
  var activeBoardId=null;
  var boardList=[];
  var hiddenCompletedBoards={};
  var boardExitTimers={};
  var selectedBoardSummary=null;

  /* ── PixiJS setup ── */
  var pixiApp=null, world=null, tileLayer=null, entityLayer=null;
  var tileTextures={}, spriteGrid=[], entitySprites=[];
  var MCOLOR_N={goblin:0xff5555,spider:0x88ff44,skeleton:0xcccccc,wraith:0x9966ff,orc:0xff8833,mimic:0xffcc00,dragon:0xff2222};
  var HCOLORS=['#5599ff','#55ff99','#ffaa55','#ff55aa','#55aaff','#a8ff7f'];
  var HCOLORS_N=[0x5599ff,0x55ff99,0xffaa55,0xff55aa,0x55aaff,0xa8ff7f];
  var lastSnap=null;
  var selectedTab='overview';

  function esc(v){return String(v??'').replace(/[&<>\"]/g,function(m){return{'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[m];});}

  function hexNum(hex){return parseInt(hex.replace('#',''),16);}

  function starPoints(cx,cy,points,outerR,innerR){
    var pts=[];
    var step=Math.PI/points;
    var angle=-Math.PI/2;
    for(var i=0;i<points*2;i++){
      var r=(i%2===0)?outerR:innerR;
      pts.push(cx+Math.cos(angle)*r,cy+Math.sin(angle)*r);
      angle+=step;
    }
    return pts;
  }

  /* Build a small texture from a PIXI.Graphics drawing */
  function gfxTex(drawFn){
    var g=new PIXI.Graphics();
    drawFn(g);
    var tex=pixiApp.renderer.generateTexture(g);
    g.destroy();
    return tex;
  }

  /* ── Tile textures ── */
  function buildTileTextures(){
    var T=TILE;
    var types={
      floor:[0x2d2d3d,function(g){
        g.beginFill(0x2d2d3d);g.drawRect(0,0,T,T);g.endFill();
        g.beginFill(0x39424f,0.35);g.drawRect(3,3,1,1);g.drawRect(11,8,1,1);g.drawRect(7,13,1,1);g.endFill();
      }],
      wall:[0x1a1a2a,function(g){
        g.beginFill(0x0f1113);g.drawRect(0,0,T,T);g.endFill();
        g.beginFill(0x1a1a2a);g.drawRect(1,1,T-2,T-2);g.endFill();
        g.beginFill(0x3a3a3a,0.3);g.drawRect(2,2,T-4,T-4);g.endFill();
      }],
      door_closed:[0x8b6914,function(g){
        g.beginFill(0x2d2d3d);g.drawRect(0,0,T,T);g.endFill();
        g.beginFill(0x8b6914);g.drawRoundedRect(2,1,T-4,T-2,2);g.endFill();
        g.beginFill(0xffd700);g.drawCircle(T-5,T/2,1.5);g.endFill();
      }],
      door_locked:[0x8b4513,function(g){
        g.beginFill(0x2d2d3d);g.drawRect(0,0,T,T);g.endFill();
        g.beginFill(0x8b4513);g.drawRoundedRect(2,1,T-4,T-2,2);g.endFill();
        g.beginFill(0xff4444);g.drawCircle(T-5,T/2,1.5);g.endFill();
      }],
      door_open:[0x6b5a14,function(g){
        g.beginFill(0x2d2d3d);g.drawRect(0,0,T,T);g.endFill();
        g.beginFill(0x6b5a14,0.5);g.drawRoundedRect(2,1,T-4,T-2,2);g.endFill();
      }],
      trap_hidden:[0x2d2d3d,function(g){
        g.beginFill(0x2d2d3d);g.drawRect(0,0,T,T);g.endFill();
        g.beginFill(0x39424f,0.35);g.drawRect(3,3,1,1);g.drawRect(11,8,1,1);g.endFill();
      }],
      trap_visible:[0xff6600,function(g){
        g.beginFill(0x2d2d3d);g.drawRect(0,0,T,T);g.endFill();
        g.beginFill(0xff6600);g.drawPolygon([T/2,2, T-3,T-3, 3,T-3]);g.endFill();
        g.beginFill(0xffcc00);g.drawRect(T/2-1,6,2,4);g.drawRect(T/2-1,T-6,2,2);g.endFill();
      }],
      trap_triggered:[0x663300,function(g){
        g.beginFill(0x2d2d3d);g.drawRect(0,0,T,T);g.endFill();
        g.beginFill(0x663300,0.5);g.drawPolygon([T/2,3, T-3,T-3, 3,T-3]);g.endFill();
      }],
      chest:[0xffd700,function(g){
        g.beginFill(0x2d2d3d);g.drawRect(0,0,T,T);g.endFill();
        g.beginFill(0xdaa520);g.drawRoundedRect(2,4,T-4,T-6,2);g.endFill();
        g.beginFill(0xffd700);g.drawRect(3,5,T-6,2);g.endFill();
        g.beginFill(0xffffff);g.drawRect(T/2-1,7,2,2);g.endFill();
      }],
      chest_locked:[0xdaa520,function(g){
        g.beginFill(0x2d2d3d);g.drawRect(0,0,T,T);g.endFill();
        g.beginFill(0xdaa520);g.drawRoundedRect(2,4,T-4,T-6,2);g.endFill();
        g.beginFill(0xff4444);g.drawRect(T/2-1,7,2,2);g.endFill();
      }],
      chest_open:[0x444444,function(g){
        g.beginFill(0x2d2d3d);g.drawRect(0,0,T,T);g.endFill();
        g.beginFill(0x444444);g.drawRoundedRect(2,6,T-4,T-8,2);g.endFill();
        g.beginFill(0x666666);g.drawRect(3,4,T-6,3);g.endFill();
      }],
      treasure:[0xffd700,function(g){
        g.beginFill(0x2d2d3d);g.drawRect(0,0,T,T);g.endFill();
        g.beginFill(0xffd700);g.drawPolygon(starPoints(T/2,T/2,4,5,2.5));g.endFill();
      }],
      potion:[0x44ff88,function(g){
        g.beginFill(0x2d2d3d);g.drawRect(0,0,T,T);g.endFill();
        g.beginFill(0x44ff88);g.drawRoundedRect(4,6,T-8,T-7,3);g.endFill();
        g.beginFill(0x88ffbb);g.drawRect(6,3,4,4);g.endFill();
        g.beginFill(0xffffff,0.4);g.drawRect(5,7,2,3);g.endFill();
      }],
      exit:[0x00ffff,function(g){
        g.beginFill(0x2d2d3d);g.drawRect(0,0,T,T);g.endFill();
        g.lineStyle(2,0x00ffff,0.9);g.drawRoundedRect(2,2,T-4,T-4,3);
        g.lineStyle(0);g.beginFill(0x00ffff,0.3);g.drawRoundedRect(4,4,T-8,T-8,2);g.endFill();
      }],
      shrine:[0xbb77ff,function(g){
        g.beginFill(0x2d2d3d);g.drawRect(0,0,T,T);g.endFill();
        g.beginFill(0xbb77ff);g.drawPolygon([T/2,1, T-2,T-2, 2,T-2]);g.endFill();
        g.beginFill(0xffffff,0.5);g.drawCircle(T/2,T/2+1,2);g.endFill();
      }],
      merchant:[0x5599ff,function(g){
        g.beginFill(0x2d2d3d);g.drawRect(0,0,T,T);g.endFill();
        g.beginFill(0x5599ff);g.drawCircle(T/2,5,4);g.endFill();
        g.beginFill(0x5599ff);g.drawRoundedRect(3,8,T-6,T-9,2);g.endFill();
        g.beginFill(0xffd700);g.drawRect(T/2-1,9,2,2);g.endFill();
      }],
      shallow_water:[0x234488,function(g){
        g.beginFill(0x234488);g.drawRect(0,0,T,T);g.endFill();
        g.beginFill(0x3366aa,0.4);g.drawEllipse(5,5,4,1.5);g.drawEllipse(11,11,3,1);g.endFill();
      }],
      lava:[0xcc2200,function(g){
        g.beginFill(0xcc2200);g.drawRect(0,0,T,T);g.endFill();
        g.beginFill(0xff6600,0.5);g.drawEllipse(5,5,3,2);g.drawEllipse(11,11,4,2);g.endFill();
        g.beginFill(0xffcc00,0.3);g.drawCircle(8,8,2);g.endFill();
      }]
    };
    for(var k in types){
      tileTextures[k]=gfxTex(types[k][1]);
    }
  }

  /* ── Hero sprite drawing per type ── */
  function drawBerserker(g,c){
    var T=TILE;
    g.beginFill(c);
    // horns
    g.drawPolygon([2,6, 4,0, 5,6]);
    g.drawPolygon([T-2,6, T-4,0, T-5,6]);
    // helmet
    g.drawRoundedRect(3,4,T-6,4,1);
    // body
    g.drawRoundedRect(2,8,T-4,5,1);
    // legs
    g.drawRect(3,13,3,3);
    g.drawRect(T-6,13,3,3);
    g.endFill();
    // eyes
    g.beginFill(0xff3333);g.drawRect(5,5,2,2);g.drawRect(T-7,5,2,2);g.endFill();
    // weapon line
    g.lineStyle(1.5,0xcccccc);g.moveTo(T-1,2);g.lineTo(T-1,14);g.lineStyle(0);
  }
  function drawExplorer(g,c){
    var T=TILE;
    g.beginFill(c);
    // hat brim
    g.drawRoundedRect(0,3,T,3,1);
    // hat crown
    g.drawRoundedRect(4,0,T-8,5,1);
    // head
    g.drawCircle(T/2,7,3);
    // body
    g.drawRoundedRect(4,9,T-8,4,1);
    // legs
    g.drawRect(4,13,3,3);g.drawRect(T-7,13,3,3);
    g.endFill();
    // eyes
    g.beginFill(0xffffff);g.drawRect(6,6,1.5,1.5);g.drawRect(T-7.5,6,1.5,1.5);g.endFill();
    // walking stick
    g.lineStyle(1.5,0x8b6914);g.moveTo(1,6);g.lineTo(1,15);g.lineStyle(0);
  }
  function drawTreasureHunter(g,c){
    var T=TILE;
    g.beginFill(c);
    // head
    g.drawCircle(T/2,4,3.5);
    // body (hunched)
    g.drawEllipse(T/2,10,5,4);
    // legs
    g.drawRect(4,13,3,3);g.drawRect(T-7,13,3,3);
    g.endFill();
    // mask / bandana
    g.beginFill(0x222222);g.drawRect(4,3,T-8,2);g.endFill();
    g.beginFill(0xffffff);g.drawRect(5,3,2,1.5);g.drawRect(T-7,3,2,1.5);g.endFill();
    // sack
    g.beginFill(0xdaa520);g.drawCircle(T-3,8,3);g.endFill();
    g.beginFill(0xffd700);g.drawRect(T-4,7,2,2);g.endFill();
  }
  function drawAIBot(g,c){
    var T=TILE;
    // antenna
    g.beginFill(0xffcc00);g.drawCircle(T/2,1,1.5);g.endFill();
    g.beginFill(c);g.drawRect(T/2-0.5,1,1,3);g.endFill();
    g.beginFill(c);
    // head (boxy)
    g.drawRoundedRect(3,3,T-6,5,1);
    // visor
    g.endFill();
    g.beginFill(0x00ffff);g.drawRect(5,5,T-10,2);g.endFill();
    g.beginFill(c);
    // body
    g.drawRoundedRect(2,8,T-4,5,1);
    // legs
    g.drawRect(3,13,3,3);g.drawRect(T-6,13,3,3);
    g.endFill();
    // panel lights
    g.beginFill(0x00ff00);g.drawRect(5,9,1.5,1.5);g.endFill();
    g.beginFill(0xff0000);g.drawRect(T-6.5,9,1.5,1.5);g.endFill();
  }
  function drawGenericBot(g,c){
    var T=TILE;
    g.beginFill(c);
    g.drawCircle(T/2,5,4);
    g.drawRoundedRect(3,8,T-6,5,1);
    g.drawRect(4,13,3,3);g.drawRect(T-7,13,3,3);
    g.endFill();
    g.beginFill(0xffffff);g.drawRect(5,4,2,2);g.drawRect(T-7,4,2,2);g.endFill();
  }
  function drawDeadBot(g){
    var T=TILE;
    g.beginFill(0x8a4153,0.5);g.drawCircle(T/2,T/2,T/2-1);g.endFill();
    g.lineStyle(2.5,0xff6a7a,0.8);
    g.moveTo(3,3);g.lineTo(T-3,T-3);
    g.moveTo(T-3,3);g.lineTo(3,T-3);
    g.lineStyle(0);
  }

  var heroBotDrawers={berserker:drawBerserker,explorer:drawExplorer,treasure:drawTreasureHunter,aibot:drawAIBot,generic:drawGenericBot};
  function getBotType(hr){
    if(hr.name==='Berserker') return 'berserker';
    if(hr.name==='Explorer') return 'explorer';
    if(hr.name==='TreasureHunter') return 'treasure';
    if((hr.strategy||'').startsWith('LLM-powered')) return 'aibot';
    return 'generic';
  }

  /* ── Monster sprites ── */
  function drawGoblin(g,c){
    var T=TILE;
    g.beginFill(c);
    g.drawPolygon([3,2, 5,0, 6,3]);g.drawPolygon([T-3,2, T-5,0, T-6,3]);
    g.drawCircle(T/2,5,4);
    g.drawRoundedRect(4,8,T-8,5,1);
    g.drawRect(5,13,2,2);g.drawRect(T-7,13,2,2);
    g.endFill();
    g.beginFill(0xffff00);g.drawRect(5,4,2,2);g.drawRect(T-7,4,2,2);g.endFill();
  }
  function drawSpider(g,c){
    var T=TILE;
    g.beginFill(c);g.drawEllipse(T/2,T/2,5,4);g.endFill();
    g.beginFill(0xff0000);g.drawCircle(5,T/2-1,1);g.drawCircle(T-5,T/2-1,1);g.endFill();
    g.lineStyle(1.2,c);
    var cx=T/2,cy=T/2;
    for(var i=0;i<4;i++){
      var a=(-0.6+i*0.4);g.moveTo(cx-4,cy+i*2-3);g.lineTo(0,cy+i*2-4+a*2);
      g.moveTo(cx+4,cy+i*2-3);g.lineTo(T,cy+i*2-4+a*2);
    }
    g.lineStyle(0);
  }
  function drawSkeleton(g,c){
    var T=TILE;
    g.beginFill(c);
    g.drawCircle(T/2,4,3.5);
    g.drawRect(T/2-1,7,2,5);
    g.drawRect(3,8,T-6,1);
    g.drawRect(5,12,2,4);g.drawRect(T-7,12,2,4);
    g.endFill();
    g.beginFill(0x000000);g.drawRect(5,3,2,2);g.drawRect(T-7,3,2,2);g.drawRect(T/2-1,5,2,1);g.endFill();
  }
  function drawWraith(g,c){
    var T=TILE;
    g.beginFill(c,0.5);g.drawEllipse(T/2,T/2,6,7);g.endFill();
    g.beginFill(c,0.8);g.drawEllipse(T/2,5,4,4);g.endFill();
    g.beginFill(0xffffff);g.drawRect(5,4,2,2);g.drawRect(T-7,4,2,2);g.endFill();
    g.beginFill(c,0.3);
    g.drawPolygon([2,T-2, 4,T-5, 6,T-1]);
    g.drawPolygon([T-2,T-2, T-4,T-5, T-6,T-1]);
    g.endFill();
  }
  function drawOrc(g,c){
    var T=TILE;
    g.beginFill(c);
    g.drawCircle(T/2,5,4.5);
    g.drawRoundedRect(1,9,T-2,5,1);
    g.drawRect(2,14,4,2);g.drawRect(T-6,14,4,2);
    g.endFill();
    g.beginFill(0xffffff);g.drawPolygon([5,8,6,6,7,8]);g.drawPolygon([T-5,8,T-6,6,T-7,8]);g.endFill();
    g.beginFill(0xff0000);g.drawRect(5,3,2,2);g.drawRect(T-7,3,2,2);g.endFill();
  }
  function drawMimic(g,c){
    var T=TILE;
    g.beginFill(0xdaa520);g.drawRoundedRect(1,4,T-2,T-5,2);g.endFill();
    g.beginFill(c);g.drawRect(2,5,T-4,2);g.endFill();
    g.beginFill(0xff0000);g.drawCircle(5,T/2+2,1.5);g.drawCircle(T-5,T/2+2,1.5);g.endFill();
    g.beginFill(0xffffff);
    for(var i=0;i<4;i++){g.drawPolygon([3+i*2.5,6, 4+i*2.5,4, 5+i*2.5,6]);}
    g.endFill();
  }
  function drawDragon(g,c){
    var T=TILE;
    g.beginFill(c);
    g.drawCircle(T/2,5,4);
    g.drawRoundedRect(2,8,T-4,6,2);
    g.endFill();
    g.beginFill(c,0.7);
    g.drawPolygon([0,4, 3,7, 2,10, 0,8]);
    g.drawPolygon([T,4, T-3,7, T-2,10, T,8]);
    g.endFill();
    g.beginFill(0xffff00);g.drawRect(5,4,2,2);g.drawRect(T-7,4,2,2);g.endFill();
    g.beginFill(0xff8800);
    g.drawPolygon([T/2-1,T-1, T/2,T+1, T/2+1,T-1]);
    g.endFill();
  }
  var monsterDrawers={goblin:drawGoblin,spider:drawSpider,skeleton:drawSkeleton,wraith:drawWraith,orc:drawOrc,mimic:drawMimic,dragon:drawDragon};
  function drawDefaultMonster(g,c){
    var T=TILE;
    g.beginFill(c);g.drawCircle(T/2,T/2,T/2-1);g.endFill();
    g.beginFill(0xffffff);g.drawRect(5,T/2-2,2,2);g.drawRect(T-7,T/2-2,2,2);g.endFill();
  }

  /* ── NPC sprites ── */
  function drawNpcShrine(g){
    var T=TILE;
    g.beginFill(0xbb77ff);g.drawPolygon([T/2,1, T-2,T-2, 2,T-2]);g.endFill();
    g.beginFill(0xffffff,0.6);g.drawCircle(T/2,T/2+1,2.5);g.endFill();
    g.beginFill(0xeeddff,0.3);g.drawPolygon(starPoints(T/2,T/2+1,4,4,2));g.endFill();
  }
  function drawNpcMerchant(g){
    var T=TILE;
    g.beginFill(0x5599ff);g.drawCircle(T/2,5,4);g.endFill();
    g.beginFill(0x5599ff);g.drawRoundedRect(3,8,T-6,5,1);g.endFill();
    g.beginFill(0xffffff);g.drawRect(6,4,1.5,1.5);g.drawRect(T-7.5,4,1.5,1.5);g.endFill();
    g.beginFill(0xffd700);g.drawCircle(T/2,10,2);g.endFill();
  }

  /* ── Texture caches ── */
  var heroTexCache={};
  var monsterTexCache={};
  var npcTexCache={};
  var floorItemTexCache={};

  function getHeroTex(type,colorHex){
    var k=type+'|'+colorHex;
    if(heroTexCache[k]) return heroTexCache[k];
    var c=hexNum(colorHex);
    var fn=heroBotDrawers[type]||drawGenericBot;
    heroTexCache[k]=gfxTex(function(g){fn(g,c);});
    return heroTexCache[k];
  }
  function getDeadTex(){
    if(heroTexCache._dead) return heroTexCache._dead;
    heroTexCache._dead=gfxTex(drawDeadBot);
    return heroTexCache._dead;
  }
  function getMonsterTex(kind){
    if(monsterTexCache[kind]) return monsterTexCache[kind];
    var c=MCOLOR_N[kind]||0xff5555;
    var fn=monsterDrawers[kind]||drawDefaultMonster;
    monsterTexCache[kind]=gfxTex(function(g){fn(g,c);});
    return monsterTexCache[kind];
  }
  function getNpcTex(kind){
    if(npcTexCache[kind]) return npcTexCache[kind];
    if(kind==='shrine') npcTexCache[kind]=gfxTex(drawNpcShrine);
    else if(kind==='merchant') npcTexCache[kind]=gfxTex(drawNpcMerchant);
    else npcTexCache[kind]=gfxTex(function(g){g.beginFill(0xffcc55);g.drawCircle(TILE/2,TILE/2,TILE/2-1);g.endFill();});
    return npcTexCache[kind];
  }
  function getFloorItemTex(kind){
    if(floorItemTexCache[kind]) return floorItemTexCache[kind];
    if(kind==='treasure'&&tileTextures.chest) floorItemTexCache[kind]=tileTextures.chest;
    else if(kind==='potion'&&tileTextures.potion) floorItemTexCache[kind]=tileTextures.potion;
    else floorItemTexCache[kind]=gfxTex(function(g){g.beginFill(0xdaa520);g.drawRoundedRect(3,3,TILE-6,TILE-6,2);g.endFill();});
    return floorItemTexCache[kind];
  }

  /* ── Init PixiJS ── */
  function initPixi(){
    var mapDiv=$('map');
    var wrap=document.querySelector('.map-wrap');
    var w=wrap.clientWidth-16||800, h=wrap.clientHeight-16||600;
    pixiApp=new PIXI.Application({
      width:w, height:h,
      backgroundColor:0x090c14,
      antialias:false,
      resolution:window.devicePixelRatio||1,
      autoDensity:true
    });
    mapDiv.appendChild(pixiApp.view);
    pixiApp.view.style.width='100%';
    pixiApp.view.style.height='100%';
    pixiApp.view.style.cursor='grab';
    pixiApp.view.style.imageRendering='pixelated';

    world=new PIXI.Container();
    tileLayer=new PIXI.Container();
    entityLayer=new PIXI.Container();
    world.addChild(tileLayer);
    world.addChild(entityLayer);
    pixiApp.stage.addChild(world);

    buildTileTextures();

    /* Mouse pan */
    pixiApp.view.addEventListener('mousedown',function(e){
      isDragging=true;
      dragStart={x:e.clientX-camera.x,y:e.clientY-camera.y};
      pixiApp.view.style.cursor='grabbing';
    });
    window.addEventListener('mousemove',function(e){
      var rect=pixiApp.view.getBoundingClientRect();
      mouseX=e.clientX-rect.left;mouseY=e.clientY-rect.top;
      var tt=$('tooltip');if(tt){tt.style.left=(e.clientX+14)+'px';tt.style.top=(e.clientY+14)+'px';}
      if(isDragging){
        camera.x=e.clientX-dragStart.x;camera.y=e.clientY-dragStart.y;
        applyCam();
      }
      if(lastSnap) updateTooltip(lastSnap);
    });
    pixiApp.view.addEventListener('mouseleave',function(){
      mouseX=-1;mouseY=-1;
      var tt=$('tooltip');if(tt)tt.style.display='none';
    });
    window.addEventListener('mouseup',function(){isDragging=false;if(pixiApp)pixiApp.view.style.cursor='grab';});

    /* Mouse zoom */
    pixiApp.view.addEventListener('wheel',function(e){
      e.preventDefault();
      var zf=e.deltaY<0?1.12:0.89;
      var rect=pixiApp.view.getBoundingClientRect();
      var mx=e.clientX-rect.left, my=e.clientY-rect.top;
      camera.x=mx-(mx-camera.x)*zf;
      camera.y=my-(my-camera.y)*zf;
      camera.zoom*=zf;
      applyCam();
      if(lastSnap) updateTooltip(lastSnap);
    },{passive:false});
  }

  function applyCam(){
    if(!world) return;
    world.position.set(camera.x,camera.y);
    world.scale.set(camera.zoom);
  }

  function resizePixi(){
    if(!pixiApp) return;
    var wrap=document.querySelector('.map-wrap');
    var w=wrap.clientWidth-16||800, h=wrap.clientHeight-16||600;
    pixiApp.renderer.resize(w,h);
    hasSetCamera=false;
  }

  /* ── Main render call ── */
  var prevMapKey='';
  function renderMap(snap){
    if(!snap.map||!snap.map.length) return;
    if(!pixiApp) initPixi();

    var h=snap.map.length, w=snap.map[0].length;

    /* auto fit camera on first render or resize */
    if(!hasSetCamera){
      var rw=pixiApp.renderer.width/pixiApp.renderer.resolution;
      var rh=pixiApp.renderer.height/pixiApp.renderer.resolution;
      var zx=rw/(w*TILE), zy=rh/(h*TILE);
      camera.zoom=Math.min(zx,zy)*0.95;
      camera.x=(rw-(w*TILE*camera.zoom))/2;
      camera.y=(rh-(h*TILE*camera.zoom))/2;
      hasSetCamera=true;
      applyCam();
    }

    /* Rebuild tile sprites only when map changes */
    var mapKey=snap.map.map(function(r){return r.join('');}).join('|');
    if(mapKey!==prevMapKey){
      prevMapKey=mapKey;
      tileLayer.removeChildren();
      for(var y=0;y<h;y++){
        for(var x=0;x<w;x++){
          var tType=snap.map[y][x];
          var tex=tileTextures[tType]||tileTextures.floor;
          if(tex){
            var ts=new PIXI.Sprite(tex);
            ts.position.set(x*TILE,y*TILE);
            tileLayer.addChild(ts);
          }
        }
      }
    }

    /* Entity layer — rebuilt every snapshot */
    entityLayer.removeChildren();

    /* Floor items */
    for(var fi=0;fi<(snap.floorItems||[]).length;fi++){
      var item=snap.floorItems[fi];
      var itex=getFloorItemTex(item.kind);
      var is=new PIXI.Sprite(itex);
      is.position.set(item.position.x*TILE,item.position.y*TILE);
      entityLayer.addChild(is);
    }

    /* Monsters */
    for(var mi=0;mi<(snap.monsters||[]).length;mi++){
      var mon=snap.monsters[mi];
      var mtex=getMonsterTex(mon.kind);
      var ms=new PIXI.Sprite(mtex);
      ms.position.set(mon.position.x*TILE,mon.position.y*TILE);
      entityLayer.addChild(ms);
    }

    /* NPCs */
    for(var ni=0;ni<(snap.npcs||[]).length;ni++){
      var npc=snap.npcs[ni];
      var ntex=getNpcTex(npc.kind);
      var ns=new PIXI.Sprite(ntex);
      ns.position.set(npc.position.x*TILE,npc.position.y*TILE);
      entityLayer.addChild(ns);
    }

    /* Heroes */
    var heroes=snap.heroes||[];
    for(var hi=0;hi<heroes.length;hi++){
      var hr=heroes[hi];
      var hc=HCOLORS[hi%HCOLORS.length];
      var htex;
      if(hr.status!=='alive'){
        htex=getDeadTex();
      } else {
        htex=getHeroTex(getBotType(hr),hc);
      }
      var hs=new PIXI.Sprite(htex);
      hs.position.set(hr.position.x*TILE,hr.position.y*TILE);
      entityLayer.addChild(hs);
    }

    updateTooltip(snap);
  }

  function updateTooltip(snap){
    var tt=$('tooltip');
    if(!tt||mouseX<0||mouseY<0){if(tt)tt.style.display='none';return;}
    var mapX=Math.floor((mouseX-camera.x)/(camera.zoom*TILE));
    var mapY=Math.floor((mouseY-camera.y)/(camera.zoom*TILE));
    if(!snap.map||mapY<0||mapY>=snap.map.length||mapX<0||mapX>=snap.map[0].length){tt.style.display='none';return;}
    var parts=[];
    for(var i=0;i<(snap.heroes||[]).length;i++){
      var hr=snap.heroes[i];
      if(hr.position.x!==mapX||hr.position.y!==mapY) continue;
      var alive=hr.status==='alive';
      parts.push('<span class="tt-name">'+(alive?'\u2694\ufe0f ':'\u2620\ufe0f ')+esc(hr.name)+'</span>\\n'
        +'HP '+hr.stats.hp+'/'+hr.stats.maxHp+' \u00b7 '+hr.score+' pts\\n'
        +'<span class="tt-sub">'+esc(hr.trait)+'</span>\\n'
        +'<span class="tt-sub">'+esc(hr.strategy||'')+'</span>');
    }
    for(var j=0;j<(snap.monsters||[]).length;j++){
      var m=snap.monsters[j];
      if(m.position.x!==mapX||m.position.y!==mapY) continue;
      parts.push('<span class="tt-name">\ud83d\udc79 '+esc(m.kind)+'</span>\\nHP '+m.stats.hp+'/'+m.stats.maxHp);
    }
    for(var k=0;k<(snap.npcs||[]).length;k++){
      var n=snap.npcs[k];
      if(n.position.x!==mapX||n.position.y!==mapY) continue;
      parts.push('<span class="tt-name">'+esc(n.kind)+'</span>');
    }
    for(var l=0;l<(snap.floorItems||[]).length;l++){
      var fi=snap.floorItems[l];
      if(fi.position.x!==mapX||fi.position.y!==mapY) continue;
      parts.push('<span class="tt-name">'+esc(fi.kind)+'</span>');
    }
    if(!parts.length){tt.style.display='none';return;}
    tt.innerHTML=parts.join('<hr style="border-color:#2c3854;margin:4px 0">');
    tt.style.display='block';
  }

  function warmupRemainingMs(turnState){
    if(!turnState) return 0;
    var base=Number(turnState.warmupRemainingMs||0);
    if(!base) return 0;
    var receivedAt=Number(turnState._receivedAt||Date.now());
    return Math.max(0, base - (Date.now()-receivedAt));
  }

  function warmupProgress(turnState){
    var remaining=warmupRemainingMs(turnState);
    var initial=Number(turnState&&turnState._warmupInitialMs||0);
    if(!remaining || !initial) return 0;
    return Math.min(100,Math.max(0,Math.round((1-remaining/initial)*100)));
  }

  function renderTurnState(turnState,lobby){
    var warmupRemaining=warmupRemainingMs(turnState);
    $('phase').textContent=turnState.started ? turnState.phase.toUpperCase() : (warmupRemaining>0 ? 'WARM-UP' : String((lobby&&lobby.status)||'lobby').toUpperCase());
    $('seed').textContent=turnState.seed;
    const remaining=turnState.started ? Math.max(0,turnState.phaseEndsAt-Date.now()) : warmupRemaining;
    $('countdown').textContent=remaining>0 ? (remaining/1000).toFixed(1)+'s' : ((lobby&&lobby.status)==='completed' ? '-' : 'waiting');
    const pct=turnState.started
      ? Math.min(100,Math.max(0,Math.round((1-remaining/turnState.phaseDurationMs)*100)))
      : warmupProgress(turnState);
    const fill=$('phaseFill');
    fill.style.width=pct+'%';
    fill.className='phase-fill '+(turnState.started ? turnState.phase : 'submit');
  }

  function setControlNotice(message,tone){
    const el=$('controlNotice');
    el.textContent=message||'';
    el.className='control-notice'+(tone ? ' '+tone : '');
  }

  function renderControlNotice(turnState,lobby){
    const status=lobby&&lobby.status ? lobby.status : 'lobby';
    var warmupRemaining=warmupRemainingMs(turnState);
    if(warmupRemaining > 0){
      setControlNotice('Warm-up active. Auto-start unlocks in '+(warmupRemaining/1000).toFixed(1)+'s.','info');
      return;
    }
    if(status==='completed'){
      setControlNotice(lobby.completionReason || 'This world is complete. Create a new world to play again.','info');
      return;
    }
    if(status==='running' && lobby && lobby.canReset===false){
      setControlNotice('New World is locked while the current duel is running. End the duel first.','warn');
      return;
    }
    if(status==='lobby'){
      setControlNotice('New World creates a fresh random seed and keeps attached bots in the lobby.','info');
      return;
    }
    setControlNotice('', '');
  }

  function renderLobby(lobby, turnState){
    const required=lobby?.requiredHeroes ?? 0;
    const attached=lobby?.attachedHeroes ?? 0;
    const status=lobby?.status ?? (turnState?.started ? 'running' : 'lobby');
    $('attachedBots').textContent=required ? (attached+'/'+required) : String(attached);
    const badge=$('lobbyBadge');
    const startBtn=$('startBtn');
    const stopBtn=$('stopBtn');
    const newWorldBtn=$('newWorldBtn');
    if(status==='running'){
      badge.className='lobby-badge running';
      $('lobbyStatus').textContent='Duel running';
      startBtn.disabled=true;
      stopBtn.disabled=false;
      newWorldBtn.disabled=true;
      return;
    }
    if(status==='completed'){
      badge.className='lobby-badge completed';
      $('lobbyStatus').textContent='World completed';
      startBtn.disabled=true;
      stopBtn.disabled=true;
      newWorldBtn.disabled=!Boolean(lobby?.canReset);
      return;
    }
    const ready=Boolean(lobby?.canStart);
    badge.className='lobby-badge '+(ready?'ready':'waiting');
    $('lobbyStatus').textContent=ready ? 'Lobby ready' : 'Lobby waiting';
    startBtn.disabled=!ready;
    stopBtn.disabled=true;
    newWorldBtn.disabled=!Boolean(lobby?.canReset);
  }

  function heroClass(h){return h.status==='dead'?'dead':h.status==='escaped'?'escaped':'';}

  function renderTabs(snap){
    const ids=['overview','lobby',...(snap.heroes||[]).map(h=>h.id)];
    if(!ids.includes(selectedTab)) selectedTab='overview';
    $('tabs').innerHTML=ids.map(id=>{
      const hero=(snap.heroes||[]).find(h=>h.id===id);
      const label=id==='overview'?'Overview':id==='lobby'?'Lobby':hero.name;
      return '<button class="tab '+(selectedTab===id?'active':'')+'" data-tab="'+esc(id)+'">'+esc(label)+'</button>';
    }).join('');
    Array.from($('tabs').querySelectorAll('[data-tab]')).forEach(btn=>btn.addEventListener('click',()=>{
      selectedTab=btn.getAttribute('data-tab')||'overview';
      render(lastSnap);
    }));
  }

  function renderLobbyPanel(snap){
    const heroes=snap.heroes||[];
    const statusLabel=snap.lobby?.status === 'running' ? 'running' : snap.lobby?.status === 'completed' ? 'queued for next world' : 'waiting in lobby';
    const rows=heroes.map(h=>'<div class="row"><div><div class="name '+heroClass(h)+'">'+esc(h.name)+'</div><div class="trait">'+esc(h.trait)+' · '+esc(h.strategy)+'</div></div><div><div class="small">Status '+esc(snap.turnState?.started ? h.status : statusLabel)+'</div><div class="small">HP '+h.stats.hp+'/'+h.stats.maxHp+' · Pos ('+h.position.x+','+h.position.y+')</div></div></div>').join('')||'<div class="small">No bots attached yet.</div>';
    const required=snap.lobby?.requiredHeroes;
    const summary=required===null
      ? 'Attached '+(snap.lobby?.attachedHeroes ?? heroes.length)+' bots.'
      : 'Attached '+(snap.lobby?.attachedHeroes ?? heroes.length)+' of '+required+' required bots.';
    return '<div class="overview-grid">'
      +'<div class="card"><h2>LOBBY ROSTER</h2><div class="small" style="margin-bottom:8px">'+esc(summary)+'</div><div class="list">'+rows+'</div></div>'
      +'<div class="card"><h2>CONTROL STATE</h2><div class="hero-lines">'
      +'<div>Status: '+esc(snap.lobby?.status ?? 'lobby')+'</div>'
      +'<div>Can start: '+esc(String(Boolean(snap.lobby?.canStart)))+'</div>'
      +'<div>Can create new world: '+esc(String(Boolean(snap.lobby?.canReset)))+'</div>'
      +'<div>Turn: '+esc(String(snap.world?.turn ?? '-'))+' · Phase: '+esc(snap.turnState?.started ? snap.turnState.phase : (snap.lobby?.status ?? 'lobby'))+'</div>'
      +(snap.lobby?.completionReason?'<div class="small">'+esc(snap.lobby.completionReason)+'</div>':'')
      +'<div class="small">Start uses the current lobby world. End Duel completes that world. New World rolls a fresh random seed and keeps attached bots.</div>'
      +'</div></div>'
      +'</div>';
  }

  function renderOverview(snap){
    const heroes=(snap.heroes||[]).map(h=>'<div class="row"><div><div class="name '+heroClass(h)+'">'+esc(h.name)+'</div><div class="trait">'+esc(h.trait)+'</div></div><div><div class="score">'+h.score+' pts</div><div class="small">HP '+h.stats.hp+'/'+h.stats.maxHp+' | Kills '+h.kills+' | Explored '+h.tilesExplored+'</div><div class="small">'+esc(h.lastAction)+'</div></div></div>').join('')||'<div class="small">No heroes attached.</div>';
    const leaderboard=(snap.leaderboard||[]).map((h,i)=>'<div class="row"><span>#'+(i+1)+' <span class="name '+(h.status==='dead'?'dead':h.status==='escaped'?'escaped':'')+'">'+esc(h.heroName)+'</span></span><span class="score">'+h.totalScore+'</span></div>').join('')||'<div class="small">-</div>';
    const counts={}; for(const m of snap.monsters||[]) counts[m.kind]=(counts[m.kind]||0)+1;
    const monsters=Object.entries(counts).map(([k,v])=>'<div class="row"><span style="text-transform:capitalize">'+esc(k)+'</span><span>x'+v+'</span></div>').join('')||'<div class="small">None</div>';
    const events=(snap.recentEvents||[]).map(e=>'<div class="row"><span>T'+e.turn+' · '+esc(e.type)+'</span><span class="small">'+esc(e.summary)+'</span></div>').join('')||'<div class="small">No events yet.</div>';
    return '<div class="overview-grid">'
      +'<div class="card"><h2>LEADERBOARD</h2><div class="list">'+leaderboard+'</div></div>'
      +'<div class="card"><h2>HEROES</h2><div class="list">'+heroes+'</div></div>'
      +'<div class="card"><h2>MONSTERS</h2><div class="list">'+monsters+'</div></div>'
      +'<div class="card"><h2>EVENTS</h2><div class="list">'+events+'</div></div>'
      +'</div>';
  }

  function renderHeroPanel(hero){
    const gear=[hero.equipment.weapon,hero.equipment.armor,hero.equipment.accessory].filter(Boolean).map(g=>'<span class="pill">'+esc(g.name)+'</span>').join('')||'<span class="small">No gear</span>';
    const effects=(hero.effects||[]).map(e=>'<span class="pill">'+esc(e.kind)+' ('+e.turnsRemaining+'t)</span>').join('')||'<span class="small">No effects</span>';
    const inventory=(hero.inventory||[]).map(i=>'<span class="pill">'+esc(i.name)+'</span>').join('')||'<span class="small">Inventory empty</span>';
    return '<div class="hero-grid">'
      +'<div class="card"><h2>'+esc(hero.name).toUpperCase()+'</h2><div class="hero-lines">'
      +'<div><span class="trait">'+esc(hero.trait)+'</span></div>'
      +'<div>Position: ('+hero.position.x+', '+hero.position.y+')</div>'
      +'<div>HP '+hero.stats.hp+'/'+hero.stats.maxHp+' | ATK '+hero.stats.attack+' DEF '+hero.stats.defense+' SPD '+hero.stats.speed+' PER '+hero.stats.perception+'</div>'
      +'<div>Score '+hero.score+' | Gold '+hero.gold+' | Kills '+hero.kills+' | Explored '+hero.tilesExplored+'</div>'
      +'<div>Fatigue '+hero.fatigue+' | Morale '+hero.morale+' | Status '+esc(hero.status)+'</div>'
      +'<div>Last action: '+esc(hero.lastAction)+'</div>'
      +'<div class="small">'+esc(hero.strategy)+'</div>'
      +'</div></div>'
      +'<div class="card"><h2>LOADOUT</h2><div class="hero-lines"><div><div class="small">Gear</div>'+gear+'</div><div><div class="small">Effects</div>'+effects+'</div><div><div class="small">Inventory</div>'+inventory+'</div></div></div>'
      +'</div>';
  }

  function renderCommunications(snap){
    const messages=(snap.botMessages||[]).filter(m=>selectedTab==='overview'||selectedTab==='lobby'||m.heroId===selectedTab).slice().reverse();
    $('commTarget').textContent=(selectedTab==='overview'||selectedTab==='lobby')?'All bots':((snap.heroes||[]).find(h=>h.id===selectedTab)?.name||'Bot');
    $('commStream').innerHTML=messages.map(m=>'<div class="msg"><div class="msg-meta"><span>'+esc(m.heroName)+'</span><span>Turn '+m.turn+'</span></div><div>'+esc(m.message)+'</div></div>').join('')||'<div class="small">No bot communications yet.</div>';
  }

  function render(snap){
    if(!snap) return;
    lastSnap=snap;
    if(snap.turnState){
      snap.turnState._receivedAt=Date.now();
      snap.turnState._warmupInitialMs=Math.max(Number(snap.turnState._warmupInitialMs||0), Number(snap.turnState.warmupRemainingMs||0));
    }
    if(!snap.lobby){
      snap.lobby={attachedHeroes:(snap.heroes||[]).length,requiredHeroes:null,canStart:(snap.heroes||[]).length>0,canReset:true,status:snap.turnState?.started?'running':'lobby',started:Boolean(snap.turnState?.started)};
    }
    $('title').textContent='Neural Necropolis';
    $('boardHeadline').textContent=(snap.lobby?.boardName||snap.world?.dungeonName||'Unknown board')+' • '+(snap.lobby?.boardSlug||snap.boardSlug||snap.boardId||'no-board');
    $('turn').textContent=snap.world?.turn??'-';
    $('heroCount').textContent=(snap.heroes||[]).length;
    if(snap.turnState) renderTurnState(snap.turnState, snap.lobby);
    renderLobby(snap.lobby, snap.turnState);
    renderControlNotice(snap.turnState, snap.lobby);
    renderTabs(snap);
    const hero=(snap.heroes||[]).find(h=>h.id===selectedTab);
    const tabMarkup=selectedTab==='overview'
      ? renderOverview(snap)
      : selectedTab==='lobby'
        ? renderLobbyPanel(snap)
        : hero
          ? renderHeroPanel(hero)
          : renderOverview(snap);
    $('tabContent').innerHTML=tabMarkup;
    renderCommunications(snap);
    try{
      renderMap(snap);
    }catch(err){
      console.error(err);
      setControlNotice('Map render failed: '+(err instanceof Error ? err.message : String(err)),'error');
    }
  }

  const es=new EventSource('/api/stream');
  es.addEventListener('snapshot',e=>render(JSON.parse(e.data)));
  es.addEventListener('log',e=>console.log('[stream]',e.data));

  setInterval(()=>{
    if(lastSnap?.turnState) renderTurnState(lastSnap.turnState,lastSnap.lobby);
    if(lastSnap?.turnState) renderControlNotice(lastSnap.turnState,lastSnap.lobby);
  },250);

  $('toggleBottomBtn').addEventListener('click',()=>{
    const shell=document.querySelector('.shell');
    shell.classList.toggle('collapsed');
    $('toggleBottomBtn').textContent=shell.classList.contains('collapsed')?'▲ Expand':'▼ Collapse';
    setTimeout(()=>{ if(lastSnap) renderMap(lastSnap); }, 310);
  });

  window.addEventListener('resize',function(){ resizePixi(); if(lastSnap) renderMap(lastSnap); });

  $('startBtn').addEventListener('click',async()=>{
    if(!lastSnap?.lobby?.canStart){
      return;
    }
    const btn=$('startBtn');
    btn.disabled=true;
    setControlNotice('','');
    try{
      const res=await fetch('/api/admin/start',{method:'POST'});
      const payload=await res.json();
      if(!res.ok || payload?.ok===false) throw new Error(payload?.message || 'start failed');
      render(payload.snapshot);
    }catch(err){
      console.error(err);
      setControlNotice(err instanceof Error ? err.message : 'Failed to start the duel.','error');
    }finally{
      btn.disabled=false;
    }
  });

  $('stopBtn').addEventListener('click',async()=>{
    if(!lastSnap?.turnState?.started){
      return;
    }
    const btn=$('stopBtn');
    btn.disabled=true;
    setControlNotice('','');
    try{
      const res=await fetch('/api/admin/stop',{method:'POST'});
      const payload=await res.json();
      if(!res.ok || payload?.ok===false) throw new Error(payload?.message || 'end duel failed');
      render(payload.snapshot);
    }catch(err){
      console.error(err);
      setControlNotice(err instanceof Error ? err.message : 'Failed to end the duel.','error');
    }finally{
      btn.disabled=false;
    }
  });

  $('newWorldBtn').addEventListener('click',async()=>{
    const btn=$('newWorldBtn');
    btn.disabled=true;
    setControlNotice('','');
    try{
      const res=await fetch('/api/admin/reset',{method:'POST'});
      const payload=await res.json();
      if(!res.ok || payload?.ok===false) throw new Error(payload?.message || 'new world failed');
      render(payload.snapshot);
      setControlNotice('Fresh world created. Attached bots are in the lobby and ready to start when the roster is complete.','info');
    }catch(err){
      console.error(err);
      setControlNotice(err instanceof Error ? err.message : 'Failed to create a new world.','error');
    }finally{
      btn.disabled=false;
    }
  });

  fetch('/api/dashboard').then(r=>r.json()).then(render).catch(console.error);
  </script>
</body>
</html>`;
