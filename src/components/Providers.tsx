"use client";
import { ToastProvider } from "@/components/Toast";
import { WalletProviders } from "@/components/wallet/WalletProviders";

export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <ToastProvider>
      <WalletProviders>{children}</WalletProviders>
    </ToastProvider>
  );
}
