import { Composition } from "remotion";
import { Trailer } from "./Trailer";
import { EconomyLoop } from "./Scenes";
import { Trailer2, TOTAL2 } from "./Trailer2";
import { FPS as FPS2 } from "./timeline2";
import { FPS, TOTAL } from "./timeline";

const LoopTest = () => <EconomyLoop petSticker="pudding-sticker.png" perStep={1.6} />;

export const Root = () => (
  <>
    <Composition id="Trailer" component={Trailer} durationInFrames={Math.round(TOTAL * FPS)} fps={FPS} width={1920} height={1080} />
    <Composition id="Trailer2" component={Trailer2} durationInFrames={Math.round(TOTAL2 * FPS2)} fps={FPS2} width={1920} height={1080} />
    <Composition id="LoopTest" component={LoopTest} durationInFrames={300} fps={FPS} width={1920} height={1080} />
  </>
);
