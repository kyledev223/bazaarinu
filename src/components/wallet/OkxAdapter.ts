"use client";
// A small wallet-adapter around OKX Wallet's injected provider (window.okxwallet.solana).
import {
  BaseSignerWalletAdapter,
  WalletConnectionError,
  WalletDisconnectionError,
  WalletNotConnectedError,
  WalletNotReadyError,
  WalletPublicKeyError,
  WalletReadyState,
  WalletSignMessageError,
  WalletSignTransactionError,
  type WalletName,
} from "@solana/wallet-adapter-base";
import { PublicKey, type Transaction, type TransactionVersion, type VersionedTransaction } from "@solana/web3.js";

interface OkxProvider {
  publicKey?: { toBytes(): Uint8Array; toString(): string } | null;
  isConnected?: boolean;
  connect(): Promise<{ publicKey?: { toBytes(): Uint8Array } } | void>;
  disconnect(): Promise<void>;
  signTransaction<T extends Transaction | VersionedTransaction>(tx: T): Promise<T>;
  signAllTransactions<T extends Transaction | VersionedTransaction>(txs: T[]): Promise<T[]>;
  signMessage(message: Uint8Array, display?: string): Promise<{ signature: Uint8Array } | Uint8Array>;
  on?(event: string, cb: (...args: unknown[]) => void): void;
  off?(event: string, cb: (...args: unknown[]) => void): void;
  removeListener?(event: string, cb: (...args: unknown[]) => void): void;
}

declare global {
  interface Window {
    okxwallet?: { solana?: OkxProvider };
  }
}

export const OkxWalletName = "OKX Wallet" as WalletName<"OKX Wallet">;

const ICON =
  "data:image/svg+xml;base64," +
  (typeof btoa === "function"
    ? btoa('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 30 30"><rect width="30" height="30" fill="#000"/><g fill="#fff"><rect x="6" y="6" width="6" height="6"/><rect x="18" y="6" width="6" height="6"/><rect x="12" y="12" width="6" height="6"/><rect x="6" y="18" width="6" height="6"/><rect x="18" y="18" width="6" height="6"/></g></svg>')
    : "");

export class OkxWalletAdapter extends BaseSignerWalletAdapter {
  name = OkxWalletName;
  url = "https://web3.okx.com/download";
  icon = ICON;
  readonly supportedTransactionVersions: ReadonlySet<TransactionVersion> = new Set(["legacy", 0]);

  private _connecting = false;
  private _publicKey: PublicKey | null = null;
  private _provider: OkxProvider | null = null;
  private _readyState: WalletReadyState =
    typeof window === "undefined" ? WalletReadyState.Unsupported : WalletReadyState.NotDetected;

  constructor() {
    super();
    if (this._readyState !== WalletReadyState.Unsupported) {
      const detect = () => {
        if (window.okxwallet?.solana && this._readyState !== WalletReadyState.Installed) {
          this._readyState = WalletReadyState.Installed;
          this.emit("readyStateChange", this._readyState);
          return true;
        }
        return false;
      };
      if (!detect()) {
        let tries = 0;
        const t = setInterval(() => {
          if (detect() || ++tries > 20) clearInterval(t);
        }, 500);
      }
    }
  }

  get publicKey() {
    return this._publicKey;
  }
  get connecting() {
    return this._connecting;
  }
  get readyState() {
    return this._readyState;
  }

  async connect(): Promise<void> {
    try {
      if (this.connected || this.connecting) return;
      if (this._readyState !== WalletReadyState.Installed) throw new WalletNotReadyError();
      this._connecting = true;
      const provider = window.okxwallet!.solana!;
      try {
        await provider.connect();
      } catch (e) {
        throw new WalletConnectionError((e as Error)?.message, e);
      }
      if (!provider.publicKey) throw new WalletConnectionError("No public key");
      let pk: PublicKey;
      try {
        pk = new PublicKey(provider.publicKey.toBytes());
      } catch (e) {
        throw new WalletPublicKeyError((e as Error)?.message, e);
      }
      provider.on?.("disconnect", this._onDisconnect);
      provider.on?.("accountChanged", this._onAccountChanged);
      this._provider = provider;
      this._publicKey = pk;
      this.emit("connect", pk);
    } catch (e) {
      this.emit("error", e as never);
      throw e;
    } finally {
      this._connecting = false;
    }
  }

  async disconnect(): Promise<void> {
    const p = this._provider;
    if (p) {
      (p.off ?? p.removeListener)?.call(p, "disconnect", this._onDisconnect);
      (p.off ?? p.removeListener)?.call(p, "accountChanged", this._onAccountChanged);
      this._provider = null;
      this._publicKey = null;
      try {
        await p.disconnect();
      } catch (e) {
        this.emit("error", new WalletDisconnectionError((e as Error)?.message, e));
      }
    }
    this.emit("disconnect");
  }

  async signTransaction<T extends Transaction | VersionedTransaction>(tx: T): Promise<T> {
    const p = this._provider;
    if (!p) throw new WalletNotConnectedError();
    try {
      return await p.signTransaction(tx);
    } catch (e) {
      throw new WalletSignTransactionError((e as Error)?.message, e);
    }
  }

  async signAllTransactions<T extends Transaction | VersionedTransaction>(txs: T[]): Promise<T[]> {
    const p = this._provider;
    if (!p) throw new WalletNotConnectedError();
    try {
      return await p.signAllTransactions(txs);
    } catch (e) {
      throw new WalletSignTransactionError((e as Error)?.message, e);
    }
  }

  async signMessage(message: Uint8Array): Promise<Uint8Array> {
    const p = this._provider;
    if (!p) throw new WalletNotConnectedError();
    try {
      const r = await p.signMessage(message, "utf8");
      return r instanceof Uint8Array ? r : r.signature;
    } catch (e) {
      throw new WalletSignMessageError((e as Error)?.message, e);
    }
  }

  private _onDisconnect = () => {
    this._provider = null;
    this._publicKey = null;
    this.emit("disconnect");
  };

  private _onAccountChanged = (next: unknown) => {
    const p = this._provider;
    if (!p) return;
    try {
      const pk = next ? new PublicKey((next as { toBytes(): Uint8Array }).toBytes()) : null;
      if (!pk) return void this._onDisconnect();
      if (this._publicKey?.equals(pk)) return;
      this._publicKey = pk;
      this.emit("connect", pk);
    } catch {
      this._onDisconnect();
    }
  };
}
