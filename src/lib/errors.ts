// User-facing error codes. Every API error carries one of these plus a plain
// sentence; docs/LAUNCH.md has a troubleshooting row for each.
export const ERROR_MESSAGES = {
  "rpc-rate-limited": "The Solana network provider is rate-limiting us right now. Wait a few seconds and try again.",
  "rpc-forbidden": "The Solana network provider refused the request. The site's RPC settings need attention.",
  "rpc-timeout": "The Solana network took too long to answer. Try again in a moment.",
  "rpc-unavailable": "We couldn't reach the Solana network. Try again in a moment.",
  "insufficient-funds": "Not enough SOL in this wallet to cover the transaction.",
  "blockhash-expired": "The approval window expired before the transaction landed. Nothing was charged. Approve again.",
  "simulation-failed": "The transaction failed a dry run, so it wasn't sent. Nothing was charged.",
  "tx-failed": "The network rejected the transaction.",
  "relay-rejected": "This transaction doesn't match what was prepared, so it wasn't sent.",
  "validation": "Some fields need fixing.",
  "rate-limited": "Too many requests. Wait a minute and try again.",
  "not-signed-in": "Sign in with your wallet first. It's a free signature, not a transaction.",
  "wallet-mismatch": "The connected wallet isn't the one that's signed in. Sign in again with this wallet.",
  "upload-failed": "Uploading the image and metadata failed. Try again in a moment.",
  "launch-not-found": "That launch wasn't found.",
  "launch-expired": "This launch draft expired. Start again; nothing was charged.",
  "already-submitted": "This launch was already sent. Check its status instead.",
  "mint-taken": "That mint address is already in use. Start the launch again.",
  "not-creator": "Only the coin's creator can do this.",
  "nothing-to-claim": "There are no creator fees waiting to be claimed.",
  "coin-not-found": "That coin wasn't launched through this site.",
  "pump-sdk-error": "Building the pump.fun transaction failed. The pump program may have changed; the site needs an update.",
  "price-unavailable": "SOL price data is temporarily unavailable.",
  "history-unavailable": "Historical price data is temporarily unavailable. Try another market or come back later.",
  "db-unavailable": "The site's database is unavailable. Try again in a moment.",
  "bad-request": "The request was malformed.",
  "internal": "Something went wrong on our side.",
} as const;

export type ErrorCode = keyof typeof ERROR_MESSAGES;

export class AppError extends Error {
  readonly code: ErrorCode;
  readonly status: number;
  readonly detail?: string;
  readonly fields?: Record<string, string>;

  constructor(code: ErrorCode, opts: { status?: number; detail?: string; message?: string; fields?: Record<string, string>; cause?: unknown } = {}) {
    super(opts.message ?? ERROR_MESSAGES[code], { cause: opts.cause });
    this.code = code;
    this.status = opts.status ?? defaultStatus(code);
    this.detail = opts.detail;
    this.fields = opts.fields;
  }
}

function defaultStatus(code: ErrorCode): number {
  switch (code) {
    case "validation":
    case "bad-request":
    case "insufficient-funds":
    case "simulation-failed":
    case "relay-rejected":
    case "blockhash-expired":
    case "tx-failed":
    case "mint-taken":
    case "nothing-to-claim":
    case "launch-expired":
    case "already-submitted":
      return 400;
    case "not-signed-in":
    case "wallet-mismatch":
      return 401;
    case "not-creator":
      return 403;
    case "launch-not-found":
    case "coin-not-found":
      return 404;
    case "rate-limited":
    case "rpc-rate-limited":
      return 429;
    case "rpc-forbidden":
    case "rpc-timeout":
    case "rpc-unavailable":
    case "upload-failed":
    case "price-unavailable":
    case "history-unavailable":
    case "db-unavailable":
      return 503;
    default:
      return 500;
  }
}

export interface ApiErrorBody {
  ok: false;
  error: { code: ErrorCode; message: string; detail?: string; fields?: Record<string, string> };
}

export function errorBody(e: AppError): ApiErrorBody {
  return { ok: false, error: { code: e.code, message: e.message, detail: e.detail, fields: e.fields } };
}
