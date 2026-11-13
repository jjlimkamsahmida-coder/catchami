/**
 * "How the economy works" — a playful explainer. Every number comes from the
 * live ECONOMY config, so the guide can't drift from the real rules.
 */
import { useEffect } from "react";
import { BUBBLE, ECONOMY, formatTokens, MINIGAMES, tokens } from "@catchami/shared";

const g = (k: string) => `/assets/gen/${k}.png`;
const pct = (bps: number) => `${bps / 100}%`;
const t = (v: bigint) => formatTokens(v);

export function EconomyGuide({ onClose }: { onClose: () => void }) {
  useEffect(() => { const k = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); }; window.addEventListener("keydown", k); return () => window.removeEventListener("keydown", k); }, [onClose]);
  const c = ECONOMY.catch;
  const split = c.successSplit;
  return (
    <div className="howto-backdrop" onClick={onClose}>
      <div className="econ panel" onClick={(e) => e.stopPropagation()}>
        <button className="econ-x" onClick={onClose} aria-label="Close">×</button>
        <img className="econ-hero" src={g("ui-coin")} alt="" />
        <h2>How the economy works</h2>
        <p className="econ-lead">Every coin in Catchami comes from somewhere and goes somewhere. Nothing is printed out of thin air — here's the whole loop in six bites.</p>

        <section className="econ-step">
          <span className="econ-num">1</span>
          <div className="econ-art"><img src={g("cube-excited")} alt="" /></div>
          <div>
            <h3>Throw a CamiCube</h3>
            <p>Catching a real cat or dog costs <b>{t(c.tiers.basic.cost)}</b>, <b>{t(c.tiers.enhanced.cost)}</b> or <b>{t(c.tiers.premium.cost)}</b> $CATCHAMI ({c.tiers.basic.successPpm / 10_000}% / {c.tiers.enhanced.successPpm / 10_000}% / {c.tiers.premium.successPpm / 10_000}% catch chance).</p>
            <div className="econ-split">
              <span style={{ flex: split.pet }} className="s pet">{pct(split.pet)}</span>
              <span style={{ flex: Math.max(split.hq, 1800) }} className="s hq">{pct(split.hq)}</span>
              <span style={{ flex: Math.max(split.team, 1000) }} className="s team">{pct(split.team)}</span>
            </div>
            <div className="econ-legend"><span><i className="pet" />your pet's piggy bank</span><span><i className="hq" />HQ</span><span><i className="team" />team</span></div>
            <p className="econ-note">Missed throw or "not an animal"? Free. Real animal but it wriggles away? The coins go to HQ, which pays them back out to players.</p>
          </div>
        </section>

        <section className="econ-step">
          <span className="econ-num">2</span>
          <div className="econ-art"><img src={g("icon-herbs")} alt="" /><img src={g("icon-wood")} alt="" /></div>
          <div>
            <h3>Your pet goes to work</h3>
            <p>Gather fish, herbs, wood and minerals. Nail the minigame for <b>×{MINIGAMES.yield.perfect}</b>, a good tap gives ×{MINIGAMES.yield.good}. Spots run dry and regrow, and bags fill up — so there's always only so much to go around.</p>
          </div>
        </section>

        <section className="econ-step">
          <span className="econ-num">3</span>
          <div className="econ-art"><img src={g("merchant-finn")} alt="" /></div>
          <div>
            <h3>Sell to travelling merchants</h3>
            <p>Merchants wander the world with a real coin purse from HQ. Prices follow <b>demand</b>: when lots of pets eat, fish gets pricier; when everyone sells wood, wood gets cheaper. A merchant with an empty purse or a full cart heads home to restock.</p>
          </div>
        </section>

        <section className="econ-step">
          <span className="econ-num">4</span>
          <div className="econ-art"><img src={g("icon-fish")} alt="" /><img src={g("prop-crate")} alt="" /></div>
          <div>
            <h3>Keep your pet happy</h3>
            <p>Meals cost <b>{t(ECONOMY.food.price)}</b>, medicine <b>{t(ECONOMY.medicine.price)}</b>, gear needs wood + minerals + a fee. That money flows back to HQ (90%) and the team (10%). Meals only exist if merchants delivered real fish — no fish in the kitchen, no meal!</p>
          </div>
        </section>

        <section className="econ-step">
          <span className="econ-num">5</span>
          <div className="econ-art"><img src={g("prop-castle")} alt="" /></div>
          <div>
            <h3>HQ, the big piggy bank</h3>
            <p>HQ started with <b>{t(tokens(ECONOMY.allocation.hqWhole))}</b>. Each day it may spend just <b>{pct(ECONOMY.hq.dailyBudgetBpsOfAvailable)}</b> of what it holds — {pct(ECONOMY.hq.merchantShareBps)} for merchants, {pct(ECONOMY.hq.rewardShareBps)} for daily rewards. If HQ ever gets close to its safety floor ({pct(ECONOMY.hq.reserveFloorBps)} of the start), spending shrinks automatically instead of inventing coins.</p>
          </div>
        </section>

        <section className="econ-step">
          <span className="econ-num">6</span>
          <div className="econ-art"><img src={g("cube-wobble")} alt="" /><img src={g("ui-trophy")} alt="" /></div>
          <div>
            <h3>Trade &amp; play</h3>
            <p>Sell a pet or gear on the market — its piggy bank goes with it. The market keeps a {pct(ECONOMY.marketplace.feeBps)} fee. Bubble Roulette uses HP as the score ({BUBBLE.splashHp} per splash) and puts <b>no coins at stake</b>.</p>
          </div>
        </section>

        <div className="econ-facts">
          <div><b>{t(tokens(100_000_000_000_000))}</b><span>total coins, ever. No minting.</span></div>
          <div><b>40 / 55 / 5</b><span>HQ / market / team split at launch</span></div>
          <div><b>Fair rolls</b><span>every catch & reward is checkable afterwards</span></div>
        </div>
        <button className="game-btn start" style={{ minHeight: 66, fontSize: 26 }} onClick={onClose}><span className="gb-label">Got it!</span></button>
      </div>
    </div>
  );
}
