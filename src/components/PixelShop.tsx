// A market-stall shopfront in pixel art: hanging sign with the ticker, striped
// awning, a window that shows the coin image (or the Shiba), and a door.
import { memo } from "react";

const INK = "#02060F";
const CREAM = "#EADFC4";
const CREAM_DIM = "#BFAF8C";
const GLASS = "#0B2038";
const GLASS_HI = "#123456";

export function tickerFont(t: string) {
  return t.length <= 3 ? 7 : t.length <= 4 ? 6 : t.length <= 6 ? 4.6 : t.length <= 8 ? 3.6 : 3;
}

export const PixelShop = memo(function PixelShop({
  ticker = "SHOP",
  awning = "#1F6FD6",
  image,
  lit = true,
  className = "",
  label,
}: {
  ticker?: string;
  awning?: string;
  image?: string | null;
  lit?: boolean;
  className?: string;
  label?: string;
}) {
  const t = (ticker || "SHOP").toUpperCase().slice(0, 10);
  const clip = `win-${t}-${awning.replace("#", "")}`;
  const stripes = Array.from({ length: 9 }, (_, i) => i);
  return (
    <svg viewBox="0 0 48 46" className={`px-art ${className}`} role={label ? "img" : undefined} aria-label={label} aria-hidden={label ? undefined : true} shapeRendering="crispEdges">
      {/* sign posts and board */}
      <rect x="11" y="3" width="1" height="4" fill={INK} />
      <rect x="36" y="3" width="1" height="4" fill={INK} />
      <rect x="7" y="5" width="34" height="11" fill={INK} />
      <rect x="8" y="6" width="32" height="9" fill={GLASS} />
      <rect x="8" y="6" width="32" height="1" fill={GLASS_HI} />
      <text x="24" y={10.5 + tickerFont(t) / 3} textAnchor="middle" fontFamily="var(--pixel), monospace" fontWeight="700" fontSize={tickerFont(t)} fill={lit ? "#4BA8FF" : "#5A6B80"}>
        {t.replace(/[<>&"]/g, "")}
      </text>
      {/* awning: alternating stripes with a scalloped edge */}
      <rect x="3" y="16" width="42" height="8" fill={INK} />
      {stripes.map((i) => (
        <g key={i}>
          <rect x={4 + i * 4.444} y="17" width="4.444" height="5" fill={i % 2 ? CREAM : awning} />
          <rect x={4.6 + i * 4.444} y="22" width="3.2" height="1.4" fill={i % 2 ? CREAM_DIM : awning} />
        </g>
      ))}
      <rect x="4" y="17" width="40" height="1" fill="#ffffff" opacity="0.18" />
      {/* shop body */}
      <rect x="6" y="24" width="36" height="17" fill={INK} />
      <rect x="7" y="24" width="34" height="16" fill={CREAM} />
      <rect x="7" y="24" width="34" height="1" fill={CREAM_DIM} />
      {/* window */}
      <rect x="9" y="26" width="17" height="12" fill={INK} />
      <rect x="10" y="27" width="15" height="10" fill={GLASS} />
      <defs>
        <clipPath id={clip}>
          <rect x="10" y="27" width="15" height="10" />
        </clipPath>
      </defs>
      {image ? (
        <image href={image} x="12.5" y="27" width="10" height="10" preserveAspectRatio="xMidYMid slice" clipPath={`url(#${clip})`} style={{ imageRendering: "auto" }} />
      ) : (
        <g transform="translate(12.5 27.6) scale(0.5)">
          {/* tiny shopkeeper in the window */}
          <rect x="1" y="3" width="18" height="12" fill="#E8893A" />
          <rect x="2" y="0" width="3" height="4" fill="#E8893A" />
          <rect x="15" y="0" width="3" height="4" fill="#E8893A" />
          <rect x="5" y="9" width="10" height="6" fill="#F8E8CB" />
          <rect x="5" y="6" width="2" height="2" fill="#1B1210" />
          <rect x="13" y="6" width="2" height="2" fill="#1B1210" />
          <rect x="9" y="9" width="2" height="2" fill="#1B1210" />
        </g>
      )}
      <rect x="10" y="27" width="15" height="1" fill="#ffffff" opacity="0.15" />
      {/* door */}
      <rect x="29" y="27" width="10" height="14" fill={INK} />
      <rect x="30" y="28" width="8" height="12" fill={GLASS} />
      <rect x="30" y="28" width="8" height="1" fill={GLASS_HI} />
      <rect x="31" y="31" width="6" height="3" fill={lit ? "#4BA8FF" : "#33445A"} opacity={lit ? 0.9 : 1} />
      <rect x="36" y="35" width="1" height="2" fill={CREAM} />
      {/* step and pavement line */}
      <rect x="5" y="41" width="38" height="2" fill={INK} />
      <rect x="6" y="41" width="36" height="1" fill={CREAM_DIM} />
      <rect x="2" y="44" width="44" height="1" fill={awning} opacity="0.7" />
    </svg>
  );
});

export const LampPost = () => (
  <svg className="lamp px-art" viewBox="0 0 7 40" aria-hidden="true" shapeRendering="crispEdges">
    <rect x="0" y="0" width="7" height="4" fill="#EADFC4" />
    <rect x="1" y="1" width="5" height="2" fill="#8CCBFF" />
    <rect x="3" y="4" width="1" height="36" fill="#3A4B5C" />
    <rect x="2" y="38" width="3" height="2" fill="#3A4B5C" />
  </svg>
);

/** Awning colours for shops on the street, derived from the mint so a shop always looks the same. */
export function awningFor(mint: string): string {
  const palette = ["#1F6FD6", "#2A86E8", "#1758B8", "#3A7BD5", "#1E90C8", "#2D5FCF"];
  let h = 0;
  for (const ch of mint) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return palette[h % palette.length];
}
