import { useEffect, useRef } from 'react';
import { AlertTriangle, Wifi, WifiOff, Loader2, X } from 'lucide-react';
import { initials } from '../utils/board';

const AVATAR_TONES = ['bg-[#d7ebec] text-[#0f5c63]', 'bg-[#f6e6bf] text-[#7a5200]', 'bg-[#e4dff3] text-[#4b3a8c]', 'bg-[#f6d9d6] text-[#a1332d]', 'bg-[#dcebd8] text-[#2b6a2f]'];
const toneFor = (id = '') => AVATAR_TONES[[...id].reduce((a, c) => a + c.charCodeAt(0), 0) % AVATAR_TONES.length];

export function Avatar({ user, size = 'md', ring = false, title }) {
  const sz = size === 'sm' ? 'h-6 w-6 text-[10px]' : size === 'lg' ? 'h-10 w-10 text-sm' : 'h-8 w-8 text-xs';
  return (
    <span title={title ?? user?.name} className={`inline-flex ${sz} shrink-0 items-center justify-center rounded-full font-bold ${toneFor(user?.id)} ${ring ? 'ring-2 ring-surface' : ''}`}>
      {initials(user?.name)}
    </span>
  );
}

export function Modal({ title, onClose, children, side = false, wide = false, labelledBy = 'modal-title' }) {
  const ref = useRef(null);
  useEffect(() => {
    const prev = document.activeElement;
    ref.current?.focus();
    const onKey = (e) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('keydown', onKey); prev?.focus?.(); };
  }, [onClose]);
  return (
    <div className="fixed inset-0 z-50 flex" role="dialog" aria-modal="true" aria-labelledby={labelledBy}>
      <div className="absolute inset-0 bg-ink/40 backdrop-blur-[1px]" onClick={onClose} />
      <div ref={ref} tabIndex={-1}
        className={`relative flex max-h-full flex-col bg-surface shadow-lift focus:outline-none ${side ? 'ml-auto h-full w-full max-w-xl animate-slidein' : `m-auto w-full ${wide ? 'max-w-2xl' : 'max-w-md'} rounded-2xl animate-pop`}`}>
        <div className="flex items-center justify-between border-b border-line px-5 py-3.5">
          <h2 id={labelledBy} className="text-lg font-bold">{title}</h2>
          <button className="btn-icon -mr-2" aria-label="Close" onClick={onClose}><X className="h-5 w-5" /></button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto">{children}</div>
      </div>
    </div>
  );
}

export function ConfirmDialog({ title, message, confirmLabel = 'Delete', onConfirm, onCancel, busy }) {
  return (
    <Modal title={title} onClose={onCancel} labelledBy="confirm-title">
      <div className="space-y-5 p-5">
        <div className="flex gap-3">
          <span className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-danger-soft text-danger"><AlertTriangle className="h-5 w-5" /></span>
          <p className="text-sm leading-relaxed text-ink">{message}</p>
        </div>
        <div className="flex justify-end gap-2">
          <button className="btn-outline" onClick={onCancel}>Cancel</button>
          <button className="btn-danger" onClick={onConfirm} disabled={busy}>{busy && <Loader2 className="h-4 w-4 animate-spin" />}{confirmLabel}</button>
        </div>
      </div>
    </Modal>
  );
}

export function EmptyState({ icon: Icon, title, children, action }) {
  return (
    <div className="mx-auto flex max-w-sm flex-col items-center px-4 py-12 text-center">
      {Icon && <span className="mb-3 flex h-12 w-12 items-center justify-center rounded-2xl bg-brand-soft text-brand"><Icon className="h-6 w-6" /></span>}
      <h3 className="text-base font-bold">{title}</h3>
      {children && <p className="mt-1 text-sm text-mute">{children}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

export function ErrorState({ message, onRetry }) {
  return (
    <div role="alert" className="mx-auto flex max-w-md flex-col items-center rounded-2xl border border-danger/30 bg-danger-soft px-6 py-8 text-center">
      <AlertTriangle className="mb-2 h-6 w-6 text-danger" />
      <p className="text-sm font-semibold text-danger">{message || 'Something went wrong.'}</p>
      {onRetry && <button className="btn-outline mt-4" onClick={onRetry}>Try again</button>}
    </div>
  );
}

export function BoardSkeleton() {
  return (
    <div className="flex gap-4 overflow-hidden p-4" aria-busy="true" aria-label="Loading board">
      {[3, 2, 2, 1].map((n, i) => (
        <div key={i} className="w-72 shrink-0 space-y-3 rounded-2xl bg-sunken/60 p-3">
          <div className="skeleton h-5 w-28" />
          {Array.from({ length: n }).map((_, j) => <div key={j} className="skeleton h-24 w-full !bg-surface/80" />)}
        </div>
      ))}
    </div>
  );
}

const CONN = {
  connected: { icon: Wifi, text: 'Live', cls: 'text-ok' },
  connecting: { icon: Loader2, text: 'Connecting…', cls: 'text-mute', spin: true },
  reconnecting: { icon: WifiOff, text: 'Reconnecting…', cls: 'text-danger', spin: true },
  denied: { icon: WifiOff, text: 'No access', cls: 'text-danger' },
  idle: { icon: WifiOff, text: 'Offline', cls: 'text-mute' },
};
export function ConnectionBadge({ status }) {
  const c = CONN[status] || CONN.idle;
  const Icon = c.icon;
  return (
    <span role="status" aria-live="polite" className={`inline-flex items-center gap-1.5 rounded-full border border-line bg-surface px-2.5 py-1 text-xs font-semibold ${c.cls}`}>
      {status === 'connected' ? <span className="live-dot h-2 w-2 rounded-full bg-signal" /> : <Icon className={`h-3.5 w-3.5 ${c.spin ? 'animate-spin' : ''}`} />}
      {c.text}
    </span>
  );
}

export function PresenceBar({ online, meId }) {
  const shown = online.slice(0, 5);
  const extra = online.length - shown.length;
  return (
    <div className="flex items-center gap-2" aria-label={`${online.length} online`}>
      <div className="flex -space-x-1.5">{shown.map((u) => <Avatar key={u.id} user={u} ring title={u.id === meId ? `${u.name} (you)` : u.name} />)}
        {extra > 0 && <span className="inline-flex h-8 w-8 items-center justify-center rounded-full bg-sunken text-xs font-bold ring-2 ring-surface">+{extra}</span>}
      </div>
      <span className="hidden text-xs font-semibold text-mute sm:inline">{online.length} online</span>
    </div>
  );
}
