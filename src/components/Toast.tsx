"use client";
import { createContext, useCallback, useContext, useRef, useState } from "react";

type Toast = { text: string; bad?: boolean } | null;
const Ctx = createContext<(text: string, bad?: boolean) => void>(() => {});

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toast, setToast] = useState<Toast>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const show = useCallback((text: string, bad = false) => {
    setToast({ text, bad });
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setToast(null), bad ? 6000 : 3500);
  }, []);
  return (
    <Ctx.Provider value={show}>
      {children}
      <div className={`toast ${toast?.bad ? "bad" : ""}`} role="status" aria-live="polite" hidden={!toast}>
        {toast?.text}
      </div>
    </Ctx.Provider>
  );
}

export const useToast = () => useContext(Ctx);
