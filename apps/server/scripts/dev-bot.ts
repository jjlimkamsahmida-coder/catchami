/**
 * DEV TOOL: a second player for testing live PvP locally. Connects with a
 * session token, accepts Bubble Roulette invites and takes its turns.
 *   node apps/server/scripts/dev-bot.ts <token> [ws-url] [seconds]
 */
import WebSocket from "ws";

const [token, url = "ws://127.0.0.1:8797/ws", secs = "120"] = process.argv.slice(2);
if (!token) { console.error("usage: dev-bot.ts <token> [ws-url] [seconds]"); process.exit(1); }
const ws = new WebSocket(`${url}?token=${encodeURIComponent(token)}`);
let acted = 0;
ws.on("open", () => console.log("bot connected"));
let parked = false;
ws.on("message", (raw) => {
  const m = JSON.parse(String(raw));
  // Park the bot's pet at the castle plaza (autopilot off) so a tester can walk up to it.
  if (m.t === "own" && !parked && m.pets[0]) {
    parked = true;
    const p = m.pets[0];
    ws.send(JSON.stringify({ t: "strategy", petId: p.id, strategy: { ...p.strategy, auto: false, battle: "balanced" } }));
    ws.send(JSON.stringify({ t: "select", petId: p.id }));
    ws.send(JSON.stringify({ t: "goto", x: 46 * 32 + 16, y: 30 * 32 + 16 })); // forest trail (battles are off in the village)
    console.log("parking", p.name, "on the forest trail");
  }
  if (m.t === "br_invite") { console.log("invite from", m.from.name, "→ accepting"); setTimeout(() => ws.send(JSON.stringify({ t: "br_respond", matchId: m.matchId, accept: true })), 1500); }
  if (m.t === "br_state") {
    const s = m.match;
    console.log(`state=${s.state} turn=${s.turn}#${s.turnNo} you=${s.you} hp a=${s.a.battleHp} b=${s.b.battleHp} slots=${s.slotsLeft} splashes=${s.splashesLeft}${s.last ? ` last:${s.last.by}->${s.last.target} ${s.last.loaded ? "SPLASH" : "puff"}` : ""}${s.winner ? ` winner=${s.winner}` : ""} ${s.reason}`);
    if (s.state === "active" && s.turn === s.you && acted !== s.turnNo) {
      acted = s.turnNo;
      setTimeout(() => ws.send(JSON.stringify({ t: "br_action", matchId: s.id, target: "opponent", turnNo: s.turnNo })), 2500);
    }
  }
  if (m.t === "error") console.log("error:", m.message);
});
setTimeout(() => { ws.close(); process.exit(0); }, Number(secs) * 1000);
