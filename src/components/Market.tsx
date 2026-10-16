"use client";
import { Fragment, useEffect, useState } from "react";
import { LampPost, PixelShop, awningFor } from "@/components/PixelShop";
import { ShibaFace } from "@/components/mascot/ShibaFace";
import { EXPLORER } from "@/config/site";
import { api, short } from "@/lib/client/api";
import type { CoinView, TradeView } from "@/lib/coins";

export const ago = (iso: string) => {
  const s = Math.max(0, (Date.now() - Date.parse(iso)) / 1000);
  if (s < 60) return `${Math.floor(s)}s ago`;
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
};
export const solFmt = (n: number | null, d = 2) => (n === null ? "—" : `${n.toLocaleString("en-US", { maximumFractionDigits: d })} SOL`);
export const usdFmt = (n: number | null) =>
  n === null ? "—" : n >= 1e6 ? `$${(n / 1e6).toFixed(2)}M` : n >= 1e4 ? `$${(n / 1e3).toFixed(1)}k` : `$${n.toLocaleString("en-US", { maximumFractionDigits: 0 })}`;
const priceFmt = (n: number | null) => (n === null ? "—" : n < 0.0001 ? `${(n * 1e6).toFixed(3)} SOL/1M` : `${n.toPrecision(3)} SOL`);

export function CoinDashboard({ coin, trades, loading }: { coin: CoinView; trades: TradeView[] | null; loading?: boolean }) {
  return (
    <div className="dash" data-testid="coin-dashboard">
      <div className="head">
        <h3>
          {coin.imageUri ? <img src={coin.imageUri} alt="" width={44} height={44} /> : null}${coin.symbol}
        </h3>
        <p>
          {coin.name}
          {coin.description ? ` · ${coin.description.slice(0, 160)}${coin.description.length > 160 ? "…" : ""}` : ""}
        </p>
        <div className="chips">
          <span className="chip">{coin.graduated ? "Graduated to PumpSwap" : coin.complete ? "Curve complete, migrating" : "On the bonding curve"}</span>
          <a className="chip" href={EXPLORER.pump(coin.mint)} target="_blank" rel="noopener noreferrer">
            pump.fun ↗
          </a>
          <a className="chip" href={EXPLORER.token(coin.mint)} target="_blank" rel="noopener noreferrer">
            Solscan ↗
          </a>
          {coin.twitter && (
            <a className="chip" href={coin.twitter} target="_blank" rel="noopener noreferrer nofollow">
              X ↗
            </a>
          )}
          {coin.telegram && (
            <a className="chip" href={coin.telegram} target="_blank" rel="noopener noreferrer nofollow">
              Telegram ↗
            </a>
          )}
          {coin.website && (
            <a className="chip" href={coin.website} target="_blank" rel="noopener noreferrer nofollow">
              Website ↗
            </a>
          )}
        </div>
        <div style={{ marginTop: 18 }}>
          <small style={{ color: "var(--muted)", fontSize: 13 }}>Bonding-curve progress {coin.progressPct !== null ? `${coin.progressPct.toFixed(1)}%` : ""}</small>
          <div className="progress" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={coin.progressPct ?? 0} aria-label="Bonding curve progress">
            <i style={{ width: `${Math.min(100, coin.progressPct ?? 0)}%` }} />
          </div>
          <small style={{ color: "var(--muted)", fontSize: 12 }}>At 100% the coin graduates and trading moves to a PumpSwap pool.</small>
        </div>
        <div style={{ marginTop: 18 }}>
          <small style={{ color: "var(--muted)", fontSize: 13 }}>Recent trades</small>
          {loading && !trades ? (
            <p className="hint">Loading trades…</p>
          ) : trades && trades.length ? (
            <div style={{ overflowX: "auto" }}>
              <table className="trades">
                <thead>
                  <tr>
                    <th>Side</th>
                    <th>SOL</th>
                    <th>Trader</th>
                    <th>When</th>
                  </tr>
                </thead>
                <tbody>
                  {trades.slice(0, 8).map((t) => (
                    <tr key={t.signature}>
                      <td className={t.isBuy ? "pos" : "neg"}>{t.isBuy ? "Buy" : "Sell"}</td>
                      <td>{t.sol.toFixed(3)}</td>
                      <td>
                        <a href={EXPLORER.account(t.trader)} target="_blank" rel="noopener noreferrer">
                          {short(t.trader)}
                        </a>
                      </td>
                      <td>
                        <a href={EXPLORER.tx(t.signature)} target="_blank" rel="noopener noreferrer">
                          {ago(t.at)}
                        </a>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="hint">No trades recorded yet. They appear here within a few minutes of happening.</p>
          )}
        </div>
      </div>
      <div className="kv">
        <div>
          <small>Market cap</small>
          <strong>{solFmt(coin.marketCapSol, 1)}</strong>
        </div>
        <div>
          <small>Market cap, USD</small>
          <strong>{usdFmt(coin.marketCapUsd)}</strong>
        </div>
        <div>
          <small>Price</small>
          <strong>{priceFmt(coin.priceSol)}</strong>
        </div>
        <div>
          <small>Curve progress</small>
          <strong>{coin.progressPct !== null ? `${coin.progressPct.toFixed(1)}%` : "—"}</strong>
        </div>
        <div>
          <small>Holders</small>
          <strong>{coin.holders ?? "n/a"}</strong>
        </div>
        <div>
          <small>Opened</small>
          <strong>{ago(coin.createdAt)}</strong>
        </div>
        <div style={{ gridColumn: "1 / -1", borderRight: 0 }}>
          <small>Creator</small>
          <strong style={{ fontSize: 15 }}>
            <a href={EXPLORER.account(coin.creator)} target="_blank" rel="noopener noreferrer" style={{ color: "var(--accent-text)" }}>
              {short(coin.creator)}
            </a>
          </strong>
          <small style={{ marginTop: 6 }}>Stats {coin.statsUpdatedAt ? `updated ${ago(coin.statsUpdatedAt)}` : "pending"} from the bonding curve on Solana mainnet.</small>
        </div>
      </div>
    </div>
  );
}

export function Market({ initial, dbError }: { initial: CoinView[]; dbError?: boolean }) {
  const [coins, setCoins] = useState<CoinView[]>(initial);
  const [selected, setSelected] = useState<string | null>(initial[0]?.mint ?? null);
  const [trades, setTrades] = useState<Record<string, TradeView[]>>({});
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(dbError ? "The market is temporarily unavailable." : null);

  useEffect(() => {
    let alive = true;
    const load = () =>
      api<{ coins: CoinView[] }>("/api/coins")
        .then((r) => {
          if (!alive) return;
          setCoins(r.coins);
          setError(null);
          setSelected((s) => s ?? r.coins[0]?.mint ?? null);
        })
        .catch((e) => alive && setError(e.message));
    const t = setInterval(load, 30_000);
    if (dbError) load();
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, [dbError]);

  useEffect(() => {
    if (!selected) return;
    setLoading(true);
    api<{ trades: TradeView[]; coin: CoinView }>(`/api/coins/${selected}`)
      .then((r) => {
        setTrades((t) => ({ ...t, [selected]: r.trades }));
        setCoins((cs) => cs.map((c) => (c.mint === r.coin.mint ? r.coin : c)));
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [selected]);

  const coin = coins.find((c) => c.mint === selected) ?? null;

  return (
    <section className="block" id="market" aria-labelledby="market-h">
      <div className="wrap">
        <h2 id="market-h">The market</h2>
        <p className="sub">Every coin launched here gets a shopfront on the street. Pick one to see its dashboard: market cap, bonding-curve progress, recent trades and holders, read live from Solana.</p>
        <div className="street">
          {coins.length ? (
            <div className="street-row" data-testid="street">
              {coins.map((c, i) => (
                <Fragment key={c.mint}>
                  {i % 2 === 0 && <LampPost />}
                  <button className="shop" aria-pressed={c.mint === selected} onClick={() => setSelected(c.mint)} aria-label={`${c.name} ($${c.symbol}) shop`}>
                    <PixelShop ticker={c.symbol} awning={awningFor(c.mint)} image={c.imageUri} />
                    <span className="ticker">
                      ${c.symbol} · {usdFmt(c.marketCapUsd)}
                    </span>
                  </button>
                </Fragment>
              ))}
              <LampPost />
            </div>
          ) : (
            <div className="empty-lot" data-testid="market-empty">
              <ShibaFace mood="sleeping" size={110} title="The shopkeeper Shiba, asleep: no shops yet" />
              <div>
                <b>{error ? "The street is closed for a moment" : "No shops open yet"}</b>
                <p>{error ? `${error} Try again shortly.` : "Coins appear here the moment they are really launched through this site. Nothing on this street is a sample."}</p>
                {!error && (
                  <a className="btn sm" href="#launch" style={{ marginTop: 12 }}>
                    Open the first shop
                  </a>
                )}
              </div>
            </div>
          )}
          <div className="curb" />
          <div className="street-note">
            {coins.length ? `${coins.length} shop${coins.length === 1 ? "" : "s"} open. Live data from Solana mainnet; USD uses the latest SOL price.` : "Only real launches are shown. No placeholders."}
          </div>
        </div>
        {coin && <CoinDashboard coin={coin} trades={trades[coin.mint] ?? null} loading={loading} />}
      </div>
    </section>
  );
}
