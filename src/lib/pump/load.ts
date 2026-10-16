// The only place the pump SDKs are loaded.
//
// Their ESM builds fail in Node with an @coral-xyz/anchor "BN" export error, so
// they are loaded as CommonJS through createRequire. next.config.ts keeps them
// out of the bundle (serverExternalPackages) and traces their files into the
// routes that need them. Import types with `import type` only; get values from
// these functions.
import { createRequire } from "node:module";
import type * as PumpSdkModule from "@pump-fun/pump-sdk";
import type * as PumpSwapModule from "@pump-fun/pump-swap-sdk";
import type * as AnchorModule from "@coral-xyz/anchor";

const nodeRequire = createRequire(import.meta.url);

let pumpMod: typeof PumpSdkModule | undefined;
let swapMod: typeof PumpSwapModule | undefined;
let anchorMod: typeof AnchorModule | undefined;

export function pumpSdk(): typeof PumpSdkModule {
  return (pumpMod ??= nodeRequire("@pump-fun/pump-sdk") as typeof PumpSdkModule);
}

export function pumpSwapSdk(): typeof PumpSwapModule {
  return (swapMod ??= nodeRequire("@pump-fun/pump-swap-sdk") as typeof PumpSwapModule);
}

export function anchor(): typeof AnchorModule {
  return (anchorMod ??= nodeRequire("@coral-xyz/anchor") as typeof AnchorModule);
}

export function pumpSdkVersion(): string {
  try {
    // The package's "exports" map hides package.json, so read it next to the resolved entry.
    const fs = nodeRequire("node:fs") as typeof import("node:fs");
    const path = nodeRequire("node:path") as typeof import("node:path");
    // Inside the Next server bundle require.resolve may point elsewhere; the traced node_modules sits under cwd.
    const direct = path.join(process.cwd(), "node_modules", "@pump-fun", "pump-sdk", "package.json");
    if (fs.existsSync(direct)) return (JSON.parse(fs.readFileSync(direct, "utf8")) as { version: string }).version;
    let dir = path.dirname(nodeRequire.resolve("@pump-fun/pump-sdk"));
    for (let i = 0; i < 5; i++) {
      const p = path.join(dir, "package.json");
      if (fs.existsSync(p)) {
        const pkg = JSON.parse(fs.readFileSync(p, "utf8")) as { name?: string; version: string };
        if (pkg.name === "@pump-fun/pump-sdk") return pkg.version;
      }
      dir = path.dirname(dir);
    }
    return "unknown";
  } catch {
    return "unknown";
  }
}
