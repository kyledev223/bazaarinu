"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { Transaction } from "@solana/web3.js";
import { useWallet } from "@solana/wallet-adapter-react";
import { CoinDashboard } from "@/components/Market";
import { PixelShop, awningFor } from "@/components/PixelShop";
import { ShibaFace } from "@/components/mascot/ShibaFace";
import { useUi } from "@/components/wallet/WalletProviders";
import { useToast } from "@/components/Toast";
import { EXPLORER, LIMITS } from "@/config/site";
import { ApiError, api, b64ToBytes, bytesToB64, fmtSol } from "@/lib/client/api";
import type { CoinView } from "@/lib/coins";

interface Estimate {
  totalLamports: string;
  networkFeeLamports: string;
  rentLamports: string;
  spendLamports: string;
  exact: boolean;
  balanceLamports: string;
}
interface Pending {
  kind: "buyback" | "claim";
  intentId: string;
  tx: string;
  estimate: Estimate;
  lines: string[];
  coin?: CoinView;
  claimable?: string;
}
interface Fees {
  vaultLamports: string;
  bucketLamports: string;
  totalLamports: string;
}

export function ShopsDashboard() {
  const { publicKey, signTransaction } = useWallet();
  const { openConnect } = useUi();
  const wallet = publicKey?.toBase58() ?? null;
  const toast = useToast();
  const [coins, setCoins] = useState<CoinView[] | null>(null);
  const [launches, setLaunches] = useState<{ id: string; name: string; symbol: string; status: string; reason: string | null }[]>([]);
  const [fees, setFees] = useState<Fees | null>(null);
  const [feesError, setFeesError] = useState<string | null>(null);
  const [amounts, setAmounts] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ text: string; bad?: boolean; sig?: string } | null>(null);
  const [pending, setPending] = useState<Pending | null>(null);
  const dlg = useRef<HTMLDialogElement>(null);

  const load = useCallback(async () => {
    if (!wallet) return;
    try {
      const r = await api<{ coins: CoinView[]; launches: typeof launches }>(`/api/my/coins?wallet=${wallet}`);
      setCoins(r.coins);
      setLaunches(r.launches);
    } catch (e) {
      setMsg({ text: (e as Error).message, bad: true });
    }
    try {
      setFees(await api<Fees>(`/api/my/fees?wallet=${wallet}`));
      setFeesError(null);
    } catch (e) {
      setFeesError(e instanceof ApiError ? `${e.message} (${e.code})` : String(e));
    }
  }, [wallet]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    const d = dlg.current;
    if (!d) return;
    if (pending && !d.open) d.showModal();
    if (!pending && d.open) d.close();
  }, [pending]);

  const buildBuyback = async (coin: CoinView) => {
    const sol = Number(amounts[coin.mint] ?? "0.05");
    if (!(sol >= LIMITS.buybackMinSol && sol <= LIMITS.buybackMaxSol)) return setMsg({ text: `Choose between ${LIMITS.buybackMinSol} and ${LIMITS.buybackMaxSol} SOL.`, bad: true });
    setBusy(coin.mint);
    setMsg(null);
    try {
      const r = await api<{ intentId: string; tx: string; estimate: Estimate; venue: "curve" | "pool" }>("/api/buyback/build", {
        method: "POST",
        json: { mint: coin.mint, sol, wallet: publicKey?.toBase58() },
      });
      setPending({
        kind: "buyback",
        intentId: r.intentId,
        tx: r.tx,
        estimate: r.estimate,
        coin,
        lines: [
          `Spend up to ${fmtSol(r.estimate.spendLamports, 4)} buying $${coin.symbol} ${r.venue === "pool" ? "from its PumpSwap pool" : "on its pump.fun bonding curve"}.`,
          "The coins go to your own wallet. Nothing else is in this transaction.",
        ],
      });
    } catch (e) {
      setMsg({ text: e instanceof ApiError ? `${e.message} (${e.code})` : String(e), bad: true });
    } finally {
      setBusy(null);
    }
  };

  const buildClaim = async () => {
    setBusy("claim");
    setMsg(null);
    try {
      const r = await api<{ intentId: string; tx: string; estimate: Estimate; claimableLamports: string }>("/api/fees/build", { method: "POST", json: { wallet: publicKey?.toBase58() } });
      setPending({
        kind: "claim",
        intentId: r.intentId,
        tx: r.tx,
        estimate: r.estimate,
        claimable: r.claimableLamports,
        lines: [`Collect about ${fmtSol(r.claimableLamports, 6)} of pump.fun creator fees into this wallet.`, "It only moves fees that already belong to you."],
      });
    } catch (e) {
      setMsg({ text: e instanceof ApiError ? `${e.message} (${e.code})` : String(e), bad: true });
    } finally {
      setBusy(null);
    }
  };

  const approve = async () => {
    const p = pending;
    if (!p || !publicKey) return;
    if (!signTransaction) return setMsg({ text: "This wallet can't sign transactions here.", bad: true });
    setPending(null);
    setBusy(p.kind === "claim" ? "claim" : p.coin!.mint);
    try {
      let signed: Transaction;
      try {
        signed = await signTransaction(Transaction.from(b64ToBytes(p.tx)));
      } catch (e) {
        const m = String((e as Error)?.message ?? e);
        return setMsg({ text: /reject|denied|cancel|declin/i.test(m) ? "You declined in your wallet. Nothing was sent." : `Your wallet couldn't sign: ${m}`, bad: true });
      }
      const route = p.kind === "claim" ? "/api/fees/relay" : "/api/buyback/relay";
      const { signature } = await api<{ signature: string }>(route, { method: "POST", json: { intentId: p.intentId, tx: bytesToB64(signed.serialize()), wallet: publicKey.toBase58() } });
      setMsg({ text: "Sent. Waiting for confirmation…", sig: signature });
      for (let i = 0; i < 45; i++) {
        await new Promise((r) => setTimeout(r, 2000));
        const s = await api<{ status: string; reason: string | null }>(`/api/intents/${p.intentId}`).catch(() => null);
        if (s?.status === "confirmed") {
          setMsg({ text: p.kind === "claim" ? "Creator fees claimed." : `Bought back $${p.coin!.symbol}.`, sig: signature });
          toast(p.kind === "claim" ? "Fees claimed" : "Buyback confirmed");
          load();
          return;
        }
        if (s && (s.status === "failed" || s.status === "expired")) return setMsg({ text: s.reason ?? "It didn't go through.", bad: true, sig: signature });
      }
      setMsg({ text: "Not confirmed yet. Check Solscan before trying again.", sig: signature, bad: true });
    } catch (e) {
      setMsg({ text: e instanceof ApiError ? `${e.message} (${e.code})` : String(e), bad: true });
    } finally {
      setBusy(null);
    }
  };

  if (!publicKey) {
    return (
      <section className="block">
        <div className="wrap">
          <h2>My shops</h2>
          <div className="empty-lot" style={{ border: "2px solid var(--line)", padding: 24 }}>
            <ShibaFace mood="sleeping" size={100} />
            <div>
              <b>Connect your wallet</b>
              <p>Your shops, live stats, creator fees and buybacks live here.</p>
              <button className="btn sm" style={{ marginTop: 12 }} onClick={openConnect}>
                Connect wallet
              </button>
            </div>
          </div>
        </div>
      </section>
    );
  }

  return (
    <section className="block">
      <div className="wrap">
        <h2>My shops</h2>
        <p className="sub">Coins this wallet launched through Bazaar Inu, with live stats from Solana mainnet.</p>

        <div className="feebox" data-testid="fees">
          <div>
            <small>Claimable pump.fun creator fees</small>
            <strong>{fees ? fmtSol(fees.totalLamports, 6) : feesError ? "Unavailable" : "Loading…"}</strong>
            {fees && BigInt(fees.bucketLamports) > 0n && <small>Includes {fmtSol(fees.bucketLamports, 6)} still on bonding curves; claiming sweeps it first.</small>}
            {feesError && <small className="err">{feesError}</small>}
          </div>
          <button className="btn" disabled={!fees || BigInt(fees.totalLamports) === 0n || busy === "claim"} onClick={buildClaim}>
            {busy === "claim" ? "Working…" : "Claim fees"}
          </button>
        </div>

        {msg && (
          <p className={`status ${msg.bad ? "err" : "ok"}`} role="status">
            {msg.text}{" "}
            {msg.sig && (
              <a href={EXPLORER.tx(msg.sig)} target="_blank" rel="noopener noreferrer" style={{ color: "var(--accent-text)" }}>
                View transaction ↗
              </a>
            )}
          </p>
        )}

        {launches.length > 0 && (
          <div className="callout" style={{ borderColor: "var(--line)" }}>
            <b>Unfinished launches</b>
            <ul style={{ margin: "6px 0 0", paddingLeft: 18 }}>
              {launches.map((l) => (
                <li key={l.id}>
                  ${l.symbol} ({l.name}): {l.status}
                  {l.reason ? `. ${l.reason}` : ""}
                </li>
              ))}
            </ul>
          </div>
        )}

        <div className="shops-grid">
          {coins === null ? (
            <p className="hint">Loading your shops…</p>
          ) : coins.length === 0 ? (
            <div className="empty-lot" style={{ border: "2px solid var(--line)", padding: 24 }}>
              <ShibaFace mood="sleeping" size={100} />
              <div>
                <b>No shops yet</b>
                <p>Launch a coin and it will show up here with its stats and creator tools.</p>
                <a className="btn sm" href="/#launch" style={{ marginTop: 12 }}>
                  Open your first shop
                </a>
              </div>
            </div>
          ) : (
            coins.map((c) => (
              <div key={c.mint}>
                <div className="feebox" style={{ marginBottom: 0, borderBottom: 0 }}>
                  <div style={{ display: "flex", gap: 14, alignItems: "center" }}>
                    <div style={{ width: 90 }}>
                      <PixelShop ticker={c.symbol} awning={awningFor(c.mint)} image={c.imageUri} />
                    </div>
                    <div>
                      <small>Buy back ${c.symbol}</small>
                      <div style={{ display: "flex", gap: 8, alignItems: "center", marginTop: 6 }}>
                        <label className="sr-only" htmlFor={`amt-${c.mint}`}>
                          SOL to spend
                        </label>
                        <input
                          id={`amt-${c.mint}`}
                          type="number"
                          min={LIMITS.buybackMinSol}
                          max={LIMITS.buybackMaxSol}
                          step={0.01}
                          value={amounts[c.mint] ?? "0.05"}
                          onChange={(e) => setAmounts((a) => ({ ...a, [c.mint]: e.target.value }))}
                          style={{ width: 110, font: "inherit", padding: 8, border: "2px solid var(--line)", background: "var(--bg)", color: "var(--text)" }}
                        />
                        <span>SOL</span>
                      </div>
                    </div>
                  </div>
                  <button className="btn" disabled={busy === c.mint} onClick={() => buildBuyback(c)}>
                    {busy === c.mint ? "Working…" : "Buy back"}
                  </button>
                </div>
                <CoinDashboard coin={c} trades={null} />
              </div>
            ))
          )}
        </div>
      </div>

      <dialog ref={dlg} className="modal wide" aria-labelledby="txTitle" onClose={() => pending && setPending(null)}>
        <div className="mh">
          <h3 id="txTitle">Before your wallet opens</h3>
          <button className="close" aria-label="Cancel" onClick={() => dlg.current?.close()}>
            ×
          </button>
        </div>
        {pending && (
          <div className="mb">
            <p style={{ marginTop: 0 }}>Approving sends one transaction on Solana mainnet that will:</p>
            <ul>
              {pending.lines.map((l) => (
                <li key={l}>{l}</li>
              ))}
            </ul>
            <ul className="confirm-list">
              <li>
                <span>Network fee</span>
                <span>{fmtSol(pending.estimate.networkFeeLamports, 6)}</span>
              </li>
              {BigInt(pending.estimate.rentLamports) > 0n && (
                <li>
                  <span>Rent for new accounts</span>
                  <span>{fmtSol(pending.estimate.rentLamports, 5)}</span>
                </li>
              )}
              <li>
                <span>
                  <b>Total cost, {pending.estimate.exact ? "from a dry run" : "approximately"}</b>
                </span>
                <span>{fmtSol(pending.estimate.totalLamports, 5)}</span>
              </li>
            </ul>
            <div className="callout">Transactions on Solana can&apos;t be undone.</div>
            <div style={{ display: "flex", gap: 12 }}>
              <button className="btn" onClick={approve}>
                Approve in wallet
              </button>
              <button className="btn ghost" onClick={() => dlg.current?.close()}>
                Cancel
              </button>
            </div>
          </div>
        )}
      </dialog>
    </section>
  );
}
