import Phaser from "phaser";
import { AREA_BOUNDS, areaAt, decodeTiles, generateWorld, PROP_SIZE, RARITY_LABEL, T, type BattleEvent, type Prop, type Resource, type WorldDef } from "@catchami/shared";
import { entities, store, type PetEntity } from "../net/store.ts";
import { send, serverNow } from "../net/api.ts";
import * as art from "./art.ts";
import { DECAL_KINDS, drawProp, paintChunk, windmillBlades } from "./world-art.ts";
import { ALL_SPRITES, genUrl, loadTextures, MERCHANT_ART, MERCHANT_HEIGHT, NODE_WIDTH, PROP_ART } from "./assets.ts";

const TILE = 32;
const INTERP_DELAY = 140;
const CHUNK_W = 24, CHUNK_H = 18;
const RARITY_COLOR: Record<string, number> = { common: 0xffffff, uncommon: 0x7ee081, rare: 0x5ab8ff, epic: 0xc28bff, legendary: 0xffc24b, mythic: 0xff6fb5 };

interface PetSprite { root: Phaser.GameObjects.Container; body: Phaser.GameObjects.Image; shadow: Phaser.GameObjects.Image; label: Phaser.GameObjects.Text; ring: Phaser.GameObjects.Graphics; tex: string; phase: number; hurtUntil: number; lungeUntil: number; lungeDir: number }

export class GameScene extends Phaser.Scene {
  private pets = new Map<string, PetSprite>();
  private merchants = new Map<string, Phaser.GameObjects.Container>();
  private nodes = new Map<string, { img: Phaser.GameObjects.Image; badge: Phaser.GameObjects.Text; res: Resource; depleted: boolean }>();
  private built = false;
  private keys: Record<string, Phaser.Input.Keyboard.Key> = {};
  private lastMove = 0;
  private moving = false;
  private unsub: (() => void) | null = null;
  private overrides = new Set<string>();

  constructor() { super("world"); }

  preload() {
    // Final art overrides: any key listed in /assets/manifest.json replaces the procedural placeholder.
    this.load.json("manifest", "/assets/manifest.json");
    this.load.once("filecomplete-json-manifest", (_k: string, _t: string, data: Record<string, string>) => {
      for (const [key, file] of Object.entries(data ?? {})) { this.load.image(key, `/assets/${file}`); this.overrides.add(key); }
    });
    this.load.on("loaderror", () => {});
    for (const key of ALL_SPRITES) this.load.image(key, genUrl(key));
  }

  create() {
    const tex = (key: string, c: HTMLCanvasElement) => { if (!this.textures.exists(key)) this.textures.addCanvas(key, c); };
    tex("shadow", art.shadow());
    tex("sparkle", art.sparkle());
    tex("blades", windmillBlades());
    for (const r of ["fish", "herbs", "wood", "minerals"] as const) {
      if (!this.textures.exists(`node-${r}`)) tex(`node-${r}`, art.resourceNode(r, false));
      if (!this.textures.exists(`node-${r}-empty`)) tex(`node-${r}-empty`, art.resourceNode(r, true));
      tex(`icon-${r}`, art.resourceIcon(r));
    }
    this.cameras.main.setBackgroundColor("#4cb3e6");
    this.cameras.main.roundPixels = false;
    this.scale.on("resize", () => this.fitZoom());
    this.fitZoom();

    if (this.input.keyboard) {
      this.keys = this.input.keyboard.addKeys("W,A,S,D,UP,DOWN,LEFT,RIGHT") as Record<string, Phaser.Input.Keyboard.Key>;
    }
    this.input.on("wheel", (_p: Phaser.Input.Pointer, _o: unknown, _dx: number, dy: number) => {
      this.onZoom(new CustomEvent("z", { detail: { factor: dy > 0 ? 0.9 : 1.1 } }));
    });
    this.input.on("pointerup", (p: Phaser.Input.Pointer, over: Phaser.GameObjects.GameObject[]) => {
      if (over.length || p.getDistance() > 12) return;
      const wp = this.cameras.main.getWorldPoint(p.x, p.y);
      send({ t: "goto", x: wp.x, y: wp.y });
      this.tapMarker(wp.x, wp.y);
    });
    this.unsub = store.subscribe(() => { if (!this.built && store.get().map) this.buildWorld(); });
    if (store.get().map) this.buildWorld();
    window.addEventListener("catchami:battle", this.onBattle as EventListener);
    window.addEventListener("catchami:joystick", this.onJoystick as EventListener);
    window.addEventListener("catchami:focus", this.onFocus as EventListener);
    window.addEventListener("catchami:zoom", this.onZoom as EventListener);
    window.addEventListener("catchami:gathered", this.onGathered as EventListener);
    this.events.once("destroy", () => {
      window.removeEventListener("catchami:zoom", this.onZoom as EventListener);
      window.removeEventListener("catchami:gathered", this.onGathered as EventListener);
      this.unsub?.();
      window.removeEventListener("catchami:battle", this.onBattle as EventListener);
      window.removeEventListener("catchami:joystick", this.onJoystick as EventListener);
      window.removeEventListener("catchami:focus", this.onFocus as EventListener);
    });
  }

  /** User zoom multiplier (mouse wheel / +/- keys), applied on top of the screen-fit zoom. */
  private userZoom = 1;
  private fitZoom() {
    const { width, height } = this.scale;
    const base = Phaser.Math.Clamp(Math.min(width, height) / 520, 0.85, 1.7);
    this.cameras.main.setZoom(Phaser.Math.Clamp(base * this.userZoom, 0.5, 2.4));
  }
  private onZoom = (e: CustomEvent<{ factor: number }>) => {
    this.userZoom = Phaser.Math.Clamp(this.userZoom * e.detail.factor, 0.55, 1.8);
    this.fitZoom();
  };

  private world: WorldDef | null = null;
  private decals: Prop[] = [];
  private chunks = new Map<string, Phaser.GameObjects.Image>();
  private chunkSeq = 0;
  private lastArea = "";
  private groundTex: Awaited<ReturnType<typeof loadTextures>> = {};

  private buildWorld() {
    const s = store.get();
    if (!s.map) return;
    this.built = true;
    // Props, areas and decals come from the same deterministic world definition the server uses.
    const world = generateWorld();
    world.tiles = decodeTiles(s.map.tiles); // server tiles are authoritative
    this.world = world;
    void loadTextures().then((t) => {
      this.groundTex = t;
      if (Object.keys(t).length) { for (const img of this.chunks.values()) { const key = img.texture.key; img.destroy(); this.textures.remove(key); } this.chunks.clear(); }
    });
    this.decals = world.props.filter((p) => DECAL_KINDS.has(p.kind) && !(PROP_ART[p.kind] && this.textures.exists(PROP_ART[p.kind]!.keys[0]!)));
    const W = world.w * TILE, H = world.h * TILE;
    this.cameras.main.setBounds(-160, -160, W + 320, H + 320);

    // Animated water glints (capped for phones).
    const rng = new Phaser.Math.RandomDataGenerator(["catchami"]);
    let glints = 0;
    for (let i = 0; i < world.tiles.length && glints < 420; i++) {
      if (world.tiles[i] !== T.water || rng.frac() > 0.1) continue;
      glints++;
      const x = (i % world.w) * TILE + 16, y = Math.floor(i / world.w) * TILE + 16;
      const sp = this.add.image(x, y, "sparkle").setAlpha(0).setDepth(-900);
      this.tweens.add({ targets: sp, alpha: { from: 0, to: 0.8 }, x: x + 6, duration: 1400 + rng.between(0, 900), yoyo: true, repeat: -1, delay: rng.between(0, 4000), ease: "Sine.easeInOut" });
    }

    for (const p of world.props) {
      const genArt = PROP_ART[p.kind];
      const genKey = genArt ? genArt.keys[p.v % genArt.keys.length]! : null;
      const useGen = !!genKey && this.textures.exists(genKey);
      if (DECAL_KINDS.has(p.kind) && !useGen) continue;
      const size = PROP_SIZE[p.kind];
      let key = `proc-${p.kind}-${p.v % 4}`;
      if (useGen) key = genKey!;
      else if (!this.textures.exists(key)) this.textures.addCanvas(key, drawProp(p.kind, p.v % 4));
      const x = (p.tx + size.w / 2) * TILE, y = (p.ty + size.h) * TILE;
      const img = this.add.image(x, y, key).setOrigin(0.5, 1);
      if (useGen) { const src = this.textures.get(key).getSourceImage(); img.setScale(genArt!.width / src.width); img.y += 6; }
      img.setDepth(y - 4);
      if (p.kind === "tree" || p.kind === "pine") this.tweens.add({ targets: img, angle: { from: -1.2, to: 1.2 }, duration: 2400 + (p.tx * 37) % 900, yoyo: true, repeat: -1, ease: "Sine.easeInOut" });
      if (p.kind === "windmill" && !useGen) {
        const bl = this.add.image(x, y - 120, "blades").setDepth(y - 3);
        this.tweens.add({ targets: bl, angle: 360, duration: 9000, repeat: -1 });
      }
      if (p.kind === "portal" || p.kind === "glowcrystal" || p.kind === "lamp") this.tweens.add({ targets: img, alpha: { from: 1, to: 0.8 }, duration: 1300 + (p.tx % 5) * 200, yoyo: true, repeat: -1, ease: "Sine.easeInOut" });
      if (p.kind === "banner") this.tweens.add({ targets: img, scaleX: { from: 1, to: 0.92 }, duration: 900, yoyo: true, repeat: -1, ease: "Sine.easeInOut" });
    }

    for (const n of s.nodesDef) {
      const x = n.tx * TILE + 16, y = n.ty * TILE + 30;
      const img = this.add.image(x, y + 4, `node-${n.resource}`).setOrigin(0.5, 1).setDepth(y).setInteractive({ useHandCursor: true });
      this.fitNode(img);
      img.on("pointerup", () => store.set({ sheet: { kind: "node", id: n.id } }));
      const badge = this.add.text(x, y - 58, "", { fontFamily: "Fredoka", fontSize: "13px", color: "#2b1d3a", backgroundColor: "#fff6e5", padding: { x: 5, y: 1 } }).setOrigin(0.5).setDepth(9000).setAlpha(0);
      this.nodes.set(n.id, { img, badge, res: n.resource, depleted: false });
    }
    const hq = s.hq!;
    this.cameras.main.centerOn(hq.tx * TILE, (hq.ty + 4) * TILE);
    window.dispatchEvent(new CustomEvent("catchami:world", { detail: world }));
  }

  /** Paint map chunks around the camera; drop far ones. One new chunk per frame keeps frames smooth. */
  private streamChunks() {
    if (!this.world) return;
    const v = this.cameras.main.worldView;
    const CW = CHUNK_W * TILE, CH = CHUNK_H * TILE;
    const cx0 = Math.max(0, Math.floor((v.x - CW / 2) / CW)), cx1 = Math.min(Math.ceil(this.world.w / CHUNK_W) - 1, Math.floor((v.right + CW / 2) / CW));
    const cy0 = Math.max(0, Math.floor((v.y - CH / 2) / CH)), cy1 = Math.min(Math.ceil(this.world.h / CHUNK_H) - 1, Math.floor((v.bottom + CH / 2) / CH));
    const want = new Set<string>();
    for (let cy = cy0; cy <= cy1; cy++) for (let cx = cx0; cx <= cx1; cx++) want.add(`${cx},${cy}`);
    for (const [k, img] of this.chunks) if (!want.has(k)) {
      const [cx, cy] = k.split(",").map(Number);
      const far = cx! < cx0 - 1 || cx! > cx1 + 1 || cy! < cy0 - 1 || cy! > cy1 + 1;
      if (far) { const key = img.texture.key; img.destroy(); this.textures.remove(key); this.chunks.delete(k); }
    }
    const missing = [...want].filter((k) => !this.chunks.has(k));
    for (const k of missing.slice(0, 3)) this.paintChunkKey(k);
  }

  private paintChunkKey(k: string) {
    if (!this.world) return;
    const CW = CHUNK_W * TILE, CH = CHUNK_H * TILE;
    const [cx, cy] = k.split(",").map(Number);
    const canvas = paintChunk(this.world, cx! * CHUNK_W, cy! * CHUNK_H, Math.min(CHUNK_W, this.world.w - cx! * CHUNK_W), Math.min(CHUNK_H, this.world.h - cy! * CHUNK_H), this.decals, this.groundTex);
    const key = `chunk:${k}:${++this.chunkSeq}`;
    this.textures.addCanvas(key, canvas);
    this.chunks.set(k, this.add.image(cx! * CW, cy! * CH, key).setOrigin(0).setDepth(-1000));
  }

  private fitNode(img: Phaser.GameObjects.Image) {
    const src = this.textures.get(img.texture.key).getSourceImage();
    img.setScale(src.width > 120 ? NODE_WIDTH / src.width : 1);
  }

  /** Minigame feedback in the world: the spot shakes, a few chips fly, the reward floats up. */
  private onGathered = (e: CustomEvent<{ nodeId: string; resource: Resource; grade: string; gained: number }>) => {
    const n = this.nodes.get(e.detail.nodeId);
    if (!n) return;
    const img = n.img;
    const x0 = img.x;
    this.tweens.add({ targets: img, x: { from: x0 - 4, to: x0 + 4 }, duration: 50, yoyo: true, repeat: 3, onComplete: () => { img.x = x0; } });
    const chip = { wood: 0xc88a55, minerals: 0x9d8ca2, fish: 0x8fdcf2, herbs: 0x6a4a2a }[e.detail.resource];
    const count = e.detail.grade === "perfect" ? 6 : e.detail.grade === "good" ? 4 : 2;
    for (let i = 0; i < count; i++) {
      const c = this.add.circle(img.x, img.y - 24, 3 + Math.random() * 2, chip).setDepth(img.depth + 1).setStrokeStyle(1.5, 0x2b1d3a);
      this.tweens.add({ targets: c, x: c.x + (Math.random() - 0.5) * 60, y: c.y - 20 - Math.random() * 26, alpha: 0, duration: 520, ease: "Quad.easeOut", onComplete: () => c.destroy() });
    }
    if (e.detail.gained > 0) {
      const ic = this.add.image(img.x, img.y - 40, `icon-${e.detail.resource}`).setDepth(10001).setScale(0.9);
      this.tweens.add({ targets: ic, y: ic.y - 40, alpha: 0, duration: 900, ease: "Cubic.easeOut", onComplete: () => ic.destroy() });
    }
  };

  private onFocus = (e: CustomEvent<{ x: number; y: number }>) => {
    this.cameras.main.pan(e.detail.x, e.detail.y, 600, "Sine.easeInOut");
  };

  private tapMarker(x: number, y: number) {
    const g = this.add.graphics({ x, y }).setDepth(5);
    g.lineStyle(3, 0xffffff, 0.9).strokeEllipse(0, 0, 26, 12);
    this.tweens.add({ targets: g, scale: 1.6, alpha: 0, duration: 450, onComplete: () => g.destroy() });
  }

  private pan(dx: number, dy: number) {
    if (!dx && !dy) return;
    const cam = this.cameras.main;
    cam.scrollX += (dx * 14) / cam.zoom;
    cam.scrollY += (dy * 14) / cam.zoom;
  }

  private onJoystick = (e: CustomEvent<{ dx: number; dy: number }>) => {
    const now = performance.now();
    const { dx, dy } = e.detail;
    if (!store.get().controlled) { this.pan(dx, dy); return; }
    if (Math.hypot(dx, dy) < 0.1) { if (this.moving) { send({ t: "move", dx: 0, dy: 0 }); this.moving = false; } return; }
    if (now - this.lastMove > 90) { send({ t: "move", dx, dy }); this.lastMove = now; this.moving = true; }
  };

  private textureFor(e: PetEntity): string {
    const m = e.meta!;
    if (m.sticker) {
      const key = `sticker:${m.id}`;
      if (this.textures.exists(key)) return key;
      if (!this.load.isLoading()) { this.load.image(key, m.sticker); this.load.start(); }
    }
    const key = `pa:${m.species}:${m.look.hue}:${m.look.pattern}`;
    if (!this.textures.exists(key)) this.textures.addCanvas(key, art.placeholderAnimal(m.species, m.look.hue, m.look.pattern));
    return key;
  }

  private ensurePet(e: PetEntity): PetSprite | null {
    let ps = this.pets.get(e.id);
    if (!e.meta) return ps ?? null;
    const tex = this.textureFor(e);
    if (!ps) {
      const shadow = this.add.image(0, 0, "shadow").setScale(0.9);
      const ring = this.add.graphics();
      const body = this.add.image(0, 0, tex).setOrigin(0.5, 0.92);
      const label = this.add.text(0, -60, "", { fontFamily: "Fredoka", fontSize: "12px", color: "#ffffff", stroke: "#2b1d3a", strokeThickness: 4 }).setOrigin(0.5);
      const root = this.add.container(0, 0, [shadow, ring, body, label]);
      root.setSize(52, 56).setInteractive(new Phaser.Geom.Rectangle(-26, -52, 52, 56), Phaser.Geom.Rectangle.Contains);
      root.on("pointerup", () => store.set({ sheet: { kind: "pet", id: e.id } }));
      ps = { root, body, shadow, label, ring, tex: "", phase: Math.random() * 10, hurtUntil: 0, lungeUntil: 0, lungeDir: 1 };
      this.pets.set(e.id, ps);
    }
    if (ps.tex !== tex) {
      ps.tex = tex;
      ps.body.setTexture(tex);
      const src = this.textures.get(tex).getSourceImage() as HTMLImageElement;
      const size = tex.startsWith("sticker:") ? 58 : 50;
      ps.body.setScale(size / Math.max(src.width, src.height));
    }
    const mine = e.meta.ownerId === store.get().userId;
    const controlled = e.id === store.get().controlled;
    ps.label.setText(`${e.meta.name}${e.meta.rarity !== "common" ? " ✦" : ""}`).setColor(mine ? "#ffe08a" : "#ffffff");
    ps.ring.clear();
    if (controlled) ps.ring.lineStyle(3, 0xffe08a, 0.95).strokeEllipse(0, 0, 50, 18);
    else if (e.meta.rarity !== "common") ps.ring.lineStyle(2, RARITY_COLOR[e.meta.rarity]!, 0.8).strokeEllipse(0, 0, 44, 15);
    return ps;
  }

  update(time: number) {
    if (!this.built) return;
    this.streamChunks();
    this.pollKeys();
    const now = serverNow() - INTERP_DELAY;
    const s = store.get();
    // Pets.
    for (const [id, ps] of this.pets) if (!entities.has(id)) { ps.root.destroy(); this.pets.delete(id); }
    for (const e of entities.values()) {
      const ps = this.ensurePet(e);
      if (!ps) continue;
      const [x, y] = sample(e, now);
      ps.root.setPosition(x, y).setDepth(y);
      this.animate(ps, e, time);
      if (e.id === s.controlled) {
        const cam = this.cameras.main;
        window.__petAnchor = { x: (x - cam.worldView.x) * cam.zoom, y: (y - cam.worldView.y) * cam.zoom };
        if (this.world) {
          const a = areaAt(this.world, x, y);
          if (a.id !== this.lastArea) {
            const first = !this.lastArea;
            this.lastArea = a.id;
            // Each area is its own map: the camera stays inside it, with a quick fade through the gate.
            const [bx0, by0, bx1, by1] = AREA_BOUNDS[a.id];
            const enter = () => { cam.setBounds(bx0 * TILE, by0 * TILE, (bx1 - bx0) * TILE, (by1 - by0) * TILE); cam.centerOn(x, y); };
            enter();
            if (!first) { cam.resetFX(); cam.fadeIn(420, 43, 29, 58); }
            window.dispatchEvent(new CustomEvent("catchami:area", { detail: a }));
          }
        }
        cam.scrollX += (x - cam.midPoint.x) * 0.12;
        cam.scrollY += (y - cam.midPoint.y) * 0.12;
      }
    }
    // Merchants.
    const ctrl = s.controlled ? entities.get(s.controlled) : null;
    const cpos = ctrl ? sample(ctrl, now) : null;
    for (const m of s.merchants) {
      let c = this.merchants.get(m.id);
      if (!c) {
        let key = MERCHANT_ART[m.id] ?? "";
        if (!this.textures.exists(key)) { key = `merchant-${m.hue}`; if (!this.textures.exists(key)) this.textures.addCanvas(key, art.merchant(m.hue)); }
        const glow = this.add.graphics();
        const img = this.add.image(0, 0, key).setOrigin(0.5, 0.95);
        const src = this.textures.get(key).getSourceImage();
        if (src.height > 120) img.setScale(MERCHANT_HEIGHT / src.height);
        const label = this.add.text(0, -MERCHANT_HEIGHT - 10, m.name, { fontFamily: "Fredoka", fontSize: "12px", color: "#2b1d3a", backgroundColor: "#ffd166", padding: { x: 6, y: 2 } }).setOrigin(0.5);
        c = this.add.container(m.x, m.y, [glow, img, label]);
        c.setSize(56, 64).setInteractive(new Phaser.Geom.Rectangle(-28, -62, 56, 66), Phaser.Geom.Rectangle.Contains);
        c.on("pointerup", () => store.set({ sheet: { kind: "merchant", id: m.id } }));
        this.merchants.set(m.id, c);
      }
      c.x += (m.x - c.x) * 0.15;
      c.y += (m.y - c.y) * 0.15;
      c.setDepth(c.y);
      const visible = m.state !== "at_hq" && m.state !== "unavailable";
      c.setAlpha(visible ? 1 : 0.45);
      const img = c.list[1] as Phaser.GameObjects.Image;
      img.y = Math.abs(Math.sin(time / 180)) * -3;
      const glow = c.list[0] as Phaser.GameObjects.Graphics;
      glow.clear();
      if (cpos && visible && Math.hypot(cpos[0] - m.x, cpos[1] - m.y) <= 72) glow.lineStyle(3, 0xffd166, 0.9 - 0.3 * Math.sin(time / 200)).strokeEllipse(0, 0, 70, 24);
    }
    // Nodes.
    for (const [id, n] of this.nodes) {
      const rem = s.nodes[id];
      if (rem === undefined) continue;
      const dep = rem <= 0;
      if (dep !== n.depleted) { n.depleted = dep; n.img.setTexture(`node-${n.res}${dep ? "-empty" : ""}`); this.fitNode(n.img); }
      const near = cpos && Math.hypot(cpos[0] - n.img.x, cpos[1] - n.img.y) < 160;
      n.badge.setText(dep ? "regrowing" : `${rem} left`).setAlpha(near ? 1 : 0);
    }
  }

  private pollKeys() {
    if (!this.keys.W) return;
    const k = this.keys;
    const dx = (k.D!.isDown || k.RIGHT!.isDown ? 1 : 0) - (k.A!.isDown || k.LEFT!.isDown ? 1 : 0);
    const dy = (k.S!.isDown || k.DOWN!.isDown ? 1 : 0) - (k.W!.isDown || k.UP!.isDown ? 1 : 0);
    if (!store.get().controlled) { this.pan(dx, dy); return; }
    if (dx || dy || this.moving) this.onJoystick(new CustomEvent("k", { detail: { dx, dy } }));
  }

  private animate(ps: PetSprite, e: PetEntity, time: number) {
    const t = time / 1000 + ps.phase;
    const b = ps.body;
    const face = e.facing;
    let sx = face, sy = 1, rot = 0, oy = 0, ox = 0, tint = 0xffffff;
    switch (e.anim) {
      case "walk": oy = -Math.abs(Math.sin(t * 11)) * 6; rot = Math.sin(t * 11) * 0.09; sy = 1 - Math.abs(Math.cos(t * 11)) * 0.06; break;
      case "gather": rot = face * (0.18 + Math.sin(t * 9) * 0.14); sy = 1 - Math.max(0, Math.sin(t * 9)) * 0.08; break;
      case "trade": oy = -Math.abs(Math.sin(t * 7)) * 10; rot = Math.sin(t * 7) * 0.15; break;
      case "attack": ox = face * Math.max(0, Math.sin(t * 14)) * 10; rot = face * 0.15; break;
      case "hurt": ox = Math.sin(t * 60) * 3; tint = 0xff9a9a; break;
      case "eat": sy = 1 + Math.sin(t * 16) * 0.07; sx = face * (1 - Math.sin(t * 16) * 0.05); break;
      case "sleep": rot = face * 0.22; sy = 1 + Math.sin(t * 2) * 0.04; break;
      case "ko": rot = face * 1.45; tint = 0x9d97a6; oy = 6; break;
      default: sy = 1 + Math.sin(t * 2.6) * 0.035; sx = face * (1 - Math.sin(t * 2.6) * 0.02);
    }
    if (performance.now() < ps.hurtUntil) { tint = 0xff8a8a; ox += Math.sin(t * 70) * 3; }
    if (performance.now() < ps.lungeUntil) ox += ps.lungeDir * 12;
    const base = ps.tex.startsWith("sticker:") ? 58 : 50;
    const src = this.textures.get(ps.tex).getSourceImage() as HTMLImageElement;
    const k = base / Math.max(src.width, src.height);
    b.setScale(sx * k, sy * k).setRotation(rot).setPosition(ox, oy).setTint(tint);
    ps.shadow.setScale(0.9 + oy / 60, 0.9 + oy / 60);
    if (e.meta?.status === "inactive") b.setAlpha(0.55); else b.setAlpha(1);
  }

  private onBattle = (ev: CustomEvent<BattleEvent>) => {
    const b = ev.detail;
    const sa = this.pets.get(b.a), sb = this.pets.get(b.b);
    if (!sa || !sb) return;
    const flash = this.add.text(b.x, b.y - 80, "SCUFFLE!", { fontFamily: "Fredoka", fontSize: "24px", color: "#ffffff", stroke: "#2b1d3a", strokeThickness: 6 }).setOrigin(0.5).setDepth(10000);
    this.tweens.add({ targets: flash, scale: { from: 0.4, to: 1.2 }, alpha: { from: 1, to: 0 }, duration: 900, onComplete: () => flash.destroy() });
    b.exchanges.slice(0, 16).forEach((x, i) => {
      this.time.delayedCall(250 + i * 260, () => {
        const att = x.attacker === 0 ? sa : sb, def = x.attacker === 0 ? sb : sa;
        if (!att.root.active || !def.root.active) return;
        att.lungeDir = def.root.x >= att.root.x ? 1 : -1;
        att.lungeUntil = performance.now() + 120;
        const txt = x.hit ? `-${x.damage}${x.crit ? "!" : ""}` : "miss";
        if (x.hit) def.hurtUntil = performance.now() + 180;
        const pop = this.add.text(def.root.x + (Math.random() - 0.5) * 20, def.root.y - 60, txt, {
          fontFamily: "Fredoka", fontSize: x.crit ? "22px" : "16px", color: x.hit ? (x.crit ? "#ffd166" : "#ffffff") : "#cfd8ff", stroke: "#2b1d3a", strokeThickness: 5,
        }).setOrigin(0.5).setDepth(10001);
        this.tweens.add({ targets: pop, y: pop.y - 34, alpha: 0, duration: 800, ease: "Cubic.easeOut", onComplete: () => pop.destroy() });
      });
    });
    const end = 300 + Math.min(16, b.exchanges.length) * 260;
    this.time.delayedCall(end, () => {
      const w = b.winner === b.a ? sa : b.winner === b.b ? sb : null;
      const l = w === sa ? sb : w === sb ? sa : null;
      if (w) {
        const star = this.add.text(w.root.x, w.root.y - 78, "WIN", { fontFamily: "Fredoka", fontSize: "18px", color: "#ffd166", stroke: "#2b1d3a", strokeThickness: 5 }).setOrigin(0.5).setDepth(10001);
        this.tweens.add({ targets: star, y: star.y - 20, alpha: 0, duration: 1400, onComplete: () => star.destroy() });
      }
      if (w && l) {
        for (const r of ["fish", "herbs", "wood", "minerals"] as const) {
          for (let i = 0; i < Math.min(5, b.stolen[r]); i++) {
            const ic = this.add.image(l.root.x, l.root.y - 30, `icon-${r}`).setDepth(10001).setScale(0.8);
            this.tweens.add({ targets: ic, x: w.root.x, y: w.root.y - 30, duration: 600, delay: i * 90, ease: "Quad.easeInOut", onComplete: () => ic.destroy() });
          }
        }
      }
    });
  };
}

function sample(e: PetEntity, t: number): [number, number] {
  const s = e.samples;
  if (!s.length) return [0, 0];
  if (t <= s[0]![0]) return [s[0]![1], s[0]![2]];
  for (let i = s.length - 1; i >= 1; i--) {
    const a = s[i - 1]!, b = s[i]!;
    if (t >= a[0] && t <= b[0]) { const k = (t - a[0]) / Math.max(1, b[0] - a[0]); return [a[1] + (b[1] - a[1]) * k, a[2] + (b[2] - a[2]) * k]; }
  }
  const l = s[s.length - 1]!;
  return [l[1], l[2]];
}

export function createGame(parent: HTMLElement) {
  const game = new Phaser.Game({
    type: Phaser.AUTO,
    parent,
    backgroundColor: art.PALETTE.water,
    scale: { mode: Phaser.Scale.RESIZE, width: Math.max(320, parent.clientWidth || window.innerWidth), height: Math.max(320, parent.clientHeight || window.innerHeight) },
    render: { antialias: true, pixelArt: false, powerPreference: "high-performance" },
    fps: { target: 60 },
    input: { activePointers: 2 },
    loader: { maxParallelDownloads: 96 },
    scene: [GameScene],
  });
  if (import.meta.env.DEV) (window as unknown as { __catchami: Phaser.Game }).__catchami = game; // debugging hook, dev builds only
  return game;
}

export { RARITY_LABEL };
