import { Composition } from "remotion";
import { Trailer } from "./Trailer";
import { EconomyLoop } from "./Scenes";
import { FPS, TOTAL } from "./timeline";

const LoopTest = () => <EconomyLoop petSticker="pudding-sticker.png" perStep={1.6} />;

export const Root = () => (
  <>
    <Composition id="Trailer" component={Trailer} durationInFrames={Math.round(TOTAL * FPS)} fps={FPS} width={1920} height={1080} />
    <Composition id="LoopTest" component={LoopTest} durationInFrames={300} fps={FPS} width={1920} height={1080} />
  </>
);
