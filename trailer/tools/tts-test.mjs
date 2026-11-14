import { KokoroTTS } from "kokoro-js";
const tts = await KokoroTTS.from_pretrained("onnx-community/Kokoro-82M-v1.0-ONNX", { dtype: "fp32", device: "cpu" });
console.log(Object.keys(tts.voices).filter(v => v.startsWith("af_") || v.startsWith("bf_")).join(" "));
for (const v of ["af_heart", "af_bella", "af_nicole", "bf_emma"]) {
  const a = await tts.generate("This cat has a wallet. ... And bills to pay! Welcome to Catchami — a living animal economy.", { voice: v, speed: 1.0 });
  a.save(`assets/vo/test_${v}.wav`);
  console.log(v, "ok");
}
