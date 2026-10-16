"use client";
// "Run the shop": a constant-product pool simulation for a sample coin. The
// maths lives in src/lib/sim/pool.ts (unit-tested); this file only animates it.
import { useCallback, useEffect, useRef, useState } from "react";
import {
  FEE_TIERS,
  VOLATILITY,
  arbitrage,
  buyWithSol,
  buyback,
  createPool,
  marketStep,
  normal,
  poolPrice,
  sellCoins,
  setFee,
  shock,
  stats,
  type PoolState,
  type Volatility,
} from "@/lib/sim/pool";
import { ShibaFace, shibaPixels, type ShibaMood } from "@/components/mascot/ShibaFace";

const TICKER = "TREAT";
const SW = 260;
const SH = 115;
const GY = 100;
const SHOP_SCALE = 1.75;
// Traders stop at the shop door (x ≈ 34 in the shop's own grid).
const DOOR = SW / 2 + 10 * SHOP_SCALE;

type Walker = {
  kind: "trader" | "arb" | "whale";
  x: number;
  dir: 1 | -1;
  stop: number;
  v: number;
  state: "in" | "wait" | "out";
  t: number;
  ph: number;
  shirt: string;
  item: string;
  act: (w: Walker) => void;
};
type Float = { x: number; y: number; txt: string; col: string; t: number };

const SHIRTS = ["#2F6F9B", "#C9C3AE", "#4B6E9C", "#9C5B4B", "#7A6BB0", "#3FA7A0"];
const SOL_COLOR = "#9945FF";
const COIN_COLOR = "#4BA8FF";
const f0 = (n: number) => Math.round(n).toLocaleString("en-US");
const f3 = (n: number) => n.toLocaleString("en-US", { minimumFractionDigits: 3, maximumFractionDigits: 3 });

export function Simulator() {
  const sceneRef = useRef<HTMLCanvasElement>(null);
  const chartRef = useRef<HTMLCanvasElement>(null);
  const pool = useRef<PoolState>(createPool(1_000_000, 100, 0.003));
  const hist = useRef<[number, number][]>([]);
  const walkers = useRef<Walker[]>([]);
  const floats = useRef<Float[]>([]);
  const arbBusy = useRef(false);
  const vol = useRef<number>(VOLATILITY.normal);
  const running = useRef(true);
  const visible = useRef(true);
  const moodRef = useRef<ShibaMood>("neutral");

  const [fee, setFeeUi] = useState<number>(0.003);
  const [volName, setVolName] = useState<Volatility>("normal");
  const [paused, setPaused] = useState(false);
  const [log, setLog] = useState(`Fresh pool: 1,000,000 $${TICKER} and 100 SOL. Traders are on their way.`);
  const [s, setS] = useState(() => stats(pool.current));
  const [feePot, setFeePot] = useState(0);
  const [mood, setMood] = useState<ShibaMood>("neutral");
  const [react, setReact] = useState<"fee" | "loss" | null>(null);
  const reactTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const pulse = useCallback((r: "fee" | "loss") => {
    setReact(r);
    if (reactTimer.current) clearTimeout(reactTimer.current);
    reactTimer.current = setTimeout(() => setReact(null), 600);
  }, []);

  const refresh = useCallback(() => {
    const st = stats(pool.current);
    setS(st);
    setFeePot(pool.current.feePot);
    // Ears down when the pool is clearly behind holding, happy when it's ahead.
    const hold = pool.current.x0 * pool.current.marketPrice + pool.current.y0;
    const m: ShibaMood = st.vsHold < -0.01 * hold ? "worried" : st.vsHold > 0.002 * hold ? "happy" : "chart";
    moodRef.current = m;
    setMood(m);
  }, []);

  const floatTxt = (txt: string, col: string, x = DOOR) => floats.current.push({ x, y: GY - 46, txt, col, t: 1.6 });

  const spawn = (kind: Walker["kind"], side: "L" | "R", act: (w: Walker) => void) => {
    if (kind === "trader" && walkers.current.length > 9) return;
    const L = side === "L";
    const door = DOOR;
    walkers.current.push({
      kind,
      x: L ? -8 : SW + 8,
      dir: L ? 1 : -1,
      stop: L ? door - 7 : door + 7,
      v: kind === "arb" ? 72 : kind === "whale" ? 22 : 30 + Math.random() * 12,
      state: "in",
      t: 0,
      ph: Math.random() * 6,
      shirt: SHIRTS[Math.floor(Math.random() * SHIRTS.length)],
      item: L ? SOL_COLOR : COIN_COLOR,
      act,
    });
  };

  const sendArb = useCallback(() => {
    arbBusy.current = true;
    spawn("arb", poolPrice(pool.current) < pool.current.marketPrice ? "L" : "R", (w) => {
      arbBusy.current = false;
      const r = arbitrage(pool.current);
      if (!r) return setLog("An arbitrage bot showed up, but prices already matched. It left with nothing.");
      pool.current = r.state;
      w.item = r.side === "buy" ? COIN_COLOR : SOL_COLOR;
      floatTxt(`-${Math.max(0, r.profit).toFixed(4)}`, "#FF6B6B", w.x);
      pulse("loss");
      setLog(
        r.side === "buy"
          ? `Arb bot bought ${f0(r.coinDelta)} cheap $${TICKER} and kept ${r.profit.toFixed(4)} SOL. That value came out of your pool.`
          : `Arb bot sold ${f0(-r.coinDelta)} $${TICKER} into your overpriced pool and kept ${r.profit.toFixed(4)} SOL.`,
      );
      refresh();
    });
  }, [pulse, refresh]);

  const tick = useCallback(() => {
    pool.current = marketStep(pool.current, vol.current, normal(Math.random));
    // Higher fees scare off some traders.
    if (Math.random() < 0.55 - pool.current.fee * 20) {
      const sol = 0.1 + Math.random() ** 2 * 2.4;
      if (Math.random() < 0.5)
        spawn("trader", "L", (w) => {
          const r = buyWithSol(pool.current, sol);
          pool.current = r.state;
          w.item = COIN_COLOR;
          floatTxt(`+${f3(r.fee)}`, "#4BA8FF", w.x);
          pulse("fee");
          setLog(`A trader bought ${f0(r.coinDelta)} $${TICKER} for ${f3(sol)} SOL. The shop kept ${f3(r.fee)} SOL in fees.`);
          refresh();
        });
      else
        spawn("trader", "R", (w) => {
          const coins = sol / poolPrice(pool.current);
          const r = sellCoins(pool.current, coins);
          pool.current = r.state;
          w.item = SOL_COLOR;
          floatTxt(`+${f3(r.fee)}`, "#4BA8FF", w.x);
          pulse("fee");
          setLog(`A trader sold ${f0(coins)} $${TICKER} for ${f3(r.solDelta)} SOL. The shop kept ${f3(r.fee)} SOL in fees.`);
          refresh();
        });
    }
    if (!arbBusy.current && Math.abs(poolPrice(pool.current) / pool.current.marketPrice - 1) > pool.current.fee + 0.006) sendArb();
    hist.current.push([poolPrice(pool.current), pool.current.marketPrice]);
    if (hist.current.length > 120) hist.current.shift();
    refresh();
  }, [pulse, refresh, sendArb]);

  const reset = useCallback(() => {
    pool.current = createPool(1_000_000, 100, pool.current.fee);
    hist.current = [];
    walkers.current = [];
    floats.current = [];
    arbBusy.current = false;
    setLog(running.current ? `Fresh pool: 1,000,000 $${TICKER} and 100 SOL. Traders are on their way.` : `Fresh pool: 1,000,000 $${TICKER} and 100 SOL. Press Play to open the shop.`);
    refresh();
  }, [refresh]);

  // Animation loop.
  useEffect(() => {
    const scene = sceneRef.current!;
    const chart = chartRef.current!;
    const g = scene.getContext("2d")!;
    const c2 = chart.getContext("2d")!;
    const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reduced) {
      running.current = false;
      setPaused(true);
      setLog(`Fresh pool: 1,000,000 $${TICKER} and 100 SOL. Press Play to open the shop.`);
    }
    const stars = Array.from({ length: 44 }, () => [Math.random() * SW, Math.random() * (GY - 48), Math.random() < 0.2] as const);
    let acc = 0;
    let last = performance.now();
    let raf = 0;

    const px = (x: number, y: number, w: number, h: number, col: string) => {
      g.fillStyle = col;
      g.fillRect(Math.round(x), Math.round(y), w, h);
    };
    // The shop is the centrepiece of the street, drawn at SHOP_SCALE in its own 48×46 pixel grid.
    const shopX = SW / 2 - 24 * SHOP_SCALE;
    const drawShop = () => {
      g.save();
      g.translate(shopX, GY - 43 * SHOP_SCALE);
      g.scale(SHOP_SCALE, SHOP_SCALE);
      const R = (x: number, y: number, w: number, h: number, c: string) => {
        g.fillStyle = c;
        g.fillRect(x, y, w, h);
      };
      R(11, 3, 1, 3, "#02060F");
      R(36, 3, 1, 3, "#02060F");
      R(7, 5, 34, 11, "#02060F");
      R(8, 6, 32, 9, "#0B2038");
      R(8, 6, 32, 1, "#123456");
      g.font = '700 7px "Pixelify Sans", monospace';
      g.textAlign = "center";
      g.fillStyle = "#4BA8FF";
      g.fillText("INU", 24, 13.3);
      R(3, 16, 42, 8, "#02060F");
      for (let i = 0; i < 9; i++) {
        R(4 + i * 4.444, 17, 4.45, 5, i % 2 ? "#EADFC4" : "#1F6FD6");
        R(4.6 + i * 4.444, 22, 3.2, 1.4, i % 2 ? "#BFAF8C" : "#1F6FD6");
      }
      R(6, 24, 36, 17, "#02060F");
      R(7, 24, 34, 16, "#EADFC4");
      R(7, 24, 34, 1, "#BFAF8C");
      R(9, 26, 17, 12, "#02060F");
      R(10, 27, 15, 10, "#0B2038");
      // the shopkeeper in the window: the same pixels as the SVG mascot, reacting to the pool
      const s = 0.62;
      for (const p of shibaPixels(moodRef.current)) R(11.3 + p.x * s, 27.4 + p.y * s * 0.95, p.w * s + 0.03, s * 0.95 + 0.03, p.c);
      R(29, 27, 10, 14, "#02060F");
      R(30, 28, 8, 12, "#0B2038");
      R(31, 31, 6, 3, "#4BA8FF");
      R(36, 35, 1, 2, "#EADFC4");
      R(5, 41, 38, 2, "#02060F");
      R(6, 41, 36, 1, "#BFAF8C");
      g.restore();
      // glow under the shop
      const glow = g.createRadialGradient(SW / 2, GY, 2, SW / 2, GY, 46);
      glow.addColorStop(0, "rgba(75,168,255,.28)");
      glow.addColorStop(1, "rgba(75,168,255,0)");
      g.fillStyle = glow;
      g.fillRect(SW / 2 - 46, GY - 8, 92, 12);
    };
    const lamp = (x: number) => {
      g.fillStyle = "rgba(140,203,255,.07)";
      g.beginPath();
      g.moveTo(x - 1, GY - 36);
      g.lineTo(x - 14, GY);
      g.lineTo(x + 15, GY);
      g.lineTo(x + 2, GY - 36);
      g.fill();
      px(x, GY - 36, 1, 36, "#3A4B5C");
      px(x - 2, GY - 39, 5, 3, "#EADFC4");
      px(x - 1, GY - 38, 3, 1, "#8CCBFF");
    };
    const person = (w: Walker, sc: number) => {
      const step = w.state === "wait" ? 0 : Math.floor(w.ph) % 2;
      const P = (a: number, b: number, ww: number, hh: number, col: string) => px(w.x + a * sc, GY + b * sc, ww * sc, hh * sc, col);
      P(-2, -13, 4, 4, "#EADFC4");
      P(-2, -13, 4, 1, "#2A1E14");
      P(-3, -9, 6, 5, w.kind === "whale" ? "#5EC8FF" : w.shirt);
      if (step) {
        P(-2, -4, 1, 4, "#1A2230");
        P(1, -4, 1, 3, "#1A2230");
      } else {
        P(-2, -4, 1, 3, "#1A2230");
        P(1, -4, 1, 4, "#1A2230");
      }
      P(w.dir > 0 ? 3 : -5, -8, 2, 2, w.item);
    };
    const bot = (w: Walker) => {
      const x = w.x;
      const b = Math.floor(w.ph) % 2;
      px(x - 3, GY - 12, 6, 7, "#FFB454");
      px(x - 1 + w.dir, GY - 10, 2, 2, "#030A14");
      px(x, GY - 15, 1, 3, "#FFB454");
      px(x - 1, GY - 16, 3, 1, "#FF6B6B");
      px(x - 3, GY - 5, 6, 1, "#3A4B5C");
      px(x - 3 + b, GY - 4, 2, 2, "#3A4B5C");
      px(x + 1 - b, GY - 4, 2, 2, "#3A4B5C");
      px(x + (w.dir > 0 ? 3 : -5), GY - 9, 2, 2, w.item);
    };
    const draw = () => {
      g.setTransform(scene.width / SW, 0, 0, scene.height / SH, 0, 0);
      g.imageSmoothingEnabled = false;
      px(0, 0, SW, SH, "#000916");
      for (const [x, y, b] of stars) px(x, y, 1, 1, b ? "#EADFC4" : "#2A3A4A");
      px(0, GY, SW, SH - GY, "#07101E");
      px(0, GY, SW, 1, "#1A2E48");
      for (let i = 0; i < SW; i += 16) px(i, GY + 7, 8, 1, "#0F2036");
      lamp(30);
      lamp(230);
      drawShop();
      for (const w of walkers.current) (w.kind === "arb" ? bot(w) : person(w, w.kind === "whale" ? 2 : 1));
      g.font = '600 7px "Pixelify Sans", monospace';
      g.textAlign = "center";
      for (const f of floats.current) {
        g.globalAlpha = Math.max(0, Math.min(1, f.t));
        g.fillStyle = f.col;
        g.fillText(f.txt, f.x, f.y);
      }
      g.globalAlpha = 1;
    };
    const drawChart = () => {
      const W = chart.width;
      const H = chart.height;
      const d = window.devicePixelRatio || 1;
      const h = hist.current;
      c2.clearRect(0, 0, W, H);
      if (h.length < 2) return;
      let lo = Infinity;
      let hi = -Infinity;
      for (const [a, b] of h) {
        lo = Math.min(lo, a, b);
        hi = Math.max(hi, a, b);
      }
      const pad = (hi - lo) * 0.15 || lo * 0.01;
      lo -= pad;
      hi += pad;
      const X = (i: number) => (i / 119) * W;
      const Y = (v: number) => H - ((v - lo) / (hi - lo)) * H;
      const line = (k: 0 | 1, col: string, dash: number[]) => {
        c2.beginPath();
        c2.setLineDash(dash.map((v) => v * d));
        c2.strokeStyle = col;
        c2.lineWidth = 2 * d;
        h.forEach((p, i) => (i ? c2.lineTo(X(i), Y(p[k])) : c2.moveTo(X(i), Y(p[k]))));
        c2.stroke();
      };
      line(1, "#EADFC4", [4, 3]);
      line(0, "#4BA8FF", []);
      c2.setLineDash([]);
    };
    const resize = () => {
      const d = window.devicePixelRatio || 1;
      const w = scene.clientWidth || 520;
      scene.width = Math.round(w * d);
      scene.height = Math.round((w * d * SH) / SW);
      chart.width = Math.round((chart.clientWidth || 520) * d);
      chart.height = Math.round(80 * d);
    };
    const loop = (now: number) => {
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      if (running.current && visible.current) {
        acc += dt;
        while (acc > 0.35) {
          acc -= 0.35;
          tick();
        }
        for (const w of walkers.current) {
          w.ph += dt * 6;
          if (w.state === "in") {
            w.x += w.dir * w.v * dt;
            if (w.dir > 0 ? w.x >= w.stop : w.x <= w.stop) {
              w.x = w.stop;
              w.state = "wait";
              w.t = 0.45;
              w.act(w);
            }
          } else if (w.state === "wait") {
            w.t -= dt;
            if (w.t <= 0) {
              w.state = "out";
              w.dir = (w.dir * -1) as 1 | -1;
            }
          } else w.x += w.dir * w.v * dt;
        }
        walkers.current = walkers.current.filter((w) => w.x > -20 && w.x < SW + 20);
        for (const f of floats.current) {
          f.y -= dt * 10;
          f.t -= dt;
        }
        floats.current = floats.current.filter((f) => f.t > 0);
      }
      if (visible.current) {
        draw();
        drawChart();
      }
      raf = requestAnimationFrame(loop);
    };
    const io = new IntersectionObserver((es) => (visible.current = es[0].isIntersecting));
    io.observe(scene);
    const ro = new ResizeObserver(resize);
    ro.observe(scene);
    resize();
    raf = requestAnimationFrame(loop);
    return () => {
      cancelAnimationFrame(raf);
      io.disconnect();
      ro.disconnect();
    };
  }, [tick]);

  const act = (a: string) => {
    if (a === "buy") {
      const r = buyWithSol(pool.current, 1);
      pool.current = r.state;
      floatTxt(`+${f3(r.fee)}`, "#4BA8FF");
      pulse("fee");
      setLog(`You bought ${f0(r.coinDelta)} $${TICKER} for 1 SOL. The pool price is now above market, so expect an arb bot.`);
    } else if (a === "sell") {
      const r = sellCoins(pool.current, 10_000);
      pool.current = r.state;
      floatTxt(`+${f3(r.fee)}`, "#4BA8FF");
      pulse("fee");
      setLog(`You sold 10,000 $${TICKER} for ${f3(r.solDelta)} SOL. The pool price dipped below market.`);
    } else if (a === "whale") {
      setLog("A whale is walking up to the shop with 15 SOL…");
      spawn("whale", "L", (w) => {
        const p0 = poolPrice(pool.current);
        const r = buyWithSol(pool.current, 15);
        pool.current = r.state;
        w.item = COIN_COLOR;
        floatTxt(`+${f3(r.fee)}`, "#4BA8FF", w.x);
        pulse("fee");
        setLog(`The whale bought ${f0(r.coinDelta)} $${TICKER} and pushed the pool price up ${((poolPrice(pool.current) / p0 - 1) * 100).toFixed(1)}%. Big fee, but arb bots will sell into that gap.`);
        refresh();
      });
      if (!running.current) setLog("A whale is waiting outside. Press Play to let them in.");
    } else if (a === "dump") {
      pool.current = shock(pool.current, 0.65);
      pulse("loss");
      setLog(`Bad news: $${TICKER} fell 35% on other markets. Your pool still shows the old price, and arb bots are coming for the difference.`);
    } else if (a === "buyback") {
      if (pool.current.feePot < 0.0005) setLog("No fees to spend yet. Let some traders through first.");
      else {
        const r = buyback(pool.current);
        pool.current = r.state;
        floatTxt(`BURN ${f0(r.burned)}`, "#FFB454");
        setLog(`Bought back and burned ${f0(r.burned)} $${TICKER} with ${f3(r.spent)} SOL of fees.`);
      }
    } else if (a === "reset") reset();
    refresh();
  };

  return (
    <div className="game" id="game" aria-label="Pool simulator">
      <div className="g-top">
        <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
          <ShibaFace mood={mood} react={react} size={38} title={`Shopkeeper mood: ${mood}`} />
          <div>
            <b>Run the shop</b>
            <small>A simulated x·y=k pool for ${TICKER}. Watch how a market maker earns, and loses.</small>
          </div>
        </div>
        <button
          className="chipbtn"
          aria-pressed={paused}
          onClick={() => {
            running.current = !running.current;
            setPaused(!running.current);
          }}
        >
          {paused ? "Play" : "Pause"}
        </button>
      </div>
      <canvas ref={sceneRef} className="g-scene" role="img" aria-label="Pixel street where traders and arbitrage bots walk up to the shop to swap" />
      <div className="g-log" aria-live="polite">
        <span className="tag" style={{ margin: 0, flexShrink: 0 }}>
          SIMULATION
        </span>
        <span>{log}</span>
      </div>
      <div className="g-stats">
        <div>
          <small>Pool price, SOL per 1M</small>
          <strong>{(s.poolPrice * 1e6).toFixed(2)}</strong>
        </div>
        <div>
          <small>Market price, SOL per 1M</small>
          <strong>{(s.marketPrice * 1e6).toFixed(2)}</strong>
        </div>
        <div>
          <small>Fees earned, SOL</small>
          <strong className="pos">{f3(s.feesTotal)}</strong>
        </div>
        <div>
          <small>Lost to arbitrage, SOL</small>
          <strong className={s.arbLoss > 0 ? "neg" : ""}>{f3(s.arbLoss)}</strong>
        </div>
        <div>
          <small>P&amp;L vs. just holding</small>
          <strong className={s.vsHold >= 0 ? "pos" : "neg"}>
            {s.vsHold >= 0 ? "+" : ""}
            {f3(s.vsHold)} SOL
          </strong>
        </div>
        <div>
          <small>Burned ${TICKER}</small>
          <strong>{f0(s.burned)}</strong>
        </div>
      </div>
      <div className="g-leg">
        <span>
          <i style={{ background: "#4BA8FF" }} />
          Pool price
        </span>
        <span>
          <i style={{ background: "repeating-linear-gradient(90deg,#EADFC4 0 4px,transparent 4px 7px)" }} />
          Market price
        </span>
      </div>
      <canvas ref={chartRef} className="g-chart" role="img" aria-label="Chart of the pool price against the market price" />
      <div className="g-ctrl">
        <div className="seg" role="group" aria-label="Trading fee">
          <span>Fee</span>
          {FEE_TIERS.map((f) => (
            <button
              key={f}
              aria-pressed={fee === f}
              onClick={() => {
                pool.current = setFee(pool.current, f);
                setFeeUi(f);
                setLog(`Fee set to ${(f * 100).toFixed(2).replace(/0$/, "")}%. Higher fees earn more per trade and widen the band arbitrage can't touch, but fewer traders come.`);
              }}
            >
              {f === 0.0005 ? "0.05%" : f === 0.003 ? "0.3%" : "1%"}
            </button>
          ))}
        </div>
        <div className="seg" role="group" aria-label="Market volatility">
          <span>Market</span>
          {(Object.keys(VOLATILITY) as Volatility[]).map((v) => (
            <button
              key={v}
              aria-pressed={volName === v}
              onClick={() => {
                vol.current = VOLATILITY[v];
                setVolName(v);
                setLog(v === "wild" ? "Wild market. Prices swing hard, and arb bots will be busy." : v === "calm" ? "Calm market. Small moves, steady fees." : "Normal market conditions.");
              }}
            >
              {v[0].toUpperCase() + v.slice(1)}
            </button>
          ))}
        </div>
      </div>
      <div className="g-act">
        <button className="chipbtn" onClick={() => act("buy")}>
          Buy with 1 SOL
        </button>
        <button className="chipbtn" onClick={() => act("sell")}>
          Sell 10k
        </button>
        <button className="chipbtn" onClick={() => act("whale")}>
          Send a whale
        </button>
        <button className="chipbtn" onClick={() => act("dump")}>
          Bad news
        </button>
        <button className="chipbtn hl" onClick={() => act("buyback")}>
          {feePot > 0.0005 ? `Buy back ${f3(feePot)} SOL` : "Buy back with fees"}
        </button>
        <button className="chipbtn" onClick={() => act("reset")}>
          Reset pool
        </button>
      </div>
    </div>
  );
}
