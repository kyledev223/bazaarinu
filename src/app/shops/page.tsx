import type { Metadata } from "next";
import { Header } from "@/components/Header";
import { ShopsDashboard } from "@/components/ShopsDashboard";
import { RiskAndFooter } from "@/components/Sections";

export const metadata: Metadata = { title: "My shops · Bazaar Inu" };

export default function ShopsPage() {
  return (
    <>
      <Header home={false} />
      <main id="main">
        <ShopsDashboard />
      </main>
      <RiskAndFooter />
    </>
  );
}
