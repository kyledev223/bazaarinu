import type { Metadata, Viewport } from "next";
import { Chakra_Petch, Pixelify_Sans } from "next/font/google";
import { Providers } from "@/components/Providers";
import { SITE } from "@/config/site";
import "./globals.css";

const pixel = Pixelify_Sans({ subsets: ["latin"], weight: ["400", "600", "700"], variable: "--font-pixel", display: "swap" });
const body = Chakra_Petch({ subsets: ["latin"], weight: ["400", "500", "600"], variable: "--font-body", display: "swap" });

export const metadata: Metadata = {
  metadataBase: new URL(process.env.SITE_URL || "http://localhost:3000"),
  title: `${SITE.name}: ${SITE.tagline}`,
  description: "Launch real pump.fun coins on Solana mainnet from your own wallet. Every coin gets a shopfront and a live dashboard.",
  icons: { icon: "/icon.svg" },
  openGraph: { title: SITE.name, description: "Launch a coin. Open the shop. Real pump.fun launches on Solana mainnet." },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: "#030a14",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${pixel.variable} ${body.variable}`}>
      <body>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
