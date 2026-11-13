/** Game-style ribbon banner drawn in SVG (scales cleanly, never cropped). */
export function Ribbon({ text, tone = "gold", crown = false, className = "" }: { text: string; tone?: "gold" | "purple" | "green"; crown?: boolean; className?: string }) {
  const c = {
    gold: { face: "#ffc94a", light: "#ffe9a6", tail: "#e8902a", tailDark: "#b86414" },
    purple: { face: "#a98bf0", light: "#cdbaff", tail: "#7a5cc8", tailDark: "#563e98" },
    green: { face: "#7fd456", light: "#b8f27c", tail: "#4c9a33", tailDark: "#326e20" },
  }[tone];
  const ink = "#2b1d3a";
  return (
    <div className={`ribbon ${className}`}>
      <svg viewBox="0 0 400 150" aria-hidden>
        {/* Tails behind */}
        <path d="M58 70 L6 76 L30 104 L8 132 L84 124 Z" fill={c.tail} stroke={ink} strokeWidth="7" strokeLinejoin="round" />
        <path d="M342 70 L394 76 L370 104 L392 132 L316 124 Z" fill={c.tail} stroke={ink} strokeWidth="7" strokeLinejoin="round" />
        <path d="M84 124 L66 104 L102 108 Z" fill={c.tailDark} />
        <path d="M316 124 L334 104 L298 108 Z" fill={c.tailDark} />
        {/* Curved face */}
        <path d="M54 48 Q200 18 346 48 L346 114 Q200 84 54 114 Z" fill={c.face} stroke={ink} strokeWidth="7" strokeLinejoin="round" />
        <path d="M66 56 Q200 30 334 56 L334 66 Q200 42 66 66 Z" fill={c.light} opacity="0.9" />
        {crown && (
          <g transform="translate(200 20)">
            <path d="M-26 12 L-30 -16 L-13 -2 L0 -22 L13 -2 L30 -16 L26 12 Z" fill="#ffd166" stroke={ink} strokeWidth="5" strokeLinejoin="round" />
            <circle cx="0" cy="2" r="4" fill="#fff6e5" />
          </g>
        )}
      </svg>
      <span>{text}</span>
    </div>
  );
}
