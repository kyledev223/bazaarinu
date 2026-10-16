import { ShibaFace } from "@/components/mascot/ShibaFace";
import { Simulator } from "@/components/Simulator";
import { EXPLORER, SITE } from "@/config/site";

export function Hero() {
  return (
    <section className="hero" id="top">
      <div className="wrap hero-grid">
        <div>
          <div className="hero-hello">
            <ShibaFace mood="happy" size={52} title="Kibo the shopkeeper Shiba, waving hello" />
            <span>Hi, I&apos;m Kibo. I keep the shops on this street.</span>
          </div>
          <h1>
            <span>Launch a coin.</span>
            <span>Open the shop.</span>
          </h1>
          <p className="lede">Bazaar Inu launches real coins on pump.fun from your own wallet, gives each one a shopfront on the street, and shows exactly what a transaction does before you sign it.</p>
          <div className="cta">
            <a className="btn" href="#launch">
              Open your shop
            </a>
            <a className="btn ghost" href="#market">
              Walk the market
            </a>
          </div>
          <ul className="facts">
            <li>Solana mainnet only</li>
            <li>Real pump.fun launches</li>
            <li>One transaction to sign</li>
            <li>Live dashboard per shop</li>
          </ul>
        </div>
        <Simulator />
      </div>
    </section>
  );
}

export function HowItWorks() {
  const steps = [
    ["Connect your wallet", "Phantom, Solflare, Backpack or OKX. Then sign a free message so we know the wallet is yours."],
    ["Fill in the shop sign", "Name, ticker, image and description, optional links, and an optional dev buy."],
    ["Check, then approve", "We dry-run the transaction and show its cost. Your wallet signs it; we never see your keys."],
    ["Live on the bonding curve", "The coin is created on pump.fun. Anyone can buy and sell it on its bonding curve straight away."],
    ["Graduates to PumpSwap", "When the curve fills up, pump.fun moves the liquidity into a PumpSwap pool and trading carries on there."],
    ["Run your shop", "Follow it on the Market, claim pump.fun creator fees and buy back your coin from My shops."],
  ];
  return (
    <section className="block" id="how" aria-labelledby="how-h">
      <div className="wrap">
        <h2 id="how-h">How a launch runs</h2>
        <p className="sub">The real flow, in the order it happens. Nothing here is simulated.</p>
        <ol className="steps">
          {steps.map(([h, p]) => (
            <li key={h}>
              <h3>{h}</h3>
              <p>{p}</p>
            </li>
          ))}
        </ol>
      </div>
    </section>
  );
}

export function Flywheel() {
  const labels: [string, string][] = [
    ["More coins", "+ shops open"],
    ["More trading", "+ volume"],
    ["More fees", "for creators"],
    ["Buybacks", "of their coins"],
    ["More holders", "+ new creators"],
  ];
  const cx = 220;
  const cy = 220;
  const R = 150;
  return (
    <section className="block" id="token" aria-labelledby="fly-h">
      <div className="wrap fly">
        <div>
          <h2 id="fly-h">The street flywheel</h2>
          <p className="sub" style={{ marginBottom: 20 }}>
            Each new shop brings traders to the street. Trading pays pump.fun creator fees, creators can put those fees into buying back their own coins, and a busier street draws the next creator.
          </p>
          <ul>
            {labels.map(([a, b], i) => (
              <li key={a}>
                <b>{i + 1}</b>
                {a} {b.replace(/^\+ /, "and ")}
              </li>
            ))}
          </ul>
          <p className="hint" style={{ marginTop: 18 }}>
            {SITE.officialMint ? (
              <>
                The official ${SITE.short} mint is{" "}
                <a href={EXPLORER.token(SITE.officialMint)} target="_blank" rel="noopener noreferrer" style={{ color: "var(--accent-text)" }}>
                  {SITE.officialMint}
                </a>
                . Anything else using the name isn&apos;t ours.
              </>
            ) : (
              <>There is no official ${SITE.short} token yet. Until a mint address appears right here, any coin claiming to be it isn&apos;t ours.</>
            )}
          </p>
        </div>
        <svg viewBox="0 0 440 440" className="fly-svg" role="img" aria-label="Flywheel: more coins, more trading, more fees, buybacks and more holders feed each other in a loop">
          <circle className="fly-spin" cx={cx} cy={cy} r={R} fill="none" stroke="var(--line)" strokeWidth="3" strokeDasharray="8 8" />
          <rect className="fly-runner" x="-5" y="-5" width="10" height="10" fill="var(--accent)" style={{ filter: "drop-shadow(0 0 6px var(--accent))" }} />
          {labels.map((l, i) => {
            const a = -Math.PI / 2 + (i * 2 * Math.PI) / 5;
            const x = cx + R * Math.cos(a);
            const y = cy + R * Math.sin(a);
            const a2 = a + Math.PI / 5;
            const ax = cx + R * Math.cos(a2);
            const ay = cy + R * Math.sin(a2);
            const rot = (a2 * 180) / Math.PI + 90;
            return (
              <g key={l[0]}>
                <g transform={`translate(${ax},${ay}) rotate(${rot})`}>
                  <polygon points="-7,-6 7,0 -7,6" fill="var(--accent)" />
                </g>
                <rect x={x - 62} y={y - 26} width="124" height="52" fill="var(--panel)" stroke="var(--accent)" strokeWidth="2" />
                <text x={x} y={y - 3} textAnchor="middle" fill="var(--panel-text)" fontSize="14" fontWeight="600">
                  {l[0]}
                </text>
                <text x={x} y={y + 15} textAnchor="middle" fill="var(--panel-muted)" fontSize="13">
                  {l[1]}
                </text>
              </g>
            );
          })}
          <g transform={`translate(${cx - 50},${cy - 50})`}>
            <ShibaFace mood="happy" size={100} title="Kibo at the centre of the flywheel" />
          </g>
          <text x={cx} y={cy + 66} textAnchor="middle" fill="var(--muted)" fontSize="12">
            your shop
          </text>
        </svg>
      </div>
    </section>
  );
}

export function Compare() {
  return (
    <section className="block" aria-labelledby="cmp-h">
      <div className="wrap">
        <h2 id="cmp-h">Not just another launch button</h2>
        <p className="sub">pump.fun made launching a coin open to anyone. We add a clear view of what you&apos;re signing and a place for the coin to live afterwards.</p>
        <div className="compare">
          <div>
            <h3>A typical launch</h3>
            <ul>
              <li>A form, then a wallet popup full of unknowns</li>
              <li>Costs only show up after you&apos;ve signed</li>
              <li>The coin vanishes into a list of thousands</li>
              <li>Creator tools are scattered across sites</li>
            </ul>
          </div>
          <div>
            <h3>A launch on Bazaar Inu</h3>
            <ul>
              <li>A real pump.fun coin, created from your own wallet</li>
              <li>Every transaction dry-run and explained before your wallet opens</li>
              <li>The server only forwards transactions that match what you approved</li>
              <li>A shopfront, live dashboard, fee claims and buybacks in one place</li>
            </ul>
          </div>
        </div>
      </div>
    </section>
  );
}

export function WhatYouGet() {
  const items = [
    ["Real coin", "Created by pump.fun's own program on mainnet."],
    ["Your keys only", "Signing happens in your wallet, never here."],
    ["Live dashboard", "Market cap, curve progress, trades, holders."],
    ["Creator fees", "See and claim pump.fun creator fees."],
    ["Buybacks", "Buy your own coin back from My shops."],
  ];
  return (
    <section className="block" aria-labelledby="get-h">
      <div className="wrap">
        <h2 id="get-h">What every shop gets</h2>
        <p className="sub">No platform fee. You pay only Solana network fees, account rent and any SOL you choose to spend.</p>
        <div className="rev">
          {items.map(([b, s]) => (
            <div key={b}>
              <b>{b}</b>
              <span>{s}</span>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

export function RiskAndFooter() {
  return (
    <footer className="site-footer">
      <div className="wrap">
        <span>
          <b className="pixel" style={{ color: "var(--accent-text)", fontSize: 18 }}>
            BAZAAR INU
          </b>
          &nbsp; {SITE.tagline}
        </span>
        <span>Non-custodial. Solana mainnet only. We never ask for a seed phrase.</span>
        <small className="disclaimer">
          Not financial advice. Tokens are high-risk and transactions can&apos;t be reversed. Creators are responsible for complying with their local laws. Not affiliated with pump.fun.
        </small>
      </div>
    </footer>
  );
}
