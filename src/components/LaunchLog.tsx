"use client";
import { useEffect, useState } from "react";
import { EXPLORER } from "@/config/site";
import { api, short } from "@/lib/client/api";
import type { LogLine } from "@/lib/coins";

const time = (iso: string) => new Date(iso).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });
const pad = (s: string, n: number) => (s.length >= n ? s.slice(0, n) : s + " ".repeat(n - s.length));

export function LaunchLog({ initial }: { initial: LogLine[] }) {
  const [lines, setLines] = useState(initial);
  const [error, setError] = useState(false);
  useEffect(() => {
    let alive = true;
    const load = () =>
      api<{ lines: LogLine[] }>("/api/log")
        .then((r) => {
          if (!alive) return;
          setLines(r.lines);
          setError(false);
        })
        .catch(() => alive && setError(true));
    load();
    const t = setInterval(load, 20_000);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, []);

  return (
    <section className="block" id="log" aria-labelledby="log-h">
      <div className="wrap factory">
        <div className="l">
          <h2 id="log-h">Live launch log</h2>
          <p>Every coin opened through this site, and the trades on those coins, as they happen on Solana mainnet. Each line links to the transaction on Solscan.</p>
          <p>Trades are read from pump.fun&apos;s own on-chain events, so this feed shows what really happened.</p>
        </div>
        <div className="r">
          <div className="term" aria-label="Recent launches and trades" aria-live="polite" tabIndex={0}>
            <span className="g">Street log</span>
            {"\n"}
            {lines.length === 0 ? (
              <span>{error ? "Log unavailable right now. Retrying…" : "Waiting for the first shop to open…\nLaunches and trades will scroll in here."}</span>
            ) : (
              lines.map((l) => (
                <span key={`${l.signature}-${l.kind}`}>
                  <a href={EXPLORER.tx(l.signature)} target="_blank" rel="noopener noreferrer">
                    {time(l.at)} {pad(l.kind, 7)} {pad(`$${l.symbol}`, 11)}{" "}
                    {l.kind === "launch" ? (
                      <span className="g">shop opened</span>
                    ) : (
                      <span className={l.kind === "buy" ? "g" : "r"}>{pad(`${l.sol?.toFixed(3)} SOL`, 12)}</span>
                    )}{" "}
                    by {short(l.who)}
                  </a>
                  {"\n"}
                </span>
              ))
            )}
          </div>
          <a className="btn" href="#launch" style={{ justifySelf: "start" }}>
            Open a shop
          </a>
        </div>
      </div>
    </section>
  );
}
