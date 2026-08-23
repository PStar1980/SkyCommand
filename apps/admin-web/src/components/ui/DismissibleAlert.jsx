import { useEffect, useState } from 'react';

function DismissibleAlert({
  children,
  className = '',
  dismissLabel = 'Dismiss message',
  onDismiss = null,
  role = 'alert',
  tone = 'info',
}) {
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    setDismissed(false);
  }, [children, tone]);

  if (!children || dismissed) {
    return null;
  }

  const resolvedClassName = className || `alert alert-${tone}`;

  function dismiss() {
    setDismissed(true);
    onDismiss?.();
  }

  return (
    <div className={`${resolvedClassName} sky-dismissible-alert`} role={role}>
      <div className="sky-dismissible-alert-content">{children}</div>
      <button
        aria-label={dismissLabel}
        className="sky-alert-dismiss"
        onClick={dismiss}
        title={dismissLabel}
        type="button"
      >
        ×
      </button>
    </div>
  );
}

export default DismissibleAlert;
