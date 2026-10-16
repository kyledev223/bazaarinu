-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "LaunchStatus" AS ENUM ('prepared', 'built', 'submitted', 'confirmed', 'failed', 'expired');

-- CreateTable
CREATE TABLE "Session" (
    "id" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "wallet" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Session_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuthNonce" (
    "nonce" TEXT NOT NULL,
    "wallet" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "usedAt" TIMESTAMP(3),

    CONSTRAINT "AuthNonce_pkey" PRIMARY KEY ("nonce")
);

-- CreateTable
CREATE TABLE "Launch" (
    "id" TEXT NOT NULL,
    "wallet" TEXT NOT NULL,
    "status" "LaunchStatus" NOT NULL DEFAULT 'prepared',
    "name" TEXT NOT NULL,
    "symbol" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "twitter" TEXT,
    "telegram" TEXT,
    "website" TEXT,
    "imageUri" TEXT NOT NULL,
    "metadataUri" TEXT NOT NULL,
    "metadataHost" TEXT NOT NULL,
    "devBuyLamports" BIGINT NOT NULL DEFAULT 0,
    "mint" TEXT,
    "signature" TEXT,
    "lastValidBlockHeight" BIGINT,
    "reason" TEXT,
    "errorCode" TEXT,
    "ipHash" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "submittedAt" TIMESTAMP(3),
    "confirmedAt" TIMESTAMP(3),

    CONSTRAINT "Launch_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Coin" (
    "mint" TEXT NOT NULL,
    "launchId" TEXT NOT NULL,
    "creator" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "symbol" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "imageUri" TEXT NOT NULL,
    "metadataUri" TEXT NOT NULL,
    "twitter" TEXT,
    "telegram" TEXT,
    "website" TEXT,
    "signature" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "virtualSolReserves" BIGINT,
    "virtualTokenReserves" BIGINT,
    "realTokenReserves" BIGINT,
    "tokenTotalSupply" BIGINT,
    "marketCapLamports" BIGINT,
    "progressBps" INTEGER,
    "complete" BOOLEAN NOT NULL DEFAULT false,
    "graduated" BOOLEAN NOT NULL DEFAULT false,
    "poolAddress" TEXT,
    "poolBaseReserve" BIGINT,
    "poolQuoteReserve" BIGINT,
    "holders" INTEGER,
    "statsUpdatedAt" TIMESTAMP(3),
    "holdersUpdatedAt" TIMESTAMP(3),
    "tradesCursor" TEXT,
    "tradesUpdatedAt" TIMESTAMP(3),

    CONSTRAINT "Coin_pkey" PRIMARY KEY ("mint")
);

-- CreateTable
CREATE TABLE "Trade" (
    "signature" TEXT NOT NULL,
    "mint" TEXT NOT NULL,
    "isBuy" BOOLEAN NOT NULL,
    "solLamports" BIGINT NOT NULL,
    "tokenAmount" BIGINT NOT NULL,
    "trader" TEXT NOT NULL,
    "venue" TEXT NOT NULL,
    "blockTime" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Trade_pkey" PRIMARY KEY ("signature","mint")
);

-- CreateTable
CREATE TABLE "TxIntent" (
    "id" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "wallet" TEXT NOT NULL,
    "mint" TEXT,
    "maxLamports" BIGINT,
    "meta" JSONB,
    "status" TEXT NOT NULL DEFAULT 'built',
    "signature" TEXT,
    "reason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TxIntent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "JobState" (
    "name" TEXT NOT NULL,
    "lockedUntil" TIMESTAMP(3),
    "lastRunAt" TIMESTAMP(3),
    "lastOkAt" TIMESTAMP(3),
    "lastError" TEXT,
    "lastDurationMs" INTEGER,

    CONSTRAINT "JobState_pkey" PRIMARY KEY ("name")
);

-- CreateTable
CREATE TABLE "RateLimit" (
    "key" TEXT NOT NULL,
    "windowStart" TIMESTAMP(3) NOT NULL,
    "count" INTEGER NOT NULL,

    CONSTRAINT "RateLimit_pkey" PRIMARY KEY ("key")
);

-- CreateTable
CREATE TABLE "KV" (
    "key" TEXT NOT NULL,
    "value" JSONB NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "KV_pkey" PRIMARY KEY ("key")
);

-- CreateIndex
CREATE UNIQUE INDEX "Session_tokenHash_key" ON "Session"("tokenHash");

-- CreateIndex
CREATE INDEX "Session_wallet_idx" ON "Session"("wallet");

-- CreateIndex
CREATE INDEX "AuthNonce_expiresAt_idx" ON "AuthNonce"("expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "Launch_mint_key" ON "Launch"("mint");

-- CreateIndex
CREATE UNIQUE INDEX "Launch_signature_key" ON "Launch"("signature");

-- CreateIndex
CREATE INDEX "Launch_wallet_createdAt_idx" ON "Launch"("wallet", "createdAt");

-- CreateIndex
CREATE INDEX "Launch_status_updatedAt_idx" ON "Launch"("status", "updatedAt");

-- CreateIndex
CREATE UNIQUE INDEX "Coin_launchId_key" ON "Coin"("launchId");

-- CreateIndex
CREATE INDEX "Coin_creator_idx" ON "Coin"("creator");

-- CreateIndex
CREATE INDEX "Coin_createdAt_idx" ON "Coin"("createdAt");

-- CreateIndex
CREATE INDEX "Trade_mint_blockTime_idx" ON "Trade"("mint", "blockTime");

-- CreateIndex
CREATE INDEX "Trade_blockTime_idx" ON "Trade"("blockTime");

-- CreateIndex
CREATE UNIQUE INDEX "TxIntent_signature_key" ON "TxIntent"("signature");

-- CreateIndex
CREATE INDEX "TxIntent_wallet_createdAt_idx" ON "TxIntent"("wallet", "createdAt");

-- AddForeignKey
ALTER TABLE "Coin" ADD CONSTRAINT "Coin_launchId_fkey" FOREIGN KEY ("launchId") REFERENCES "Launch"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Trade" ADD CONSTRAINT "Trade_mint_fkey" FOREIGN KEY ("mint") REFERENCES "Coin"("mint") ON DELETE RESTRICT ON UPDATE CASCADE;

