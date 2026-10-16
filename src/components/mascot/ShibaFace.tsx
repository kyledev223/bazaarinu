// Bazaar Inu's shopkeeper: an original pixel-art Shiba Inu face, drawn as
// inline SVG from small character grids. Moods swap the eyes, mouth, ears and
// a prop; CSS adds blinking, ear twitches and reactions (prefers-reduced-motion
// switches all of it off).
import { memo } from "react";

export type ShibaMood = "happy" | "chart" | "celebrate" | "worried" | "sleeping" | "neutral";

const PAL: Record<string, string> = {
  K: "#2b1a10", // outline
  O: "#e8893a", // fur
  o: "#c96f2a", // fur shade
  C: "#f8e8cb", // cream
  P: "#f3ab86", // inner ear
  E: "#1b1210", // eye / nose / mouth
  W: "#ffffff", // eye shine
  B: "#f49a9a", // blush
  T: "#e8606e", // tongue
  G: "#4ba8ff", // glasses (brand blue)
  S: "#8ccbff", // sweat drop
  Y: "#ffd45a", // sparkle
};

// 20 × 18 grid. "." is transparent.
const HEAD = [
  "....................",
  "....................",
  "....................",
  "..KKKKKKKKKKKKKKKK..",
  ".KOOOOOOOOOOOOOOOOK.",
  "KOOOOOOOOOOOOOOOOOOK",
  "KOOOCCOOOOOOOOCCOOOK",
  "KOOOOOOOOOOOOOOOOOOK",
  "KOOOOOOOOOOOOOOOOOOK",
  "KOOOOOOOOOOOOOOOOOOK",
  "KoOOOOOCCCCCCOOOOOoK",
  "KoBBOCCCCCCCCCCOBBoK",
  "KoOCCCCCCEECCCCCCOoK",
  ".KOCCCCCCEECCCCCCOK.",
  ".KOCCCCCCCCCCCCCCOK.",
  "..KOCCCCCCCCCCCCOK..",
  "...KKOCCCCCCCCOKK...",
  ".....KKKKKKKKKK.....",
];

// Ears are drawn over the head so their inner colour runs into it. Split into halves so each can twitch.
const EARS_UP = [
  "..KK............KK..",
  ".KOK............KOK.",
  ".KPOK..........KOPK.",
  ".KPPOK........KOPPK.",
];
const EAR_L_UP = EARS_UP.map((r) => r.slice(0, 10));
const EAR_R_UP = EARS_UP.map((r) => ".".repeat(10) + r.slice(10));
const EARS_DOWN = [
  "....................",
  "....................",
  "....................",
  "KKK..............KKK",
  "KPOK............KOPK",
  ".KOK............KOK.",
];

const EYES: Record<string, string[]> = {
  open: ["", "", "", "", "", "", "", "", "....WE........WE....", "....EE........EE...."],
  happy: ["", "", "", "", "", "", "", "", ".....E........E.....", "....E.E......E.E...."],
  closed: ["", "", "", "", "", "", "", "", "", "...EEE........EEE..."],
  worried: ["", "", "", "", "", "", "", "....E..........E....", "....WE........WE....", "....EE........EE...."],
};

const MOUTHS: Record<string, string[]> = {
  smile: [".......E.EE.E.......", "........E..E........"],
  open: [".......E.EE.E.......", "........ETTE........", ".........TT........."],
  flat: [".........EE.........", "........E..E........"],
  small: [".........EE.........", ""],
};

const PROPS: Record<string, string[]> = {
  glasses: ["", "", "", "", "", "", "", "...GGGG......GGGG...", "...G..GGGGGGGG..G...", "...G..G......G..G...", "...GGGG......GGGG..."],
  sweat: ["", "", "", "", "..................S.", ".................SSS", ".................SSS"],
  sparkle: ["", "Y..................Y", "", "", "", "", "", "", "", "", "", "", "", "", "", "Y..................Y"],
};

const MOOD: Record<ShibaMood, { eyes: string; mouth: string; ears: "up" | "down"; props: string[] }> = {
  neutral: { eyes: "open", mouth: "smile", ears: "up", props: [] },
  happy: { eyes: "happy", mouth: "open", ears: "up", props: [] },
  chart: { eyes: "open", mouth: "smile", ears: "up", props: ["glasses"] },
  celebrate: { eyes: "happy", mouth: "open", ears: "up", props: ["sparkle"] },
  worried: { eyes: "worried", mouth: "flat", ears: "down", props: ["sweat"] },
  sleeping: { eyes: "closed", mouth: "small", ears: "up", props: [] },
};

function rects(grid: string[], dx = 0, dy = 0, key = "") {
  const out: React.ReactElement[] = [];
  grid.forEach((row, y) => {
    let x = 0;
    while (x < row.length) {
      const c = row[x];
      if (c === "." || c === " " || !PAL[c]) {
        x++;
        continue;
      }
      let w = 1;
      while (row[x + w] === c) w++;
      out.push(<rect key={`${key}${x},${y}`} x={x + dx} y={y + dy} width={w} height={1} fill={PAL[c]} />);
      x += w;
    }
  });
  return out;
}

export const ShibaFace = memo(function ShibaFace({
  mood = "neutral",
  size = 64,
  react,
  title,
  className = "",
}: {
  mood?: ShibaMood;
  size?: number | string;
  react?: "fee" | "loss" | null;
  title?: string;
  className?: string;
}) {
  const m = MOOD[mood];
  const label = title ?? "Bazaar Inu, the shopkeeper Shiba";
  return (
    <svg
      viewBox="0 0 20 18"
      width={size}
      height={typeof size === "number" ? (size * 18) / 20 : undefined}
      className={`shiba px-art mood-${mood} ${react ? `react-${react}` : ""} ${className}`}
      role="img"
      aria-label={label}
      shapeRendering="crispEdges"
    >
      <title>{label}</title>
      <g className="face">
        {rects(HEAD, 0, 0, "h")}
        {m.ears === "up" ? (
          <>
            <g className="ear-l">{rects(EAR_L_UP, 0, 0, "el")}</g>
            <g className="ear-r">{rects(EAR_R_UP, 0, 0, "er")}</g>
          </>
        ) : (
          <g>{rects(EARS_DOWN, 0, 0, "ed")}</g>
        )}
        <g className="eyes">{rects(EYES[m.eyes], 0, 0, "e")}</g>
        {rects(MOUTHS[m.mouth], 0, 14, "m")}
        {m.props.map((p) => (
          <g key={p}>{rects(PROPS[p], 0, 0, p)}</g>
        ))}
      </g>
      {mood === "sleeping" && (
        <text className="zzz" x="15.5" y="3.2" fontSize="3.6" fontFamily="var(--pixel)" fill="var(--accent-glow)">
          z
        </text>
      )}
    </svg>
  );
});

/** The same face as flat pixels, for canvas drawing (the simulator's shop window). */
export function shibaPixels(mood: ShibaMood = "neutral"): { x: number; y: number; w: number; c: string }[] {
  const m = MOOD[mood];
  const layers: [string[], number][] = [
    [HEAD, 0],
    [m.ears === "up" ? EARS_UP : EARS_DOWN, 0],
    [EYES[m.eyes], 0],
    [MOUTHS[m.mouth], 14],
    ...m.props.map((p) => [PROPS[p], 0] as [string[], number]),
  ];
  const out: { x: number; y: number; w: number; c: string }[] = [];
  for (const [grid, dy] of layers) {
    grid.forEach((row, y) => {
      let x = 0;
      while (x < row.length) {
        const c = row[x];
        if (!PAL[c]) {
          x++;
          continue;
        }
        let w = 1;
        while (row[x + w] === c) w++;
        out.push({ x, y: y + dy, w, c: PAL[c] });
        x += w;
      }
    });
  }
  return out;
}
