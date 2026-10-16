# Bazaar Inu: deploy and first launch

Bazaar Inu is a Next.js 16 app on Vercel with Postgres (Prisma 7). Visitors launch real pump.fun coins on **Solana mainnet** from their own wallets. The site never holds keys or funds: the server builds and dry-runs each transaction, the wallet signs it, and the server relays it only if it matches what was prepared.

## What was verified, and what wasn't

Verified on 15 Oct 2026, without sending any transaction:

| Check | Result |
|---|---|
| Unit tests (`npm test`) | 81 passed: relay checkers, RPC fail-over and error codes, curve maths, simulator, backtester, form validation |
| Production build (`npm run build`) | passes; the pump SDK, Anchor and web3.js are traced into every launch, buyback, fee, cron and health route |
| `node --no-experimental-require-module` on Node 22.23.3 | pump-sdk, pump-swap-sdk, web3.js and rpc-websockets all load as CommonJS |
| Mainnet smoke test (`tests/mainnet.smoke.test.ts`) | Over HTTP from an empty wallet: sign-in → prepare → build returns `insufficient-funds`, "Not enough SOL… needs about 0.0070 SOL". A real `create_v2` built and simulated on mainnet costs **0.00563 SOL** with no dev buy and **0.0185 SOL** with a 0.01 SOL dev buy. A `buy_v2` buyback simulated against a coin launched minutes earlier, and its trade events decoded. |
| Playwright (desktop + mobile) | 12 passed: sections render with no page errors, simulator controls, wallet picker and install help, validation, the full launch flow through **real** sign-in to the wallet prompt (mock wallet declines; nothing relayed), light theme, no horizontal scroll |
| `/api/health` locally | `ok: true` |

**Not verified yet:**

- **A real mainnet launch has not been sent.** Do one with the checklist below.
- **The metadata upload has not succeeded.** pump.fun's `POST https://pump.fun/api/ipfs` answered every server-side upload with **HTTP 500** during testing, with plain and browser-like headers alike. Uploads therefore need `PINATA_JWT`. pump.fun's own create-coin guide also uses Pinata. With a JWT set, Pinata goes first and pump.fun is the fallback.
- **Clicking through with a real wallet extension.** Real extensions can't be driven from here. Do it once locally (see "Run locally").
- **The claim-fees and buyback buttons, end to end.** Their builders and checkers are tested, and a buyback was simulated on mainnet, but neither has been sent.

## 1. Environment variables

Put these in a local `.env` for development, and in **Vercel → Project → Settings → Environment Variables** for production (Production and Preview). **Changing a value needs a redeploy.** Nothing secret uses the `NEXT_PUBLIC_` prefix.

| Name | Required | Purpose | Example | Where to get it |
|---|---|---|---|---|
| `DATABASE_URL` | yes | Postgres for the app (pooled connection) | `postgresql://u:p@ep-x-pooler.us-east-1.aws.neon.tech/neondb?sslmode=require` | Neon → Project → Connection Details → **Pooled connection** |
| `DIRECT_DATABASE_URL` | recommended | Non-pooled connection, used only by `prisma migrate deploy` | same host without `-pooler` | Neon → Connection Details → turn **Connection pooling** off, then copy |

**Sharing a database with other apps is fine.** Bazaar Inu keeps all of its tables, and its own `_prisma_migrations`, in a Postgres schema called `bazaar` (`src/config/db-schema.ts`). Other apps' tables in `public` are never touched. Migrations create the schema on first deploy.

**Connected Neon through Vercel → Storage?** The integration sets `DATABASE_URL` and `DATABASE_URL_UNPOOLED` (plus `POSTGRES_URL*`) for you. The app and migrations pick those up, so you don't need to add the two rows above by hand. If you chose a custom prefix when connecting, rename the variables or reconnect without a prefix.
| `SOLANA_RPC_URL` | yes in practice | Mainnet RPC list, comma-separated, best first. The public RPC is always added last. | `https://mainnet.helius-rpc.com/?api-key=…` | Helius dashboard → Endpoints → **Mainnet** RPC URL |
| `SITE_URL` | yes | Public URL, no trailing slash. Used in sign-in messages and metadata `createdOn`. | `https://bazaarinu.xyz` | your domain |
| `CRON_SECRET` | yes | Protects `/api/cron`. Must be 16+ characters. | 43 random characters | generate (section 3) |
| `PINATA_JWT` | **yes, currently** | Pins the image and metadata to IPFS | `eyJhbGciOi…` | Pinata → API Keys → New Key (section 2) → copy the **JWT** |
| `PINATA_GATEWAY` | optional | Dedicated gateway host for IPFS links; default `ipfs.io` | `yourname.mypinata.cloud` | Pinata → Gateways |
| `COINGECKO_API_KEY` | optional | SOL/USD from CoinGecko (Coinbase and Kraken are keyless fallbacks) | `CG-…` | CoinGecko → Developer Dashboard |
| `COINGECKO_API_PLAN` | optional | `demo` (default) or `pro` | `demo` | the plan you signed up for |
| `BIRDEYE_API_KEY` | optional | Backtester fallback when GeckoTerminal fails. GeckoTerminal itself needs no key. | `…` | birdeye.so → Data Services → API key |
| `NEXT_PUBLIC_X_URL` | optional | Where the header's X button goes (default `https://x.com`, or `x.com/<handle>` if `NEXT_PUBLIC_X_HANDLE` is set) | `https://x.com/bazaarinu` | your X profile |
| `NEXT_PUBLIC_PUMP_URL` | optional | Where the header's pump.fun button goes (default `https://pump.fun`, or your coin's page if `NEXT_PUBLIC_OFFICIAL_MINT` is set) | `https://pump.fun/coin/<mint>` | your coin's pump.fun page |
| `NEXT_PUBLIC_X_HANDLE` | optional | X handle, used for the X button if `NEXT_PUBLIC_X_URL` isn't set | `bazaarinu` | your X account |
| `NEXT_PUBLIC_OFFICIAL_MINT` | optional | Shown in the Token section once a token exists | mint address | after you launch it |
| `NEXT_PUBLIC_TELEGRAM_URL` | optional | Reserved for a community link | `https://t.me/…` | your group |

## 2. Accounts to create

| Service | Sign-up | Plan | What to copy |
|---|---|---|---|
| Vercel | https://vercel.com/signup | Hobby works. Its cron runs once a day; the site also runs background jobs on page loads and status polls. Pro allows a 5-minute cron. | nothing; import the Git repo |
| Neon (Postgres) | https://neon.tech | Free | Pooled → `DATABASE_URL`, direct → `DIRECT_DATABASE_URL`. Create it in **AWS us-east-1** to sit next to Vercel's default `iad1` functions. |
| Helius (RPC) | https://dashboard.helius.dev | Free to start; upgrade if `/api/health` shows rate limits | Mainnet RPC URL → `SOLANA_RPC_URL` |
| Pinata (IPFS) | https://app.pinata.cloud | Free | API Keys → New Key → enable **Files: Write** (or Admin) → copy the **JWT** (shown once) → `PINATA_JWT` |
| CoinGecko (optional) | https://www.coingecko.com/en/api | Demo (free) | API key → `COINGECKO_API_KEY` |
| Birdeye (optional) | https://bds.birdeye.so | Free tier | API key → `BIRDEYE_API_KEY` |

## 3. Generated secrets

```bash
# CRON_SECRET
openssl rand -base64 32
# or, without openssl:
node -e "console.log(require('crypto').randomBytes(32).toString('base64url'))"
```

Never commit `.env`, keys or keypair files. `.gitignore` already excludes `.env*` (except `.env.example`) and `*keypair*.json`. If a secret leaks, rotate it at the provider and update Vercel.

## 4. Host settings

| Setting | Value |
|---|---|
| Node | 22.x (`"engines"` in package.json; Vercel picks it up) |
| Install | `npm install` (runs `prisma generate` on postinstall) |
| Build | `npm run vercel-build` = `prisma generate && prisma migrate deploy && next build` (set in `vercel.json`) |
| Function region | `iad1` (Washington, D.C.), next to Neon us-east-1 |
| Cron | `vercel.json`: `0 12 * * *` → `/api/cron`. Vercel sends `Authorization: Bearer $CRON_SECRET` automatically. For more frequent runs on Hobby, point a free pinger (e.g. cron-job.org) at `https://YOUR_SITE/api/cron?secret=CRON_SECRET` every 5 minutes. |
| Database | Neon Postgres 17, AWS us-east-1 |

Background work (finalising launches, market stats, trades, holders, SOL price, cleanup) runs under one DB lock from `/api/cron`, from `after()` on page loads (at most every 45 s), and whenever the launching browser polls `/api/launch/status`. A launch therefore finalises even if cron never runs.

## 5. First real launch checklist

1. Deploy, then open `https://YOUR_SITE/api/health`. Expect `"ok": true` and an empty `hints` list. Fix each hint first; they're written in plain English.
2. Use a wallet holding about **0.03–0.05 SOL**. Measured: a create with no dev buy costs about **0.0056 SOL** (rent plus fees), so this leaves plenty of room. **Leave dev buy off.**
3. On the site: Connect wallet → fill in the name, ticker, image and description → **Review launch**. There is no separate sign-in.
4. The confirmation dialog shows the network fee, rent and total from a real dry run. Check them, then press **Approve in wallet** and approve.
5. Wait for "GRAND OPENING". Then confirm the coin:
   - appears on **pump.fun** (the dialog links to `pump.fun/coin/<mint>`)
   - appears on **Solscan** (the transaction link)
   - shows on the site's **Market** street with a dashboard (stats fill in within a minute or two)
6. Open **My shops**: the coin is listed. Try **Buy back** with 0.001 SOL to exercise the buyback path. **Claim fees** stays disabled until there are creator fees.
7. If anything fails, note the short error code shown in brackets and use the table below.

## 6. Troubleshooting

| Code | What the user sees | Cause | What to check |
|---|---|---|---|
| `rpc-rate-limited` | provider is rate-limiting | All RPC endpoints returned 429 | Helius plan/credits; add a second provider to `SOLANA_RPC_URL` |
| `rpc-forbidden` | provider refused | 401/403, usually a bad key or the public RPC blocking Vercel | Helius key in `SOLANA_RPC_URL`; `/api/health` → `checks.rpc` |
| `rpc-timeout` | network too slow | Endpoints didn't answer within 12 s | Provider status; add a fallback endpoint |
| `rpc-unavailable` | couldn't reach Solana | Network errors or 5xx on every endpoint | Same as above |
| `insufficient-funds` | "Not enough SOL…" with balance and amount needed | The wallet can't cover rent + fees (+ dev buy) | Fund the wallet; nothing was charged |
| `blockhash-expired` | expired, nothing charged, approve again | The approval took more than ~60 s, or the network dropped the transaction | Approve again (the site rebuilds automatically) |
| `simulation-failed` | failed a dry run, not sent | The pump program rejected it in simulation | The `detail` holds the program log. Often an SDK/program mismatch: update `@pump-fun/pump-sdk` |
| `tx-failed` | network rejected it / slippage | A send-time rejection, or the price moved past 1% slippage on a buy | Retry; for slippage, try a smaller amount |
| `relay-rejected` | doesn't match what was prepared | The signed transaction differs from what was built (extra instruction, other mint, other fee payer, a wallet that rewrote it) | The `detail` names the rule. Wallets that add Lighthouse guards or change the priority fee are allowed; anything else isn't. |
| `validation` | field errors | Form input out of bounds, banned word, bad image | The form shows each field |
| `rate-limited` | too many requests | Per-IP limits in `src/lib/ratelimit.ts` | Wait, or raise the limits |
| `upload-failed` | upload failed | Pinata and pump.fun both failed | `PINATA_JWT` valid? `/api/health` → `checks.metadataUpload` |
| `launch-not-found` / `launch-expired` | start again | The draft is older than 24 h, or belongs to another wallet | Start a new launch; nothing was charged |
| `already-submitted` | already sent | Double click or a second tab | Check My shops / Solscan |
| `mint-taken` | start again | The mint address already exists (practically never) | Start again; a new keypair is generated |
| `not-creator` / `coin-not-found` | only the creator… | Buyback/claim on a coin that isn't yours or wasn't launched here | Expected |
| `nothing-to-claim` | no fees | No creator fees accrued yet | Expected |
| `pump-sdk-error` | building failed | The SDK threw, usually after a pump program upgrade | Update `@pump-fun/pump-sdk`, re-check the IDLs (`src/lib/pump/decode.ts`), run the tests and the smoke test |
| `price-unavailable` | no USD | CoinGecko, Coinbase and Kraken all failed | Usually transient; USD shows "—" meanwhile |
| `history-unavailable` | backtester can't load | GeckoTerminal (and Birdeye, if set) failed | Try another market; set `BIRDEYE_API_KEY` |
| `db-unavailable` | database unavailable | `DATABASE_URL` wrong, Neon suspended or migrations missing | `/api/health` → `checks.database`; redeploy to run migrations |
| `internal` | something went wrong | An unexpected exception | Vercel → Logs (keys are redacted; hostnames only) |
| `network` (browser only) | couldn't reach the site | The visitor's connection | n/a |

Run the mainnet smoke test against any running instance at any time; it sends nothing:

```bash
SMOKE_MAINNET=1 SMOKE_BASE_URL=https://YOUR_SITE npx vitest run tests/mainnet.smoke.test.ts
```

## 7. Places to customise later

| What | Where |
|---|---|
| Official token mint, X handle, Telegram | `NEXT_PUBLIC_OFFICIAL_MINT`, `NEXT_PUBLIC_X_HANDLE`, `NEXT_PUBLIC_TELEGRAM_URL` (redeploy) |
| Name, tagline, max lengths, dev-buy cap, buyback bounds | `src/config/site.ts` (`SITE`, `LIMITS`) |
| Rate limits | `src/lib/ratelimit.ts` (`RATE_LIMITS`) |
| Banned words | `src/config/banned-words.ts` |
| Fees | The site charges **no platform fee**, and none is coded. Adding one means a new instruction in the builders **and** an explicit allowance in the relay checkers (`src/lib/pump/checkers.ts`), plus disclosure in the confirmation dialog. |
| Priority fee range | `src/lib/pump/tx.ts` (`MIN_PRICE`, `MAX_PRICE`); checker cap `MAX_PRIORITY_FEE_LAMPORTS` |
| Backtester markets | `src/lib/backtest/history.ts` (`MARKETS`) |
| Colours and theme | tokens at the top of `src/app/globals.css` |

## Run locally

```bash
npm install
npx prisma dev --name bazaar --detach   # local Postgres (or: docker compose up -d)
cp .env.example .env                     # set DATABASE_URL to the TCP URL prisma dev prints
npx prisma migrate deploy
npm run build && npx next start -p 3100
npm test                                 # unit tests
npx playwright test                      # e2e (expects the server on :3100)
npm run check:require                    # CommonJS load test
```

Then click through with a real wallet extension in Chrome: Connect, fill in the form, **Review launch**. With an empty wallet you should get "Not enough SOL". With a funded wallet you'll see the confirmation dialog with dry-run costs; press Cancel there unless you mean to launch.

## How the launch flow is protected

1. **Prepare** (server): validate the form (name ≤ 32, ticker A–Z0–9 ≤ 10, description ≤ 500, banned words, URLs), sniff and re-encode the image with sharp, upload to IPFS, store a draft. Rate-limited per wallet and per IP.
2. **Mint keypair** (browser): `Keypair.generate()`. Only the public key goes to the server.
3. **Build** (server): `create_v2` from `@pump-fun/pump-sdk` 4.1.0, or `createV2AndBuyInstructions` with a dev buy. The legacy 16-account `buy` keeps create + buy within one legacy transaction; `buy_v2` measured 1462 bytes against the 1232 limit. Compute budget is sized from a simulation, with a fresh blockhash and the user as fee payer. Insufficient funds are caught here.
4. **Sign** (browser): wallet `signTransaction` first, then `partialSign(mint)`.
5. **Relay** (server): `checkLaunchTransaction` accepts only ComputeBudget (capped), exactly one `create_v2` with this mint, name, ticker, URI and the wallet as creator, and (only with a dev buy) the wallet's Token-2022 account plus one `buy` capped at the dev-buy amount. The fee payer must be the launch's wallet and every signature must verify. Then `sendRawTransaction`.
6. **Finalize** (idempotent): signature status → bonding-curve PDA exists with the wallet as creator → the coin row is created in a DB transaction that first claims the launch.

Buybacks and fee claims follow the same build → confirm → sign → checked relay pattern, with their own checkers (`checkBuybackTransaction`, `checkClaimTransaction`).

## Why there's no sign-in

Connecting a wallet is all a visitor does before launching. The browser sends its wallet address with each request, and the server doesn't trust that on its own: every action that moves SOL (launch, buyback, fee claim) is a transaction the wallet itself must sign, and the relay only forwards it if the fee payer is that wallet and every signature verifies. Someone who types in another person's address can build an unsigned transaction for them, but can never send one. Rate limits are per IP for the same reason.
