// Prints the compact world state from the director.
const r = await fetch("http://127.0.0.1:9400", { method: "POST", body: JSON.stringify([{ op: "state" }]) }).then((x) => x.json());
if (!r.ok) { console.log(r.error); process.exit(1); }
const v = r.out[0].value;
const skip = ["keeper", "chef", "nurse", "smith"];
console.log("me", JSON.stringify(v.me), "st", v.me_st, "pets", v.pets);
console.log("nodes", v.nodes.map((n) => `${n.id}@${n.x},${n.y} d${n.d}`).join(" | "));
console.log("merchants", v.merchants.filter((m) => !skip.includes(m.id)).map((m) => `${m.id}@${m.x},${m.y} d${m.d} ${m.state}`).join(" | "));
console.log("bandits", JSON.stringify(v.bandits).slice(0, 400));
console.log("toasts", v.toasts.join(" / "));
