/**
 * Catchami collector card — original frame design. Rarity drives the frame
 * colour and the holo foil (Rare and above). Tilts toward the pointer.
 */
import { useRef, useState, type CSSProperties } from "react";
import { formatTokens, RARITY_LABEL, SPECIES_AFFINITY, TRAITS, type OwnPet, type PetLook, type Rarity, type Species, type Stats } from "@catchami/shared";
import { PetArt } from "./common.tsx";
import { genUrl } from "../game/assets.ts";

const FRAME: Record<Rarity, { a: string; b: string; ink: string }> = {
  common: { a: "#f3ead9", b: "#d9ccb4", ink: "#6b5e52" },
  uncommon: { a: "#b8eb9a", b: "#5fbf4f", ink: "#2f6b2a" },
  rare: { a: "#9fd5ff", b: "#3d9ef0", ink: "#1d4f86" },
  epic: { a: "#dcc2ff", b: "#a66bf2", ink: "#55308f" },
  legendary: { a: "#ffe7a1", b: "#f0a91c", ink: "#8a5a06" },
  mythic: { a: "#ffd1ec", b: "#f0569c", ink: "#86204f" },
};
const GEMS: Record<Rarity, number> = { common: 1, uncommon: 2, rare: 3, epic: 4, legendary: 5, mythic: 6 };
const STAT_ROWS: Array<[keyof Stats, string, number]> = [
  ["attack", "ATK", 130], ["defense", "DEF", 130], ["speed", "SPD", 130], ["luck", "LCK", 130], ["gather", "GTH", 130], ["carry", "CRY", 85], ["maxEnergy", "EN", 1200],
];
const RES_LABEL: Record<string, string> = { fish: "fishing", herbs: "herbs", wood: "wood", minerals: "mining" };

export interface CardData {
  id: string;
  name: string;
  species: Species;
  rarity: Rarity;
  sticker: string | null;
  look: PetLook;
  stats?: Stats | null;
  traits?: string[];
  /** Pet's own token balance (wire amount), shown as its piggy bank. */
  balance?: string | null;
}

export function cardFromPet(p: OwnPet): CardData {
  return { id: p.id, name: p.name, species: p.species, rarity: p.rarity, sticker: p.sticker, look: p.look, stats: p.baseStats, traits: p.traits, balance: p.balance };
}

/** Two signature moves per species; damage is derived from the pet's real attack/luck stats. */
const MOVES: Record<Species, Array<{ name: string; cost: number; dmg: (s: Stats) => number; text: string }>> = {
  cat: [
    { name: "Pounce", cost: 1, dmg: (s) => Math.round(s.attack / 5) * 1, text: "Quick as a whisker." },
    { name: "Lucky Swipe", cost: 2, dmg: (s) => Math.round((s.attack + s.luck) / 5), text: "Flip a coin. Heads: +10." },
  ],
  dog: [
    { name: "Tackle", cost: 1, dmg: (s) => Math.round(s.attack / 5), text: "A big friendly bump." },
    { name: "Loyal Guard", cost: 2, dmg: (s) => Math.round((s.attack + s.defense) / 5), text: "Takes 10 less damage next turn." },
  ],
};
/** Type energy symbol: a paw in a coloured circle (orange for cats, blue for dogs). */
const Paw = () => <svg viewBox="0 0 24 24" aria-hidden><circle cx="12" cy="15.5" r="4.6" /><circle cx="6.2" cy="10" r="2.3" /><circle cx="10" cy="6.2" r="2.3" /><circle cx="14" cy="6.2" r="2.3" /><circle cx="17.8" cy="10" r="2.3" /></svg>;

export function CollectorCard({ card, width = 300, flipIn = false }: { card: CardData; width?: number; flipIn?: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  const [tilt, setTilt] = useState({ x: 0, y: 0, mx: 50, my: 50 });
  const f = FRAME[card.rarity];
  const holo = GEMS[card.rarity] >= 3;
  const k = width / 300;
  const onMove = (e: React.PointerEvent) => {
    const r = ref.current!.getBoundingClientRect();
    const px = (e.clientX - r.left) / r.width, py = (e.clientY - r.top) / r.height;
    setTilt({ x: (py - 0.5) * -14, y: (px - 0.5) * 18, mx: px * 100, my: py * 100 });
  };
  const style = {
    "--fa": f.a, "--fb": f.b, "--fi": f.ink, "--mx": `${tilt.mx}%`, "--my": `${tilt.my}%`,
    width, height: width * 1.4, fontSize: 14 * k,
    transform: `perspective(900px) rotateX(${tilt.x}deg) rotateY(${tilt.y}deg)`,
  } as CSSProperties;
  const traitNames = card.traits?.map((t) => TRAITS.find((x) => x.id === t)?.label ?? t) ?? [];
  return (
    <div ref={ref} className={`tcard ${card.rarity} ${holo ? "holo" : ""} ${flipIn ? "flip-in" : ""}`} style={style}
      onPointerMove={onMove} onPointerLeave={() => setTilt({ x: 0, y: 0, mx: 50, my: 50 })}>
      <div className="tcard-inner">
        <div className="tcard-head">
          <span className="tcard-stage">BASIC</span>
          <span className="tcard-name">{card.name}</span>
          {card.stats && <span className="tcard-hp"><small>HP</small>{Math.round(card.stats.maxHp / 10)}</span>}
          <span className={`tcard-type ${card.species}`}><Paw /></span>
        </div>
        <div className={`tcard-art ${card.species}`}>
          <div className="tcard-rays" />
          <div className="tcard-sticker"><PetArt sticker={card.sticker} species={card.species} look={card.look} /></div>
          <span className="tcard-gems">{Array.from({ length: GEMS[card.rarity] }, (_, i) => <i key={i} />)}</span>
        </div>
        <div className="tcard-strip">{card.species === "cat" ? "Cat" : "Dog"} Pet · {traitNames.join(" · ") || "Catchami friend"}</div>
        <div className="tcard-moves">
          {card.stats ? MOVES[card.species].map((m) => (
            <div className="tcard-move" key={m.name}>
              <span className="tcard-cost">{Array.from({ length: m.cost }, (_, i) => <i key={i} className={card.species}><Paw /></i>)}</span>
              <span className="tcard-mname"><b>{m.name}</b><small>{m.text}</small></span>
              <span className="tcard-dmg">{m.dmg(card.stats!)}</span>
            </div>
          )) : <div className="tcard-hidden">Moves are private to the owner</div>}
        </div>
        {card.balance != null && (
          <div className="tcard-bank" data-bank>
            <img src={genUrl("ui-coin")} alt="" />
            <span>Piggy bank</span>
            <b className="num">{formatTokens(BigInt(card.balance))}</b>
          </div>
        )}
        <div className="tcard-foot">
          <span>Talent: {Object.keys(SPECIES_AFFINITY[card.species]).map((r) => RES_LABEL[r]).join(" & ")}</span>
          <span className="tcard-rarity">{RARITY_LABEL[card.rarity]}</span>
          <span className="tcard-serial">#{card.id.replace(/^pet_/, "").slice(0, 6).toUpperCase()}</span>
        </div>
      </div>
      {holo && <div className="ccard-foil" />}
    </div>
  );
}
