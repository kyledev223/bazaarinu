"use client";
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { WalletProvider, useWallet } from "@solana/wallet-adapter-react";
import { WalletNotReadyError, WalletReadyState, type WalletError, type WalletName } from "@solana/wallet-adapter-base";
import { PhantomWalletAdapter } from "@solana/wallet-adapter-phantom";
import { SolflareWalletAdapter } from "@solana/wallet-adapter-solflare";
import { OkxWalletAdapter } from "@/components/wallet/OkxAdapter";
import { WALLET_LINKS } from "@/config/site";
import { useToast } from "@/components/Toast";

// Wallets offered in the picker. Backpack (and others) register through the
// Wallet Standard and show up automatically when installed.
export const OFFERED = ["Phantom", "Solflare", "Backpack", "OKX Wallet"] as const;

// No separate sign-in: connecting is enough. Every action that moves SOL is a
// transaction the wallet signs, and the server relays it only if that signature
// is from the wallet the action was built for.
interface UiCtx {
  openConnect: () => void;
  disconnectWallet: () => Promise<void>;
}

const Ctx = createContext<UiCtx>({
  openConnect: () => {},
  disconnectWallet: async () => {},
});

export const useUi = () => useContext(Ctx);

export function WalletProviders({ children }: { children: React.ReactNode }) {
  const wallets = useMemo(() => [new PhantomWalletAdapter(), new SolflareWalletAdapter(), new OkxWalletAdapter()], []);
  const [help, setHelp] = useState<string | null>(null);
  const onError = useCallback((e: WalletError) => {
    if (e instanceof WalletNotReadyError) setHelp("your wallet");
  }, []);
  return (
    <WalletProvider wallets={wallets} autoConnect onError={onError}>
      <UiProvider help={help} setHelp={setHelp}>
        {children}
      </UiProvider>
    </WalletProvider>
  );
}

function UiProvider({ children, help, setHelp }: { children: React.ReactNode; help: string | null; setHelp: (s: string | null) => void }) {
  const toast = useToast();
  const { disconnect, wallets, select, wallet, connect, connected, connecting } = useWallet();
  const [pickerOpen, setPickerOpen] = useState(false);
  const pending = useRef<string | null>(null);

  // After select(), connect once the adapter is the selected one.
  useEffect(() => {
    if (!pending.current || !wallet || wallet.adapter.name !== pending.current || connected || connecting) return;
    pending.current = null;
    connect().catch((e: unknown) => {
      if (e instanceof WalletNotReadyError) setHelp(wallet.adapter.name);
      else toast((e as Error)?.message?.includes("reject") ? "Connection request was rejected in your wallet." : "Couldn't connect. Unlock your wallet and try again.", true);
    });
  }, [wallet, connect, connected, connecting, setHelp, toast]);

  const choose = useCallback(
    (name: string) => {
      const w = wallets.find((x) => x.adapter.name === name);
      if (!w || (w.readyState !== WalletReadyState.Installed && w.readyState !== WalletReadyState.Loadable)) {
        setPickerOpen(false);
        setHelp(name);
        return;
      }
      setPickerOpen(false);
      pending.current = name;
      select(name as WalletName);
    },
    [wallets, select, setHelp],
  );

  const disconnectWallet = useCallback(async () => {
    await disconnect().catch(() => {});
  }, [disconnect]);

  const value = useMemo<UiCtx>(() => ({ openConnect: () => setPickerOpen(true), disconnectWallet }), [disconnectWallet]);

  return (
    <Ctx.Provider value={value}>
      {children}
      <WalletPicker open={pickerOpen} onClose={() => setPickerOpen(false)} onChoose={choose} />
      <InstallHelp name={help} onClose={() => setHelp(null)} />
    </Ctx.Provider>
  );
}

function useDialog(open: boolean, onClose: () => void) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    if (!open && d.open) d.close();
  }, [open]);
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    const h = () => onClose();
    d.addEventListener("close", h);
    return () => d.removeEventListener("close", h);
  }, [onClose]);
  return ref;
}

function WalletPicker({ open, onClose, onChoose }: { open: boolean; onClose: () => void; onChoose: (n: string) => void }) {
  const ref = useDialog(open, onClose);
  const { wallets } = useWallet();
  // Wallet detection only exists in the browser; render the list after mount so hydration matches the server.
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  const offered = OFFERED.map((name) => ({ name, w: wallets.find((x) => x.adapter.name === name) }));
  const extra = wallets.filter((w) => !OFFERED.includes(w.adapter.name as (typeof OFFERED)[number]) && w.readyState === WalletReadyState.Installed);
  return (
    <dialog ref={ref} className="modal" aria-labelledby="wTitle">
      <div className="mh">
        <h3 id="wTitle">Connect a wallet</h3>
        <button className="close" onClick={onClose} aria-label="Close">
          ×
        </button>
      </div>
      <div className="wlist">
        {mounted && offered.map(({ name, w }) => {
          const has = w?.readyState === WalletReadyState.Installed || w?.readyState === WalletReadyState.Loadable;
          return (
            <button key={name} className="wopt" onClick={() => onChoose(name)} data-testid={`wallet-${name}`}>
              <span>{name}</span>
              <small className={has ? "det" : ""}>{has ? "Detected" : "Install"}</small>
            </button>
          );
        })}
        {mounted && extra.map((w) => (
          <button key={w.adapter.name} className="wopt" onClick={() => onChoose(w.adapter.name)}>
            <span>{w.adapter.name}</span>
            <small className="det">Detected</small>
          </button>
        ))}
      </div>
      <div className="mf">Connecting shares your public address only. Bazaar Inu never asks for your seed phrase or private key.</div>
    </dialog>
  );
}

function InstallHelp({ name, onClose }: { name: string | null; onClose: () => void }) {
  const ref = useDialog(!!name, onClose);
  const link = name && name in WALLET_LINKS ? WALLET_LINKS[name as keyof typeof WALLET_LINKS] : null;
  return (
    <dialog ref={ref} className="modal" aria-labelledby="hTitle">
      <div className="mh">
        <h3 id="hTitle">{name && name !== "your wallet" ? `Install ${name}` : "No wallet found"}</h3>
        <button className="close" onClick={onClose} aria-label="Close">
          ×
        </button>
      </div>
      <div className="mb">
        <p style={{ marginTop: 0 }}>We couldn&apos;t find {name && name !== "your wallet" ? name : "a Solana wallet"} in this browser.</p>
        <ol>
          <li>
            Install the browser extension{link ? (
              <>
                {" "}from{" "}
                <a href={link} target="_blank" rel="noopener noreferrer" style={{ color: "var(--accent-text)" }}>
                  {new URL(link).hostname}
                </a>
              </>
            ) : null}
            . Extensions work in Chrome, Brave, Edge, Arc and other Chromium browsers, and in Firefox.
          </li>
          <li>Create a wallet or import yours inside the extension. Never type a seed phrase into a website, including this one.</li>
          <li>Reload this page and press Connect wallet again.</li>
        </ol>
        <p className="hint" style={{ margin: 0 }}>
          On a phone, open this site from the browser inside your wallet app.
        </p>
      </div>
    </dialog>
  );
}
