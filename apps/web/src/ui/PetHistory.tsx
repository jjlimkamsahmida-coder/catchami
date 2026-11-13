/**
 * Pet Profile → 📜 History: every coin that went into or out of this pet's
 * piggy bank (sales, meals, medicine, gear, battles, transfers), newest first,
 * with totals for today and for everything shown.
 */
import { RESOURCE_LABEL, RESOURCES, type OwnPet } from "@catchami/shared";
import { api } from "../net/api.ts";
import { fmt, useAsync } from "./common.tsx";

type Row = { id: string; kind: string; amount: string; created_at: string; meta: Record<string, unknown> | null };

const parseTime = (iso: string) => new Date(iso.replace(" ", "T").replace(/([+-]\d{2})$/, "$1:00"));
function ago(iso: string) {
  const t = parseTime(iso).getTime();
  if (!Number.isFinite(t)) return "";
  const s = Math.max(0, (Date.now() - t) / 1000);
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}

/** Emoji, label and an optional detail line for a ledger row, from the pet's point of view. */
function describe(r: Row): [string, string, string] {
  const m = r.meta ?? {};
  const won = !r.amount.startsWith("-");
  switch (r.kind) {
    case "sale": {
      const sold = (m.sold ?? {}) as Record<string, number>;
      const what = RESOURCES.filter((k) => sold[k]).map((k) => `${sold[k]} ${RESOURCE_LABEL[k].toLowerCase()}`).join(", ");
      return ["🪙", "Sold to a merchant", what];
    }
    case "food": return ["🍖", m.imported ? "Imported meal" : "Meal", ""];
    case "medicine": return ["💊", m.imported ? "Imported medicine" : "Medicine", ""];
    case "craft": return ["🛠️", "Crafted gear", typeof m.kind === "string" ? m.kind.replace("_", " ") : ""];
    case "battle_win": return won ? ["🏆", "Won Bubble Roulette", "spoils"] : ["💦", "Lost Bubble Roulette", "the winner took a share"];
    case "catch_success": return ["🎯", "Starting purse", "from the catch"];
    case "pet_fund": return ["🐾", "From your wallet", ""];
    case "pet_withdraw": return ["👛", "To your wallet", ""];
    case "reward": return ["🎁", "Daily reward", ""];
    case "pet_fund_test": return ["🧪", "Test coins", ""];
    default: return ["🔸", r.kind.replace(/_/g, " "), ""];
  }
}

export function PetHistoryTab({ p }: { p: OwnPet }) {
  const h = useAsync(() => api(`/api/pets/${p.id}/history`), [p.id, p.balance]);
  const rows: Row[] = h.data?.items ?? [];
  const day = new Date().toISOString().slice(0, 10);
  const sum = (list: Row[], sign: 1 | -1) => list.reduce((s, r) => { const v = BigInt(r.amount); return (sign > 0 ? v > 0n : v < 0n) ? s + (v < 0n ? -v : v) : s; }, 0n);
  const todays = rows.filter((r) => parseTime(r.created_at).toISOString().slice(0, 10) === day);
  return (
    <div className="col" style={{ gap: 12 }}>
      <div className="flow-sum">
        <div className="in"><small>Earned today</small><b>+{fmt(sum(todays, 1))}</b></div>
        <div className="out"><small>Spent today</small><b>−{fmt(sum(todays, -1))}</b></div>
        <div className="bal"><small>Piggy bank</small><b>{fmt(p.balance)}</b></div>
      </div>
      <div className="card col">
        <h3>📜 Coin history</h3>
        {h.loading && !rows.length && <p className="muted small" style={{ margin: 0 }}>Loading…</p>}
        {!h.loading && !rows.length && <p className="muted small" style={{ margin: 0 }}>No coins moved yet — go sell something!</p>}
        <ul className="vault-feed">
          {rows.map((r) => {
            const [ico, label, detail] = describe(r);
            const neg = r.amount.startsWith("-");
            return (
              <li key={r.id}>
                <span className="vf-ico">{ico}</span>
                <span className="vf-what"><b>{label}</b><small>{[detail, ago(r.created_at)].filter(Boolean).join(" · ")}</small></span>
                <span className={`vf-amt ${neg ? "neg" : "pos"}`}>{neg ? "−" : "+"}{fmt(r.amount.replace("-", ""))}</span>
              </li>
            );
          })}
        </ul>
        {rows.length >= 100 && <p className="muted small" style={{ margin: 0 }}>Showing the latest 100 entries.</p>}
      </div>
    </div>
  );
}
