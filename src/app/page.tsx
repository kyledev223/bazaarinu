import { after } from "next/server";
import { Header } from "@/components/Header";
import { Market } from "@/components/Market";
import { LaunchForm } from "@/components/LaunchForm";
import { Backtester } from "@/components/Backtester";
import { LaunchLog } from "@/components/LaunchLog";
import { Compare, Flywheel, Hero, HowItWorks, RiskAndFooter, WhatYouGet } from "@/components/Sections";
import { launchLog, listCoins, type CoinView, type LogLine } from "@/lib/coins";
import { maybeTick } from "@/lib/tick";

export const dynamic = "force-dynamic";

export default async function Home() {
  let coins: CoinView[] = [];
  let log: LogLine[] = [];
  let dbError = false;
  try {
    [coins, log] = await Promise.all([listCoins().then((r) => r.coins), launchLog(30)]);
  } catch (e) {
    dbError = true;
    console.warn(`[home] market data unavailable: ${e instanceof Error ? e.message.split("\n")[0] : e}`);
  }
  // Busy page loads keep background jobs (finalising launches, market data) moving.
  if (!dbError) after(maybeTick);

  return (
    <>
      <Header />
      <main id="main">
        <Hero />
        <Market initial={coins} dbError={dbError} />
        <LaunchForm />
        <Backtester />
        <HowItWorks />
        <Flywheel />
        <LaunchLog initial={log} />
        <Compare />
        <WhatYouGet />
      </main>
      <RiskAndFooter />
    </>
  );
}
