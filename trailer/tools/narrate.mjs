import { readFileSync, writeFileSync } from "node:fs";
import { KokoroTTS } from "kokoro-js";
const lines = JSON.parse(readFileSync("tools/narration.json", "utf8"));
const tts = await KokoroTTS.from_pretrained("onnx-community/Kokoro-82M-v1.0-ONNX", { dtype: "fp32", device: "cpu" });
const out = {};
for (const l of lines) {
  const a = await tts.generate(l.text, { voice: "af_heart", speed: l.speed });
  a.save(`assets/vo/${l.id}.wav`);
  out[l.id] = { text: l.text, seconds: +(a.audio.length / a.sampling_rate).toFixed(2) };
  console.log(l.id, out[l.id].seconds);
}
writeFileSync("src/vo.json", JSON.stringify(out, null, 2));
