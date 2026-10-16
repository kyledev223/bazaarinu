// Minimal, explicit decoders for the handful of instructions the relay accepts.
// Decoding by hand (rather than trusting a generic coder) keeps the relay
// checks easy to audit: each field read here is a field a checker compares.
import { PublicKey } from "@solana/web3.js";
import { pumpSdk, pumpSwapSdk } from "@/lib/pump/load";

export class Reader {
  private o = 0;
  constructor(private readonly b: Uint8Array) {}
  get remaining() {
    return this.b.length - this.o;
  }
  u8() {
    if (this.remaining < 1) throw new Error("eof");
    return this.b[this.o++];
  }
  bool() {
    const v = this.u8();
    if (v > 1) throw new Error("bad bool");
    return v === 1;
  }
  u32() {
    if (this.remaining < 4) throw new Error("eof");
    const v = new DataView(this.b.buffer, this.b.byteOffset + this.o, 4).getUint32(0, true);
    this.o += 4;
    return v;
  }
  u64() {
    if (this.remaining < 8) throw new Error("eof");
    const v = new DataView(this.b.buffer, this.b.byteOffset + this.o, 8).getBigUint64(0, true);
    this.o += 8;
    return v;
  }
  bytes(n: number) {
    if (this.remaining < n) throw new Error("eof");
    const v = this.b.slice(this.o, this.o + n);
    this.o += n;
    return v;
  }
  string(max = 1024) {
    const len = this.u32();
    if (len > max) throw new Error("string too long");
    return new TextDecoder("utf-8", { fatal: true }).decode(this.bytes(len));
  }
  pubkey() {
    return new PublicKey(this.bytes(32));
  }
}

type Idl = { address: string; instructions: { name: string; discriminator: number[] }[] };

export interface PumpPrograms {
  pump: PublicKey;
  amm: PublicKey;
  disc: {
    createV2: Uint8Array;
    buyV2: Uint8Array;
    buy: Uint8Array;
    collectCreatorFee: Uint8Array;
    sweepCreatorFee: Uint8Array;
    ammBuy: Uint8Array;
    ammExtendAccount: Uint8Array;
    ammCollectCoinCreatorFee: Uint8Array;
  };
}

let cached: PumpPrograms | null = null;

function disc(idl: Idl, name: string): Uint8Array {
  const ix = idl.instructions.find((i) => i.name === name);
  if (!ix) throw new Error(`Instruction ${name} not in the installed IDL`);
  return Uint8Array.from(ix.discriminator);
}

/** Program ids and discriminators, read from the IDLs bundled in the installed SDKs. */
export function programs(): PumpPrograms {
  if (cached) return cached;
  const pumpIdl = pumpSdk().pumpIdl as unknown as Idl;
  const ammIdl = pumpSwapSdk().pumpAmmJson as unknown as Idl;
  cached = {
    pump: new PublicKey(pumpIdl.address),
    amm: new PublicKey(ammIdl.address),
    disc: {
      createV2: disc(pumpIdl, "create_v2"),
      buyV2: disc(pumpIdl, "buy_v2"),
      buy: disc(pumpIdl, "buy"),
      collectCreatorFee: disc(pumpIdl, "collect_creator_fee"),
      sweepCreatorFee: disc(pumpIdl, "sweep_creator_fee"),
      ammBuy: disc(ammIdl, "buy"),
      ammExtendAccount: disc(ammIdl, "extend_account"),
      ammCollectCoinCreatorFee: disc(ammIdl, "collect_coin_creator_fee"),
    },
  };
  return cached;
}

export function startsWith(data: Uint8Array, prefix: Uint8Array): boolean {
  if (data.length < prefix.length) return false;
  for (let i = 0; i < prefix.length; i++) if (data[i] !== prefix[i]) return false;
  return true;
}

export interface CreateV2Args {
  name: string;
  symbol: string;
  uri: string;
  creator: PublicKey;
  mayhem: boolean;
  cashback: boolean;
  creatorFeeBps: bigint;
  holderReward: boolean;
}

/** create_v2(name, symbol, uri, creator, is_mayhem_mode, OptionBool, OptionU64, OptionBool). Trailing options may be absent. */
export function decodeCreateV2(data: Uint8Array): CreateV2Args {
  const r = new Reader(data.slice(8));
  const out: CreateV2Args = {
    name: r.string(200),
    symbol: r.string(50),
    uri: r.string(400),
    creator: r.pubkey(),
    mayhem: r.bool(),
    cashback: false,
    creatorFeeBps: 0n,
    holderReward: false,
  };
  if (r.remaining) out.cashback = r.bool();
  if (r.remaining) out.creatorFeeBps = r.u64();
  if (r.remaining) out.holderReward = r.bool();
  if (r.remaining) throw new Error("unexpected trailing data");
  return out;
}

/** buy_v2(amount, max_sol_cost, OptionBool partial_fill) on the bonding curve. */
export function decodeBuyV2(data: Uint8Array): { amount: bigint; maxSolCost: bigint } {
  const r = new Reader(data.slice(8));
  return { amount: r.u64(), maxSolCost: r.u64() };
}

/** Legacy pump buy(amount, max_sol_cost, OptionBool track_volume, OptionBool partial_fill), used by create-and-buy. */
export function decodeBuy(data: Uint8Array): { amount: bigint; maxSolCost: bigint } {
  const r = new Reader(data.slice(8));
  return { amount: r.u64(), maxSolCost: r.u64() };
}

/** pump-amm buy(base_amount_out, max_quote_amount_in, OptionBool track_volume). */
export function decodeAmmBuy(data: Uint8Array): { baseOut: bigint; maxQuoteIn: bigint } {
  const r = new Reader(data.slice(8));
  return { baseOut: r.u64(), maxQuoteIn: r.u64() };
}
