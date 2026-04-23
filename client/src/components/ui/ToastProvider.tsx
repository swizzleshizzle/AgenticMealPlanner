import { createContext, useCallback, useContext, useRef, useState } from "react";
import type { ReactNode } from "react";
import Toast, { type ToastData } from "./Toast";

type ShowToast = (t: Omit<ToastData, "id">) => void;

const ToastContext = createContext<ShowToast>(() => {
  // Default no-op so consumers outside the provider don't crash, just silently fail.
});

export function useToast(): ShowToast {
  return useContext(ToastContext);
}

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toast, setToast] = useState<ToastData | null>(null);
  const idRef = useRef(0);

  const show = useCallback<ShowToast>((t) => {
    idRef.current += 1;
    setToast({ ...t, id: idRef.current });
  }, []);

  const dismiss = useCallback(() => setToast(null), []);

  return (
    <ToastContext.Provider value={show}>
      {children}
      <Toast toast={toast} onDismiss={dismiss} />
    </ToastContext.Provider>
  );
}
