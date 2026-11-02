import { createContext, useCallback, useContext, useMemo, useState } from 'react';
import { CheckCircle2, AlertTriangle, Info, X } from 'lucide-react';

const ToastCtx = createContext(null);
export const useToast = () => useContext(ToastCtx);

const ICON = { success: CheckCircle2, error: AlertTriangle, info: Info };
const TONE = { success: 'border-ok/40 text-ok', error: 'border-danger/40 text-danger', info: 'border-brand/40 text-brand' };

export function ToastProvider({ children }) {
  const [items, setItems] = useState([]);
  const dismiss = useCallback((id) => setItems((xs) => xs.filter((x) => x.id !== id)), []);
  const push = useCallback((type, message, ms = 4500) => {
    const id = Math.random().toString(36).slice(2);
    setItems((xs) => [...xs.slice(-3), { id, type, message }]);
    if (ms) setTimeout(() => dismiss(id), ms);
  }, [dismiss]);
  const api = useMemo(() => ({
    success: (m) => push('success', m), error: (m) => push('error', m, 7000), info: (m) => push('info', m),
  }), [push]);
  return (
    <ToastCtx.Provider value={api}>
      {children}
      <div className="pointer-events-none fixed inset-x-0 bottom-4 z-[100] flex flex-col items-center gap-2 px-4" aria-live="polite" role="status">
        {items.map((t) => {
          const Icon = ICON[t.type];
          return (
            <div key={t.id} className={`pointer-events-auto flex max-w-md items-start gap-2.5 rounded-xl border bg-surface px-3.5 py-2.5 text-sm shadow-lift animate-pop ${TONE[t.type]}`}>
              <Icon className="mt-0.5 h-4 w-4 shrink-0" />
              <span className="text-ink">{t.message}</span>
              <button className="-mr-1 text-mute hover:text-ink" aria-label="Dismiss" onClick={() => dismiss(t.id)}><X className="h-4 w-4" /></button>
            </div>
          );
        })}
      </div>
    </ToastCtx.Provider>
  );
}
