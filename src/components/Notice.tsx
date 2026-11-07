import { WarningCircle, CheckCircle, X } from '@phosphor-icons/react';
export function Notice({ children, error = false, onDismiss }: { children: React.ReactNode; error?: boolean; onDismiss?: () => void }) {
  return <div className={'notice ' + (error ? 'error' : '')} role={error ? 'alert' : 'status'}>
    {error ? <WarningCircle size={19} /> : <CheckCircle size={19} />}<div>{children}</div>
    {onDismiss && <button className="icon-button" aria-label="Dismiss message" onClick={onDismiss}><X size={16} /></button>}
  </div>;
}