import { useEffect, useState } from 'react';
import useSmartPolling, { SMART_POLLING_INTERVALS } from './useSmartPolling.js';
import infrastructureService from '../services/infrastructureService.js';

function useDockerOverview() {
  const [overview, setOverview] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [refreshingAt, setRefreshingAt] = useState(null);

  async function loadOverview({ quiet = false } = {}) {
    if (!quiet) {
      setLoading(true);
      setError('');
    }

    try {
      const response = await infrastructureService.getDockerOverview();
      const nextOverview = response?.overview || null;
      setOverview(nextOverview);
      setRefreshingAt(new Date());

      return {
        activeCount: Number(nextOverview?.counts?.running || 0),
        lastUpdatedAt: nextOverview?.capturedAt || new Date().toISOString(),
      };
    } catch (loadError) {
      if (!quiet) {
        setError(loadError.message || 'Failed to load Docker infrastructure status.');
      }
      throw loadError;
    } finally {
      if (!quiet) {
        setLoading(false);
      }
    }
  }

  useEffect(() => {
    loadOverview();
  }, []);

  const pollingState = useSmartPolling({
    getDelay: ({ hidden = false } = {}) =>
      hidden ? SMART_POLLING_INTERVALS.HIDDEN : SMART_POLLING_INTERVALS.SLOW,
    initialIntervalMs: SMART_POLLING_INTERVALS.SLOW,
    onPoll: () => loadOverview({ quiet: true }),
  });

  return {
    error,
    loadOverview,
    loading,
    overview,
    pollingState,
    refreshingAt,
  };
}

export default useDockerOverview;
