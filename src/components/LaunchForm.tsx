"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Keypair, Transaction } from "@solana/web3.js";
import { useWallet } from "@solana/wallet-adapter-react";
import { PixelShop } from "@/components/PixelShop";
import { ShibaFace, type ShibaMood } from "@/components/mascot/ShibaFace";
import { useUi } from "@/components/wallet/WalletProviders";
import { useToast } from "@/components/Toast";
import { EXPLORER, LIMITS } from "@/config/site";
import { ApiError, api, b64ToBytes, bytesToB64, fmtSol, short } from "@/lib/client/api";
import { validateLaunch, type FieldErrors } from "@/lib/validation";

type Field = "name" | "symbol" | "description" | "image" | "twitter" | "telegram" | "website" | "devBuySol";

const HELP: Record<Field | "idle", string> = {
  idle: "Fill in your shop sign and I'll show a preview. Nothing is sent until you approve in your own wallet.",
  name: "Your coin's full name, up to 32 characters. It's permanent once launched, so check the spelling.",
  symbol: "The ticker people trade under, like $TREAT. Letters and numbers only, up to 10.",
  description: "A short pitch shown on pump.fun. Keep it honest: no promises of profit.",
  image: "Square images look best. PNG, JPG, WebP or GIF up to 4 MB. I'll convert it to PNG for you.",
  twitter: "Optional. Your X profile, as a link or @handle. Shown on your coin's page.",
  telegram: "Optional. A t.me link to your group.",
  website: "Optional. A full web address for your project.",
  devBuySol: "Optional. Buy some of your own coin in the same transaction, before anyone else can. It spends real SOL and is off by default.",
};

interface Estimate {
  totalLamports: string;
  networkFeeLamports: string;
  rentLamports: string;
  spendLamports: string;
  exact: boolean;
  balanceLamports: string;
}

type Step = "signin" | "upload" | "build" | "approve" | "send" | "confirm";
const STEPS: { id: Step; label: string }[] = [
  { id: "signin", label: "Sign in with your wallet (free)" },
  { id: "upload", label: "Upload image and metadata" },
  { id: "build", label: "Build and dry-run the transaction" },
  { id: "approve", label: "You approve in your wallet" },
  { id: "send", label: "Send to Solana" },
  { id: "confirm", label: "Confirm and open the shop" },
];

interface Draft {
  key: string;
  launchId: string;
  metadataUri: string;
  mint: Keypair;
}

export function LaunchForm() {
  const { publicKey, signTransaction } = useWallet();
  const { openConnect, signedIn, signIn } = useUi();
  const toast = useToast();

  const [v, setV] = useState({ name: "", symbol: "", description: "", twitter: "", telegram: "", website: "", devBuySol: "0.1" });
  const [devBuyOn, setDevBuyOn] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [errors, setErrors] = useState<FieldErrors>({});
  const [focus, setFocus] = useState<Field | "idle">("idle");
  const [busy, setBusy] = useState(false);
  const [step, setStep] = useState<Step | null>(null);
  const [failedStep, setFailedStep] = useState<Step | null>(null);
  const [status, setStatus] = useState<{ text: string; kind: "ok" | "err" | "" }>({ text: "", kind: "" });
  const [confirm, setConfirm] = useState<{ tx: string; estimate: Estimate; mint: string } | null>(null);
  const [done, setDone] = useState<{ mint: string; signature: string; symbol: string } | null>(null);
  const [over, setOver] = useState(false);
  const draft = useRef<Draft | null>(null);
  const confirmRef = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    if (!file) return setPreview(null);
    const u = URL.createObjectURL(file);
    setPreview(u);
    return () => URL.revokeObjectURL(u);
  }, [file]);

  useEffect(() => {
    const d = confirmRef.current;
    if (!d) return;
    if (confirm && !d.open) d.showModal();
    if (!confirm && d.open) d.close();
  }, [confirm]);

  const ticker = (v.symbol.replace(/[^a-z0-9]/gi, "").toUpperCase() || "COIN").slice(0, LIMITS.symbolMax);
  const fields = useMemo(() => ({ ...v, devBuySol: devBuyOn ? v.devBuySol : "0" }), [v, devBuyOn]);
  const formKey = useMemo(() => JSON.stringify(fields) + (file ? `${file.name}:${file.size}:${file.lastModified}` : ""), [fields, file]);
  const mood: ShibaMood = done ? "celebrate" : status.kind === "err" ? "worried" : focus === "idle" ? "happy" : "chart";

  const set = (k: keyof typeof v) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    setV((x) => ({ ...x, [k]: e.target.value }));
    if (errors[k as Field]) setErrors((x) => ({ ...x, [k]: undefined }));
  };

  const pickFile = (f: File | null | undefined) => {
    if (!f) return;
    if (f.size > LIMITS.imageMaxBytes) return setErrors((x) => ({ ...x, image: "Images must be under 4 MB." }));
    if (!/^image\/(png|jpe?g|webp|gif)$/.test(f.type)) return setErrors((x) => ({ ...x, image: "Use a PNG, JPG, WebP or GIF image." }));
    setErrors((x) => ({ ...x, image: undefined }));
    setFile(f);
  };

  const fail = (s: Step, e: unknown) => {
    setFailedStep(s);
    setStep(null);
    const msg = e instanceof ApiError ? `${e.message}${e.code && e.code !== "validation" ? ` (${e.code})` : ""}` : e instanceof Error ? e.message : String(e);
    setStatus({ text: msg, kind: "err" });
    if (e instanceof ApiError && e.fields) setErrors((x) => ({ ...x, ...(e.fields as FieldErrors) }));
  };

  /** prepare (once per form state) → build. Ends at the confirmation dialog. */
  const review = useCallback(async () => {
    setStatus({ text: "", kind: "" });
    setFailedStep(null);
    const local = validateLaunch(fields);
    const errs: FieldErrors = local.ok ? {} : { ...local.errors };
    if (!file) errs.image = "Add an image for your coin.";
    if (Object.keys(errs).length) {
      setErrors(errs);
      setStatus({ text: "Some fields need fixing first.", kind: "err" });
      return;
    }
    if (!publicKey) return openConnect();
    setBusy(true);
    try {
      if (!signedIn) {
        setStep("signin");
        if (!(await signIn())) {
          setStep(null);
          setStatus({ text: "Sign in to continue. It's a free signature, not a transaction.", kind: "err" });
          return;
        }
      }
      const wallet = publicKey.toBase58();
      if (!draft.current || draft.current.key !== formKey) {
        setStep("upload");
        const fd = new FormData();
        for (const [k, val] of Object.entries(fields)) fd.append(k, val);
        fd.append("image", file!);
        fd.append("wallet", wallet);
        let r: { launchId: string; metadataUri: string };
        try {
          r = await api("/api/launch/prepare", { method: "POST", body: fd });
        } catch (e) {
          return fail("upload", e);
        }
        // The new coin's mint keypair is made here, in the browser. Its secret never leaves this page.
        draft.current = { key: formKey, launchId: r.launchId, metadataUri: r.metadataUri, mint: Keypair.generate() };
      }
      setStep("build");
      try {
        const b = await api<{ tx: string; estimate: Estimate; mint: string }>("/api/launch/build", {
          method: "POST",
          json: { launchId: draft.current.launchId, mint: draft.current.mint.publicKey.toBase58(), wallet },
        });
        setStep("approve");
        setConfirm(b);
      } catch (e) {
        if (e instanceof ApiError && (e.code === "mint-taken" || e.code === "launch-expired")) draft.current = null;
        return fail("build", e);
      }
    } finally {
      setBusy(false);
    }
  }, [fields, file, formKey, openConnect, publicKey, signIn, signedIn]);

  const approve = useCallback(async () => {
    if (!confirm || !draft.current || !publicKey) return;
    if (!signTransaction) return fail("approve", new Error("This wallet can't sign transactions here. Try Phantom, Solflare, Backpack or OKX."));
    const d = draft.current;
    setConfirm(null);
    setBusy(true);
    try {
      let signed: Transaction;
      try {
        const tx = Transaction.from(b64ToBytes(confirm.tx));
        // Wallet first, then the mint: some wallets drop or refuse signatures added before theirs.
        signed = await signTransaction(tx);
        signed.partialSign(d.mint);
      } catch (e) {
        const m = String((e as Error)?.message ?? e);
        return fail("approve", new Error(/reject|denied|cancel|declin/i.test(m) ? "You declined in your wallet. Nothing was sent." : `Your wallet couldn't sign: ${m}`));
      }
      setStep("send");
      let sig: string;
      try {
        const r = await api<{ signature: string }>("/api/launch/relay", {
          method: "POST",
          json: { launchId: d.launchId, tx: bytesToB64(signed.serialize()), wallet: publicKey.toBase58() },
        });
        sig = r.signature;
      } catch (e) {
        return fail("send", e);
      }
      setStep("confirm");
      setStatus({ text: "Sent. Waiting for Solana to confirm…", kind: "" });
      for (let i = 0; i < 90; i++) {
        await new Promise((r) => setTimeout(r, 2000));
        let s: { status: string; reason: string | null; errorCode: string | null; mint: string | null };
        try {
          s = await api(`/api/launch/status?id=${d.launchId}`);
        } catch {
          continue;
        }
        if (s.status === "confirmed") {
          setDone({ mint: s.mint!, signature: sig, symbol: ticker });
          setStep(null);
          setStatus({ text: "Your shop is open!", kind: "ok" });
          draft.current = null;
          toast(`$${ticker} is live on pump.fun`);
          return;
        }
        if (s.status === "failed") return fail("confirm", new Error(s.reason ?? "The transaction failed."));
        if (s.status === "built" && s.errorCode === "blockhash-expired") return fail("confirm", new Error(s.reason ?? "It expired before landing. Nothing was charged. Approve again."));
      }
      fail("confirm", new Error("Still not confirmed. It may land shortly; check My shops or Solscan before trying again."));
    } finally {
      setBusy(false);
    }
  }, [confirm, publicKey, signTransaction, ticker, toast]);

  const est = confirm?.estimate;
  const devBuy = devBuyOn ? Number(v.devBuySol) || 0 : 0;
  const stepIndex = step ? STEPS.findIndex((s) => s.id === step) : -1;
  const failIndex = failedStep ? STEPS.findIndex((s) => s.id === failedStep) : -1;

  const input = (k: Exclude<Field, "image" | "devBuySol" | "description">, label: string, extra: Record<string, unknown> = {}, hint?: string) => (
    <label className="f">
      {label}
      <input
        type="text"
        value={v[k]}
        onChange={set(k)}
        onFocus={() => setFocus(k)}
        onBlur={() => setFocus("idle")}
        aria-invalid={!!errors[k]}
        aria-describedby={errors[k] ? `${k}-err` : undefined}
        autoComplete="off"
        {...extra}
      />
      {hint && !errors[k] && <span className="hint">{hint}</span>}
      {errors[k] && (
        <span className="err" id={`${k}-err`}>
          {errors[k]}
        </span>
      )}
    </label>
  );

  return (
    <section className="block" id="launch" aria-labelledby="launch-h">
      <div className="wrap">
        <h2 id="launch-h">Open your shop</h2>
        <p className="sub">Name your coin, add an image and links. It launches for real on pump.fun&apos;s bonding curve on Solana mainnet, with you as the creator. You sign one transaction in your own wallet.</p>
        <div className="launch">
          <form
            className="cfg"
            noValidate
            onSubmit={(e) => {
              e.preventDefault();
              if (!busy) review();
            }}
            aria-label="Launch a coin"
          >
            <div className="helper">
              <ShibaFace mood={mood} size={56} title="Shopkeeper helper" />
              <div className="bubble" aria-live="polite">
                {HELP[focus]}
              </div>
            </div>
            <div className="row2">
              {input("name", "Coin name", { maxLength: LIMITS.nameMax, placeholder: "Your coin's name", name: "name" })}
              {input("symbol", "Ticker", { maxLength: LIMITS.symbolMax + 1, placeholder: "TREAT", name: "symbol" }, "Up to 10 letters or digits. Shown on your shop sign.")}
            </div>
            <label className="f">
              Description
              <textarea
                value={v.description}
                onChange={set("description")}
                onFocus={() => setFocus("description")}
                onBlur={() => setFocus("idle")}
                maxLength={LIMITS.descriptionMax + 20}
                placeholder="What's your coin about?"
                aria-invalid={!!errors.description}
                name="description"
              />
              <span className={errors.description ? "err" : "hint"}>{errors.description ?? `${[...v.description].length}/${LIMITS.descriptionMax}`}</span>
            </label>
            <div className="f" onFocus={() => setFocus("image")} onBlur={() => setFocus("idle")}>
              <span style={{ fontWeight: 600, fontSize: 15 }}>Image</span>
              <label
                className={`drop ${over ? "over" : ""}`}
                onDragOver={(e) => {
                  e.preventDefault();
                  setOver(true);
                }}
                onDragLeave={() => setOver(false)}
                onDrop={(e) => {
                  e.preventDefault();
                  setOver(false);
                  pickFile(e.dataTransfer.files?.[0]);
                }}
              >
                {preview ? <img src={preview} alt="Coin image preview" /> : <span className="ph">IMG</span>}
                <span>
                  <b style={{ display: "block" }}>{file ? file.name : "Choose an image"}</b>
                  <span className="hint">PNG, JPG, WebP or GIF, up to 4 MB. Drop it here or click.</span>
                </span>
                <input type="file" accept="image/png,image/jpeg,image/webp,image/gif" className="sr-only" onChange={(e) => pickFile(e.target.files?.[0])} aria-invalid={!!errors.image} name="image" data-testid="image-input" />
              </label>
              {errors.image && <span className="err">{errors.image}</span>}
            </div>
            <div className="row3">
              {input("twitter", "X / Twitter", { placeholder: "@handle", name: "twitter" }, "Optional")}
              {input("telegram", "Telegram", { placeholder: "t.me/…", name: "telegram" }, "Optional")}
              {input("website", "Website", { placeholder: "https://…", name: "website" }, "Optional")}
            </div>
            <fieldset onFocus={() => setFocus("devBuySol")} onBlur={() => setFocus("idle")}>
              <legend>Dev buy</legend>
              <label className="toggle">
                <input type="checkbox" checked={devBuyOn} onChange={(e) => setDevBuyOn(e.target.checked)} name="devBuyOn" />
                Also buy some of my coin in the launch transaction
              </label>
              {devBuyOn && (
                <label className="f">
                  Amount (SOL)
                  <input type="number" min={0.001} max={LIMITS.devBuyMaxSol} step={0.01} value={v.devBuySol} onChange={set("devBuySol")} aria-invalid={!!errors.devBuySol} name="devBuySol" />
                  <span className={errors.devBuySol ? "err" : "hint"}>{errors.devBuySol ?? `Up to ${LIMITS.devBuyMaxSol} SOL. Real SOL, spent at launch.`}</span>
                </label>
              )}
            </fieldset>
            <button className="btn" type="submit" disabled={busy} style={{ justifySelf: "start" }} data-testid="review-launch">
              {busy ? "Working…" : !publicKey ? "Connect wallet to launch" : signedIn ? "Review launch" : "Sign in and review"}
            </button>
          </form>

          <aside className="receipt" aria-label="Shop preview">
            {done ? (
              <div style={{ textAlign: "center" }} data-testid="launch-success">
                <div style={{ display: "flex", justifyContent: "center" }}>
                  <ShibaFace mood="celebrate" size={120} title="The Shiba celebrating your grand opening" />
                </div>
                <div className="pixel" style={{ display: "inline-block", margin: "10px 0 14px", padding: "6px 14px", border: "2px solid var(--accent)", color: "var(--accent-text)", fontSize: 22 }}>
                  GRAND OPENING
                </div>
                <p style={{ margin: "0 0 14px" }}>${done.symbol} is live on pump.fun&apos;s bonding curve.</p>
                <div className="chips" style={{ justifyContent: "center" }}>
                  <a className="chip" href={EXPLORER.pump(done.mint)} target="_blank" rel="noopener noreferrer">
                    pump.fun ↗
                  </a>
                  <a className="chip" href={EXPLORER.tx(done.signature)} target="_blank" rel="noopener noreferrer">
                    Transaction ↗
                  </a>
                  <a className="chip" href="#market">
                    See it on the street
                  </a>
                  <a className="chip" href="/shops">
                    My shops
                  </a>
                </div>
                <button className="btn ghost sm" style={{ marginTop: 18 }} onClick={() => setDone(null)}>
                  Launch another
                </button>
              </div>
            ) : (
              <>
                <div className="prev">
                  <PixelShop ticker={ticker} image={preview} label={`Preview of the ${ticker} shopfront`} />
                </div>
                <dl>
                  <dt>Coin</dt>
                  <dd>{v.name.trim() || "Your coin"}</dd>
                  <dt>Ticker</dt>
                  <dd>${ticker}</dd>
                  <dt>Network</dt>
                  <dd>Solana mainnet</dd>
                  <dt>Launches on</dt>
                  <dd>pump.fun curve</dd>
                  <dt>Dev buy</dt>
                  <dd>{devBuy > 0 ? `${devBuy} SOL` : "None"}</dd>
                  <dt>Links</dt>
                  <dd>{[v.twitter, v.telegram, v.website].filter((x) => x.trim()).length || "None"}</dd>
                  <dt>Est. cost</dt>
                  <dd>about {(0.006 + devBuy * 1.01).toFixed(3)} SOL</dd>
                </dl>
                <button className="btn block" type="button" onClick={() => !busy && review()} disabled={busy}>
                  {busy ? "Working…" : !publicKey ? "Connect wallet to launch" : "Review launch"}
                </button>
                <div className={`status ${status.kind}`} role="status" aria-live="polite" data-testid="launch-status">
                  {status.text}
                </div>
                {(step || failedStep) && (
                  <ol className="steps-live" aria-label="Launch progress">
                    {STEPS.map((s, i) => {
                      const cls = failIndex === i ? "bad" : stepIndex === i ? "now" : (stepIndex > i || (failIndex > i)) ? "done" : "";
                      return (
                        <li key={s.id} className={cls}>
                          <b>{cls === "done" ? "✓" : cls === "bad" ? "×" : cls === "now" ? "›" : i + 1}</b>
                          {s.label}
                        </li>
                      );
                    })}
                  </ol>
                )}
                <p className="note">The server prepares and dry-runs the transaction. Your wallet signs it; the site never sees your keys. Nothing is sent until you approve.</p>
              </>
            )}
          </aside>
        </div>
      </div>

      <dialog
        ref={confirmRef}
        className="modal wide"
        aria-labelledby="confirmTitle"
        onClose={() => {
          if (confirm) {
            setConfirm(null);
            setStep(null);
            setStatus({ text: "Cancelled. Nothing was sent.", kind: "" });
          }
        }}
      >
        <div className="mh">
          <h3 id="confirmTitle">Before your wallet opens</h3>
          <button className="close" aria-label="Cancel" onClick={() => confirmRef.current?.close()}>
            ×
          </button>
        </div>
        {confirm && est && (
          <div className="mb" data-testid="confirm-dialog">
            <p style={{ marginTop: 0 }}>Approving will do exactly this, in one transaction on <b>Solana mainnet</b>:</p>
            <ul>
              <li>
                Create the coin <b>{v.name.trim()}</b> (${ticker}) on pump.fun&apos;s bonding curve, with you as its creator.
              </li>
              <li>
                Its mint address will be <code style={{ fontSize: 13 }}>{short(confirm.mint)}</code>.
              </li>
              {Number(est.spendLamports) > 0 && <li>Buy about {fmtSol(est.spendLamports, 4)} of it for you (dev buy, including pump.fun&apos;s trading fee and up to 1% slippage).</li>}
            </ul>
            <ul className="confirm-list">
              <li>
                <span>Network fee</span>
                <span>{fmtSol(est.networkFeeLamports, 6)}</span>
              </li>
              <li>
                <span>Rent for new accounts</span>
                <span>{fmtSol(est.rentLamports, 4)}</span>
              </li>
              {Number(est.spendLamports) > 0 && (
                <li>
                  <span>Dev buy (max)</span>
                  <span>{fmtSol(est.spendLamports, 4)}</span>
                </li>
              )}
              <li>
                <span>
                  <b>Total, {est.exact ? "from a dry run" : "approximately"}</b>
                </span>
                <span>{fmtSol(est.totalLamports, 4)}</span>
              </li>
              <li>
                <span>Your balance</span>
                <span>{fmtSol(est.balanceLamports, 4)}</span>
              </li>
            </ul>
            <div className="callout">This can&apos;t be undone. A pump.fun coin can&apos;t be deleted or renamed after it&apos;s created, and the SOL spent isn&apos;t refundable.</div>
            <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
              <button className="btn" onClick={approve} data-testid="approve">
                Approve in wallet
              </button>
              <button className="btn ghost" onClick={() => confirmRef.current?.close()}>
                Cancel
              </button>
            </div>
          </div>
        )}
      </dialog>
    </section>
  );
}
