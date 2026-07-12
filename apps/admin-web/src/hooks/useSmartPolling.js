import { useEffect, useRef, useState } from 'react';

export const SMART_POLLING_INTERVALS = {
  SELECTED_ACTIVE: 1500,
  ACTIVE: 2000,
  IDLE: 8000,
  DASHBOARD_IDLE: 15000,
  SLOW: 30000,
  HIDDEN: 30000,
};

export function formatPollingInterval(ms) {
  const value = Number(ms);

  if (!Number.isFinite(value) || value <= 0) {
    return '—';
  }

  if (value < 1000) {
    return `${value} ms`;
  }

  const seconds = value / 1000;
  return `${seconds % 1 === 0 ? seconds.toFixed(0) : seconds.toFixed(1)} s`;
}

export function getSmartPollingDelay({
  active = false,
  activeCount = 0,
  hidden = false,
  idleMs = SMART_POLLING_INTERVALS.IDLE,
  activeMs = SMART_POLLING_INTERVALS.ACTIVE,
  hiddenMs = SMART_POLLING_INTERVALS.HIDDEN,
  selectedActive = false,
  selectedActiveMs = SMART_POLLING_INTERVALS.SELECTED_ACTIVE,
} = {}) {
  if (hidden) {
    return hiddenMs;
  }

  if (selectedActive) {
    return selectedActiveMs;
  }

  if (active || Number(activeCount || 0) > 0) {
    return activeMs;
  }

  return idleMs;
}

function getErrorMessage(error, fallback = 'Smart polling refresh failed.') {
  if (!error) {
    return fallback;
  }

  return error.message || error.error || fallback;
}

function useSmartPolling({
  enabled = true,
  errorThreshold = 2,
  getDelay,
  initialIntervalMs = SMART_POLLING_INTERVALS.IDLE,
  onError,
  onPoll,
  pauseWhenBusy = true,
  dependencies = [],
} = {}) {
  const onPollRef = useRef(onPoll);
  const getDelayRef = useRef(getDelay);
  const onErrorRef = useRef(onError);
  const pollingRef = useRef(false);
  const [state, setState] = useState({
    activeCount: 0,
    consecutiveErrors: 0,
    error: '',
    intervalMs: initialIntervalMs,
    lastErrorAt: null,
    lastSuccessfulAt: null,
    lastUpdatedAt: null,
    warning: '',
  });

  useEffect(() => {
    onPollRef.current = onPoll;
    getDelayRef.current = getDelay;
    onErrorRef.current = onError;
  }, [getDelay, onError, onPoll]);

  useEffect(() => {
    if (!enabled || typeof onPollRef.current !== 'function') {
      return undefined;
    }

    let canceled = false;
    let timerId = null;

    function resolveDelay(result = {}) {
      const delayContext = {
        ...result,
        hidden: document.visibilityState === 'hidden',
      };
      const customDelay = getDelayRef.current?.(delayContext);
      const nextDelay = Number(result.intervalMs || customDelay || initialIntervalMs);

      return Number.isFinite(nextDelay) && nextDelay > 0 ? nextDelay : initialIntervalMs;
    }

    function schedule(result = {}) {
      if (canceled) {
        return;
      }

      const nextIntervalMs = resolveDelay(result);
      setState((current) => ({
        ...current,
        intervalMs: nextIntervalMs,
      }));
      timerId = window.setTimeout(tick, nextIntervalMs);
    }

    async function tick() {
      if (pauseWhenBusy && pollingRef.current) {
        schedule();
        return;
      }

      pollingRef.current = true;

      try {
        const result = (await onPollRef.current()) || {};

        if (canceled) {
          return;
        }

        const nextIntervalMs = resolveDelay(result);
        const successfulAt = result.lastUpdatedAt || new Date().toISOString();

        setState((current) => ({
          ...current,
          ...result,
          consecutiveErrors: 0,
          error: '',
          intervalMs: nextIntervalMs,
          lastSuccessfulAt: successfulAt,
          lastUpdatedAt: successfulAt,
          warning: '',
        }));
        timerId = window.setTimeout(tick, nextIntervalMs);
      } catch (error) {
        if (canceled) {
          return;
        }

        const errorMessage = getErrorMessage(error);
        const failedAt = new Date().toISOString();
        onErrorRef.current?.(error);
        setState((current) => {
          const consecutiveErrors = Number(current.consecutiveErrors || 0) + 1;

          return {
            ...current,
            consecutiveErrors,
            error: consecutiveErrors >= errorThreshold ? errorMessage : '',
            lastErrorAt: failedAt,
            warning: errorMessage,
          };
        });
        schedule();
      } finally {
        pollingRef.current = false;
      }
    }

    function handleVisibilityChange() {
      if (document.visibilityState === 'visible') {
        if (timerId) {
          window.clearTimeout(timerId);
        }

        timerId = window.setTimeout(tick, 250);
      }
    }

    schedule();
    document.addEventListener('visibilitychange', handleVisibilityChange);

    return () => {
      canceled = true;
      document.removeEventListener('visibilitychange', handleVisibilityChange);

      if (timerId) {
        window.clearTimeout(timerId);
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, errorThreshold, initialIntervalMs, pauseWhenBusy, ...dependencies]);

  return state;
}

export default useSmartPolling;
