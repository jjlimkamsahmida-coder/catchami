import { useEffect, useState } from "react";
import { music } from "./music.ts";

/** Round music on/off button. */
export function MusicToggle({ className = "" }: { className?: string }) {
  const [on, setOn] = useState(music.on);
  useEffect(() => music.subscribe(setOn), []);
  return (
    <button className={`music-btn ${on ? "on" : ""} ${className}`} onClick={() => music.toggle()} aria-label={on ? "Mute music" : "Play music"} title={on ? "Mute music" : "Play music"}>
      <svg viewBox="0 0 24 24" aria-hidden><path d="M9 18V6l10-2v12" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" /><circle cx="6.5" cy="18" r="2.8" fill="currentColor" /><circle cx="16.5" cy="16" r="2.8" fill="currentColor" />{!on && <path d="M3 3l18 18" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" />}</svg>
    </button>
  );
}
