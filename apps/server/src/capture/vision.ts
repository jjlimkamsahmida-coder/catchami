/**
 * Optional second opinion from an OpenAI vision model. Enabled only when
 * OPENAI_API_KEY is set. When enabled it is the authority on "is this a real,
 * live cat or dog in front of the camera" (catches screens, printed photos,
 * plush toys and drawings that a COCO detector happily accepts) and supplies a
 * tighter body box for the sticker cutout.
 *
 * Privacy: only the single best frame, downscaled, is sent. Nothing is stored
 * by Catchami beyond the sticker crop.
 */
import jpeg from "jpeg-js";
import type { Species } from "@catchami/shared";
import type { Rgba } from "./image.ts";

export interface VisionVerdict {
  animal: boolean;
  species: Species | "other" | "none";
  live: boolean;
  confidence: number;
  /** Pixels in the frame that was analysed: [x, y, w, h]. */
  bbox: [number, number, number, number] | null;
  reason: string;
}

const KEY = process.env.OPENAI_API_KEY ?? "";
const MODEL = process.env.OPENAI_VISION_MODEL ?? "gpt-4.1-mini";
const BASE = process.env.OPENAI_BASE_URL ?? "https://api.openai.com/v1";

export const visionEnabled = () => KEY.length > 0;

const SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["animal", "species", "live", "confidence", "bbox", "reason"],
  properties: {
    animal: { type: "boolean", description: "A real animal is clearly visible" },
    species: { type: "string", enum: ["cat", "dog", "other", "none"] },
    live: { type: "boolean", description: "The animal is physically in front of the camera — NOT a phone/TV/monitor screen, printed photo, poster, drawing, statue or plush toy" },
    confidence: { type: "number", description: "0..1 confidence in the species + live judgement" },
    bbox: {
      type: ["array", "null"], items: { type: "number" }, minItems: 4, maxItems: 4,
      description: "Tight box around the main animal's whole body as fractions of image width/height: [left, top, width, height]",
    },
    reason: { type: "string", description: "One short sentence for the player" },
  },
} as const;

function toJpeg(img: Rgba, maxSide = 768): string {
  const s = Math.min(1, maxSide / Math.max(img.width, img.height));
  const w = Math.max(1, Math.round(img.width * s)), h = Math.max(1, Math.round(img.height * s));
  const out = Buffer.alloc(w * h * 4);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const sx = Math.min(img.width - 1, Math.floor(x / s)), sy = Math.min(img.height - 1, Math.floor(y / s));
    img.data.subarray((sy * img.width + sx) * 4, (sy * img.width + sx) * 4 + 4).forEach((v, k) => { out[(y * w + x) * 4 + k] = v; });
  }
  return jpeg.encode({ data: out, width: w, height: h }, 85).data.toString("base64");
}

export async function verifyWithVision(img: Rgba): Promise<VisionVerdict> {
  const r = await fetch(`${BASE}/chat/completions`, {
    method: "POST",
    headers: { authorization: `Bearer ${KEY}`, "content-type": "application/json" },
    signal: AbortSignal.timeout(15_000),
    body: JSON.stringify({
      model: MODEL,
      temperature: 0,
      response_format: { type: "json_schema", json_schema: { name: "animal_check", strict: true, schema: SCHEMA } },
      messages: [
        { role: "system", content: "You verify photos for a pet-catching game. Players may only catch REAL, LIVE cats and dogs physically in front of their camera. Be strict about screens, printed photos, toys and drawings. Answer only with the JSON schema." },
        { role: "user", content: [
          { type: "text", text: "Check this camera frame." },
          { type: "image_url", image_url: { url: `data:image/jpeg;base64,${toJpeg(img)}`, detail: "low" } },
        ] },
      ],
    }),
  });
  if (!r.ok) throw new Error(`vision ${r.status}`);
  const j = (await r.json()) as { choices: Array<{ message: { content: string } }> };
  const v = JSON.parse(j.choices[0]!.message.content) as Omit<VisionVerdict, "bbox"> & { bbox: number[] | null };
  const b = v.bbox && v.bbox.length === 4 && v.bbox[2]! > 0.02 && v.bbox[3]! > 0.02
    ? ([v.bbox[0]! * img.width, v.bbox[1]! * img.height, v.bbox[2]! * img.width, v.bbox[3]! * img.height] as [number, number, number, number])
    : null;
  return { ...v, confidence: Math.max(0, Math.min(1, Number(v.confidence) || 0)), bbox: b };
}
