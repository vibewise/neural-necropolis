import { startStaticDashboardServer } from "./static-server.mjs";

const { origin } = await startStaticDashboardServer();

console.log(`[dashboard-static] serving standalone dashboard at ${origin}`);
console.log(
  `[dashboard-static] use ${origin}/?server=http://127.0.0.1:3000 to point it at a target game server`,
);
