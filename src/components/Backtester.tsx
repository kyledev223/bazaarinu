"use client";
import { useEffect, useMemo, useState } from "react";
import { STRATEGIES, runBacktest, summarize, type BacktestResult, type Strategy } from "@/lib/backtest/engine";
import type { History } from "@/lib/backtest/history";
import { ShibaFace } from "@/components/mascot/ShibaFace";
import { api, ApiError } from "@/lib/client/api";

const MARKETS = [
  { id: "BONK", label: "BONK" },
  { id: "WIF", label: "dogwifhat (WIF)" },
  { id: "JUP", label: "Jupiter (JUP)" },
  { id: "SOL", label: "SOL" },
] as const;
const PAIRS = ["SOL", "USDC", "USDT"] as const;
const FEES = [0.0005, 0.003, 0.01];

function fmt(n: number, unit: string) {
  const a = Math.abs(n);
  const s = a === 0 ? "0" : a < 0.01 ? n.toFixed(5) : a < 10 ? n.toFixed(3) : n.toLocaleString("en-US", { maximumFractionDigits: 1 });
  return `${n > 0 ? "+" : ""}${s} ${unit}`;
}

function Chart({ r, unit }: { r: BacktestResult; unit: string }) {
  const W = 600;
  const H = 200;
  const pts = r.points;
  const vals = pts.flatMap((p) => [p.strategy, p.hold]);
  let lo = Math.min(...vals);
  let hi = Math.max(...vals);
  const pad = (hi - lo) * 0.1 || hi * 0.01 || 1;
  lo -= pad;
  hi += pad;
  const X = (i: number) => (i / Math.max(1, pts.length - 1)) * W;
  const Y = (v: number) => H - ((v - lo) / (hi - lo)) * H;
  const line = (k: "strategy" | "hold") => pts.map((p, i) => `${X(i).toFixed(1)},${Y(p[k]).toFixed(1)}`).join(" ");
  // shade spans where the position was out of range
  const out: [number, number][] = [];
  let start = -1;
  pts.forEach((p, i) => {
    if (!p.inRange && start < 0) start = i;
    if ((p.inRange || i === pts.length - 1) && start >= 0) {
      out.push([start, i]);
      start = -1;
    }
  });
  return (
    <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" className="bt-chart" role="img" aria-label={`Position value plus fees versus holding, in ${unit}`}>
      {out.map(([a, b]) => (
        <rect key={a} x={X(a)} y={0} width={Math.max(1, X(b) - X(a))} height={H} fill="var(--bad)" opacity="0.08" />
      ))}
      <polyline points={line("hold")} fill="none" stroke="var(--panel-muted)" strokeWidth="2" strokeDasharray="5 4" vectorEffect="non-scaling-stroke" />
      <polyline points={line("strategy")} fill="none" stroke="var(--accent)" strokeWidth="2.5" vectorEffect="non-scaling-stroke" />
    </svg>
  );
}

export function Backtester() {
  const [strategy, setStrategy] = useState<Strategy>("concentrated");
  const [fee, setFee] = useState(0.003);
  const [range, setRange] = useState(25);
  const [buyback, setBuyback] = useState(40);
  const [seed, setSeed] = useState("10");
  const [market, setMarket] = useState<(typeof MARKETS)[number]["id"]>("BONK");
  const [pair, setPair] = useState<(typeof PAIRS)[number]>("SOL");
  const [days, setDays] = useState(30);
  const [hist, setHist] = useState<Record<string, History>>({});
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const key = `${market}:${pair}:${days}`;
  const h = hist[key];
  const sameAsset = market === pair;

  const load = async () => {
    if (sameAsset) return;
    setLoading(true);
    setError(null);
    try {
      const r = await api<{ history: History }>(`/api/backtest/history?market=${market}&pair=${pair}&days=${days}`);
      setHist((x) => ({ ...x, [key]: r.history }));
    } catch (e) {
      setError(e instanceof ApiError ? `${e.message} (${e.code})` : String(e));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (market === pair) setPair(market === "SOL" ? "USDC" : "SOL");
  }, [market, pair]);

  const result = useMemo(() => {
    if (!h) return null;
    const seedN = Number(seed);
    if (!(seedN > 0)) return null;
    try {
      return runBacktest({ candles: h.candles, strategy, feeTier: fee, rangePct: range, buybackShare: buyback / 100, seed: seedN, poolLiquidity: h.poolLiquidity });
    } catch {
      return null;
    }
  }, [h, strategy, fee, range, buyback, seed]);

  const isFull = strategy === "constant";

  return (
    <section className="block" id="backtest" aria-labelledby="bt-h">
      <div className="wrap">
        <span className="tag warn">ANALYSIS ON PAST DATA · NOT A LAUNCH SETTING</span>
        <h2 id="bt-h">Test a strategy</h2>
        <p className="sub">Pick how a liquidity position would trade, then replay real hourly prices from a Solana pool through it. This is a learning tool: it doesn&apos;t configure your pump.fun launch, and past prices don&apos;t predict future ones.</p>
        <div className="launch">
          <form
            className="cfg"
            onSubmit={(e) => {
              e.preventDefault();
              load();
            }}
            aria-label="Backtest settings"
          >
            <fieldset>
              <legend>Strategy</legend>
              <div className="strats">
                {STRATEGIES.map((s) => (
                  <div className="opt" key={s.id}>
                    <input type="radio" name="strat" id={`s-${s.id}`} checked={strategy === s.id} onChange={() => setStrategy(s.id)} />
                    <label htmlFor={`s-${s.id}`}>
                      <b>{s.label}</b>
                      <small>{s.blurb}</small>
                    </label>
                  </div>
                ))}
              </div>
            </fieldset>
            <fieldset>
              <legend>Trading fee</legend>
              <div className="tiers">
                {FEES.map((f) => (
                  <div className="opt" key={f}>
                    <input type="radio" name="fee" id={`f-${f}`} checked={fee === f} onChange={() => setFee(f)} />
                    <label htmlFor={`f-${f}`}>{(f * 100).toFixed(2)}%</label>
                  </div>
                ))}
              </div>
            </fieldset>
            <label className="f">
              <span>
                Liquidity range <output className="rangeval">{isFull ? "Full" : `±${range}%`}</output>
              </span>
              <input type="range" min={2} max={100} value={range} onChange={(e) => setRange(Number(e.target.value))} disabled={isFull} aria-describedby="range-hint" />
              <span className="hint" id="range-hint">
                {isFull ? "Constant product spreads liquidity over every price, so there is no range to set." : "Tighter ranges earn more per trade but fall out of range sooner."}
              </span>
            </label>
            <label className="f">
              <span>
                Buyback share of fees <output className="rangeval">{buyback}%</output>
              </span>
              <input type="range" min={0} max={100} step={5} value={buyback} onChange={(e) => setBuyback(Number(e.target.value))} />
            </label>
            <div className="row2">
              <label className="f">
                Seed liquidity ({pair})
                <input type="number" min={0.01} step={0.1} value={seed} onChange={(e) => setSeed(e.target.value)} />
              </label>
              <label className="f">
                Market to replay
                <select value={market} onChange={(e) => setMarket(e.target.value as typeof market)}>
                  {MARKETS.map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.label}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            <div className="row2">
              <fieldset>
                <legend>Paired with</legend>
                <div className="tiers">
                  {PAIRS.map((p) => (
                    <div className="opt" key={p}>
                      <input type="radio" name="pair" id={`p-${p}`} checked={pair === p} disabled={p === market} onChange={() => setPair(p)} />
                      <label htmlFor={`p-${p}`}>{p}</label>
                    </div>
                  ))}
                </div>
              </fieldset>
              <fieldset>
                <legend>Period</legend>
                <div className="tiers">
                  {[7, 30].map((d) => (
                    <div className="opt" key={d}>
                      <input type="radio" name="days" id={`d-${d}`} checked={days === d} onChange={() => setDays(d)} />
                      <label htmlFor={`d-${d}`}>{d} days</label>
                    </div>
                  ))}
                </div>
              </fieldset>
            </div>
            <button className="btn" type="submit" disabled={loading || sameAsset} style={{ justifySelf: "start" }}>
              {loading ? "Fetching prices…" : h ? "Refresh prices" : "Run backtest"}
            </button>
          </form>

          <aside className="bt-out" aria-label="Backtest results" aria-live="polite">
            <div className="g-top" style={{ borderColor: "var(--line)" }}>
              <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
                <ShibaFace mood={error ? "worried" : result && result.netVsHold < 0 ? "worried" : "chart"} size={44} title="Shiba reading the chart" />
                <div>
                  <b style={{ color: "var(--accent-text)" }}>
                    {market}/{pair}
                  </b>
                  <small style={{ color: "var(--panel-muted)" }}>
                    {h ? `${h.candles.length} hourly prices · ${h.poolName ?? h.source} · via ${h.source}` : "Run a backtest to load real prices"}
                  </small>
                </div>
              </div>
            </div>
            {error && (
              <p className="status err" style={{ padding: "0 20px" }}>
                {error}
              </p>
            )}
            {result && h ? (
              <>
                <div className="kv">
                  <div>
                    <small>Fees earned</small>
                    <strong className="pos">{fmt(result.fees, pair)}</strong>
                  </div>
                  <div>
                    <small>Impermanent loss</small>
                    <strong className={result.impermanentLoss < 0 ? "neg" : "pos"}>{fmt(result.impermanentLoss, pair)}</strong>
                  </div>
                  <div>
                    <small>Net vs. holding</small>
                    <strong className={result.netVsHold < 0 ? "neg" : "pos"}>{fmt(result.netVsHold, pair)}</strong>
                  </div>
                  <div>
                    <small>Time in range</small>
                    <strong>{(result.timeInRange * 100).toFixed(1)}%</strong>
                  </div>
                  <div>
                    <small>Bought back</small>
                    <strong>{Math.round(result.buybackCoins).toLocaleString("en-US")}</strong>
                    <small>{market} for {fmt(result.buybackSpend, pair).replace("+", "")}</small>
                  </div>
                  <div>
                    <small>Re-centred</small>
                    <strong>{result.rebalances}×</strong>
                  </div>
                </div>
                <div className="g-leg">
                  <span>
                    <i style={{ background: "var(--accent)" }} />
                    Position + fees
                  </span>
                  <span>
                    <i style={{ background: "repeating-linear-gradient(90deg,var(--panel-muted) 0 4px,transparent 4px 7px)" }} />
                    Just holding
                  </span>
                  {!isFull && <span>Shaded: out of range</span>}
                </div>
                <div style={{ padding: "6px 14px 0" }}>
                  <Chart r={result} unit={pair} />
                </div>
                <div className="bt-summary">{summarize(result, { strategy, quote: pair, base: market, days: h.days })}</div>
                <p className="hint" style={{ padding: "0 20px 16px", margin: 0 }}>
                  Assumes your liquidity earns its share of the real pool&apos;s hourly volume ({Math.round(h.poolLiquidity).toLocaleString("en-US")} {pair} of liquidity) and that traders don&apos;t react to your fee. Rebalancing pays the fee on half the position.
                </p>
              </>
            ) : (
              !error && (
                <p className="hint" style={{ padding: "20px" }}>
                  Results appear here: fees, impermanent loss, net result against simply holding, time in range, and what the buyback share would have bought.
                </p>
              )
            )}
          </aside>
        </div>
      </div>
    </section>
  );
}
