/** Operations portal. Read-mostly; the only writes are logged pause switches. */
import { useState } from "react";
import { formatTokens } from "@catchami/shared";
import { api } from "../net/api.ts";

const KEY = "catchami.admin";

export function AdminPage() {
  const [token, setToken] = useState(() => { try { return sessionStorage.getItem(KEY) ?? ""; } catch { return ""; } });
  const [data, setData] = useState<any>(null);
  const [rec, setRec] = useState<any>(null);
  const [err, setErr] = useState<string | null>(null);
  const load = async (t = token) => {
    try {
      setErr(null);
      const d = await api("/api/admin/overview", undefined, { admin: t });
      setData(d);
      try { sessionStorage.setItem(KEY, t); } catch {}
    } catch (e) { setErr((e as Error).message); }
  };
  const flag = async (k: string, v: boolean) => {
    if (!confirm(`${v ? "Pause" : "Resume"} ${k.replace("pause", "")}? This is logged.`)) return;
    try { await api("/api/admin/flags", { [k]: v }, { admin: token }); await load(); } catch (e) { setErr((e as Error).message); }
  };
  const t = (v: string) => formatTokens(BigInt(v));
  if (!data) {
    return (
      <div className="admin"><div className="panel col" style={{ maxWidth: 420, margin: "10vh auto", padding: 20 }}>
        <h2>Catchami operations</h2>
        <label className="field">Admin token<input type="text" value={token} onChange={(e) => setToken(e.target.value)} /></label>
        <button className="btn" onClick={() => load()}>Open</button>
        {err && <div className="notice warn small">{err}</div>}
      </div></div>
    );
  }
  return (
    <div className="admin">
      <div className="row" style={{ marginBottom: 12 }}>
        <h2 className="grow">Operations · {data.network} · economy {data.economyVersion}</h2>
        <button className="btn sm paper" onClick={() => load()}>Refresh</button>
        <button className="btn sm" onClick={async () => setRec(await api("/api/admin/reconcile", undefined, { admin: token }))}>Run reconciliation</button>
      </div>
      {err && <div className="notice warn">{err}</div>}
      {rec && <div className={`notice ${rec.ok ? "" : "warn"}`} style={{ marginBottom: 12 }}><b>{rec.ok ? "Reconciled: ledger consistent" : "RECONCILIATION ISSUES"}</b> · onchain: {rec.onchain.status}{rec.issues.map((i: string) => <div key={i}>• {i}</div>)}</div>}
      <div className="grid">
        <div className="card">
          <h3>Treasury & obligations</h3>
          <table className="lb"><tbody>
            {data.accounts.map((a: any) => <tr key={a.id}><td style={{ width: "auto" }}>{a.id}</td><td className="num" style={{ textAlign: "right" }}>{t(a.balance)}</td></tr>)}
            {data.obligations.map((o: any) => <tr key={o.kind}><td style={{ width: "auto" }}>owed to {o.kind}s</td><td className="num" style={{ textAlign: "right" }}>{t(o.total)}</td></tr>)}
          </tbody></table>
        </div>
        <div className="card">
          <h3>Today's budget</h3>
          <dl className="kv">
            <dt>Merchant allowance</dt><dd>{t(data.treasuryDay.merchantAllowance)}</dd>
            <dt>Granted</dt><dd>{t(data.treasuryDay.merchantGranted)}</dd>
            <dt>Reward pool</dt><dd>{t(data.treasuryDay.rewardPool)}</dd>
            <dt>Paid</dt><dd>{t(data.treasuryDay.rewardPaid)}</dd>
            <dt>Treasury factor</dt><dd>{data.treasuryDay.factorBps / 100}%</dd>
          </dl>
          <h3 style={{ marginTop: 10 }}>HQ stock</h3>
          <pre>{JSON.stringify(data.hqStock, null, 1)}</pre>
        </div>
        <div className="card">
          <h3>Emergency controls</h3>
          <p className="small muted">Pauses stop new actions. They cannot move or edit balances.</p>
          {Object.entries(data.flags).map(([k, v]) => (
            <div className="row" key={k} style={{ marginBottom: 6 }}><span className="grow">{k}</span><button className={`btn sm ${v ? "coral" : "paper"}`} onClick={() => flag(k, !v)}>{v ? "Paused — resume" : "Pause"}</button></div>
          ))}
        </div>
        <div className="card"><h3>Merchants</h3><pre>{JSON.stringify(data.merchants.map((m: any) => ({ ...m, cash: t(m.cash) })), null, 1)}</pre></div>
        <div className="card"><h3>Demand indexes</h3><pre>{JSON.stringify(Object.fromEntries(Object.entries(data.demand).map(([k, v]: any) => [k, { index: v.indexBps / 100 + "%", consumedPerH: v.consumed.toFixed(1), suppliedPerH: v.supplied.toFixed(1) }])), null, 1)}</pre></div>
        <div className="card"><h3>Chain outbox (settlement queue)</h3><pre>{JSON.stringify(data.outbox, null, 1)}</pre></div>
        <div className="card"><h3>Catches (24h)</h3><pre>{JSON.stringify(data.catches, null, 1)}</pre><h3>Suspicious captures</h3><pre>{JSON.stringify(data.suspicious, null, 1)}</pre></div>
        <div className="card"><h3>Marketplace trades</h3><pre>{JSON.stringify(data.trades, null, 1)}</pre></div>
        <div className="card"><h3>Admin log</h3><pre>{JSON.stringify(data.adminLog, null, 1)}</pre></div>
      </div>
    </div>
  );
}
