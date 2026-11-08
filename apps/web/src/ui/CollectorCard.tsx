/**
 * Catchami collector card — original frame design. Rarity drives the frame
 * colour and the holo foil (Rare and above). Tilts toward the pointer.
 */
import { useRef, useState, type CSSProperties } from "react";
import { RARITY_LABEL, SPECIES_AFFINITY, TRAITS, type OwnPet, type PetLook, type Rarity, type Species, type Stats } from "@catchami/shared";
import { PetArt } from "./common.tsx";

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
}

export function cardFromPet(p: OwnPet): CardData {
  return { id: p.id, name: p.name, species: p.species, rarity: p.rarity, sticker: p.sticker, look: p.look, stats: p.baseStats, traits: p.traits };
}

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
    width, height: width * 1.36, fontSize: 14 * k,
    transform: `perspective(900px) rotateX(${tilt.x}deg) rotateY(${tilt.y}deg)`,
  } as CSSProperties;
  return (
    <div ref={ref} className={`ccard ${card.rarity} ${holo ? "holo" : ""} ${flipIn ? "flip-in" : ""}`} style={style}
      onPointerMove={onMove} onPointerLeave={() => setTilt({ x: 0, y: 0, mx: 50, my: 50 })}>
      <div className="ccard-inner">
        <div className="ccard-head">
          <span className="ccard-name">{card.name}</span>
          {card.stats && <span className="ccard-hp"><small>HP</small>{card.stats.maxHp}</span>}
        </div>
        <div className={`ccard-art ${card.species}`}>
          <div className="ccard-rays" />
          <div className="ccard-sticker"><PetArt sticker={card.sticker} species={card.species} look={card.look} /></div>
        </div>
        <div className="ccard-type">
          <span className="ccard-species">{card.species === "cat" ? "Cat" : "Dog"}</span>
          {card.traits?.map((t) => <span key={t} className="ccard-trait">{TRAITS.find((x) => x.id === t)?.label ?? t}</span>)}
        </div>
        <div className="ccard-stats">
          {card.stats ? STAT_ROWS.map(([key, label, max]) => (
            <div key={key} className="ccard-stat">
              <span>{label}</span>
              <i><b style={{ width: `${Math.min(100, (card.stats![key] / max) * 100)}%` }} /></i>
              <em>{card.stats![key]}</em>
            </div>
          )) : <div className="ccard-hidden">Attributes are private to the owner</div>}
        </div>
        <div className="ccard-flavor">
          Talent: {Object.keys(SPECIES_AFFINITY[card.species]).map((r) => RES_LABEL[r]).join(" & ")}
          {card.traits?.length ? " · " + card.traits.map((t) => TRAITS.find((x) => x.id === t)?.label ?? t).join(", ") : ""}
        </div>
        <div className="ccard-foot">
          <span className="ccard-gems">{Array.from({ length: GEMS[card.rarity] }, (_, i) => <i key={i} />)}</span>
          <span className="ccard-rarity">{RARITY_LABEL[card.rarity]}</span>
          <span className="ccard-serial">#{card.id.replace(/^pet_/, "").slice(0, 6).toUpperCase()}</span>
        </div>
      </div>
      {holo && <div className="ccard-foil" />}
    </div>
  );
}
