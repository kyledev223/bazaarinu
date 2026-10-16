"use client";
import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { useWallet } from "@solana/wallet-adapter-react";
import { ShibaFace } from "@/components/mascot/ShibaFace";
import { useUi } from "@/components/wallet/WalletProviders";
import { useToast } from "@/components/Toast";
import { EXPLORER, SITE } from "@/config/site";
import { api, short } from "@/lib/client/api";

export function useTheme() {
  const [theme, setTheme] = useState<"dark" | "light">("dark");
  useEffect(() => {
    setTheme(document.documentElement.dataset.theme === "light" ? "light" : "dark");
  }, []);
  const toggle = useCallback(() => {
    const next = theme === "dark" ? "light" : "dark";
    document.documentElement.dataset.theme = next;
    try {
      localStorage.setItem("bi.theme", next);
    } catch {
      /* private mode */
    }
    setTheme(next);
  }, [theme]);
  return { theme, toggle };
}

export function Header({ home = true }: { home?: boolean }) {
  const { publicKey, connecting } = useWallet();
  const { openConnect, signedIn, signIn, signOut } = useUi();
  const toast = useToast();
  const { theme, toggle } = useTheme();
  const [menu, setMenu] = useState(false);
  const [wmenu, setWmenu] = useState(false);
  const [balance, setBalance] = useState<string>("—");
  const walletRef = useRef<HTMLDivElement>(null);
  const address = publicKey?.toBase58() ?? null;
  const base = home ? "" : "/";

  const refreshBalance = useCallback(async () => {
    if (!address) return;
    try {
      const r = await api<{ lamports: number }>(`/api/wallet/balance?address=${address}`);
      setBalance(`${(r.lamports / 1e9).toLocaleString("en-US", { maximumFractionDigits: 4 })} SOL`);
    } catch {
      setBalance("Unavailable");
    }
  }, [address]);

  useEffect(() => {
    const close = (e: MouseEvent) => {
      if (!walletRef.current?.contains(e.target as Node)) setWmenu(false);
    };
    const esc = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setWmenu(false);
        setMenu(false);
      }
    };
    document.addEventListener("click", close);
    document.addEventListener("keydown", esc);
    return () => {
      document.removeEventListener("click", close);
      document.removeEventListener("keydown", esc);
    };
  }, []);

  useEffect(() => {
    if (!address) setWmenu(false);
  }, [address]);

  const links = [
    { href: `${base}#market`, label: "Market" },
    { href: `${base}#launch`, label: "Launch" },
    { href: `${base}#how`, label: "How it works" },
    { href: `${base}#token`, label: "Token" },
  ];

  return (
    <header className="site-header">
      <a className="skip" href="#main">
        Skip to content
      </a>
      <div className="wrap bar">
        <Link className="brand" href="/" aria-label={`${SITE.name} home`}>
          <ShibaFace mood="neutral" size={40} className="mark" title={`${SITE.name} logo`} />
          <b>BAZAAR INU</b>
        </Link>
        <nav className={`links ${menu ? "open" : ""}`} id="navLinks" aria-label="Main">
          {links.map((l) => (
            <a key={l.href} href={l.href} onClick={() => setMenu(false)}>
              {l.label}
            </a>
          ))}
          {signedIn && (
            <Link href="/shops" onClick={() => setMenu(false)}>
              My shops
            </Link>
          )}
          <button className="iconbtn menu-theme" onClick={toggle} style={{ display: menu ? "block" : "none", textAlign: "left" }}>
            {theme === "dark" ? "Light theme" : "Dark theme"}
          </button>
        </nav>
        <div className="right">
          <span className="netpill" title="This site only uses Solana mainnet. Every transaction uses real SOL.">
            <span className="dot" aria-hidden="true" />
            <span>
              <span className="long">Solana </span>mainnet
            </span>
          </span>
          <button className="iconbtn theme-btn" onClick={toggle} aria-label={`Switch to ${theme === "dark" ? "light" : "dark"} theme`}>
            {theme === "dark" ? "☀" : "☾"}
          </button>
          {SITE.xHandle && (
            <a className="xbtn" href={`https://x.com/${SITE.xHandle}`} target="_blank" rel="noopener noreferrer" aria-label={`Follow @${SITE.xHandle} on X`}>
              X<span className="xh"> @{SITE.xHandle}</span>
            </a>
          )}
          <div className="wallet" ref={walletRef}>
            <button
              className="btn"
              aria-haspopup={address ? "menu" : "dialog"}
              aria-expanded={address ? wmenu : undefined}
              data-testid="wallet-button"
              onClick={(e) => {
                e.stopPropagation();
                if (!address) return openConnect();
                setWmenu((v) => !v);
                refreshBalance();
              }}
            >
              {connecting ? "Connecting…" : address ? short(address) : "Connect wallet"}
            </button>
            {address && wmenu && (
              <div className="wmenu" role="menu">
                <div className="bal">
                  Balance<strong>{balance}</strong>
                  <span>{short(address)}</span>
                  <span style={{ display: "block", marginTop: 4 }}>{signedIn ? "Signed in" : "Not signed in"}</span>
                </div>
                {!signedIn && (
                  <button role="menuitem" onClick={() => signIn()}>
                    Sign in (free signature)
                  </button>
                )}
                {signedIn && (
                  <Link role="menuitem" href="/shops">
                    My shops
                  </Link>
                )}
                <button
                  role="menuitem"
                  onClick={async () => {
                    try {
                      await navigator.clipboard.writeText(address);
                      toast("Address copied");
                    } catch {
                      toast(address);
                    }
                  }}
                >
                  Copy address
                </button>
                <a role="menuitem" href={EXPLORER.account(address)} target="_blank" rel="noopener noreferrer">
                  View on Solscan
                </a>
                <button
                  role="menuitem"
                  onClick={async () => {
                    await signOut();
                    toast("Wallet disconnected");
                  }}
                >
                  Disconnect
                </button>
              </div>
            )}
          </div>
          <button className="iconbtn menu-toggle" aria-expanded={menu} aria-controls="navLinks" onClick={() => setMenu((v) => !v)}>
            Menu
          </button>
        </div>
      </div>
    </header>
  );
}
