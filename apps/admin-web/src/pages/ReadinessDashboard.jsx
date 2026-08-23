import { useEffect, useMemo, useState } from 'react';
import ProductionReadinessVisuals from '../components/charts/ProductionReadinessVisuals.jsx';
import DashboardFilterCard from '../components/ui/DashboardFilterCard.jsx';
import DashboardRefreshActions from '../components/ui/DashboardRefreshActions.jsx';
import PageHeader from '../components/ui/PageHeader.jsx';
import useSmartPolling, { SMART_POLLING_INTERVALS } from '../hooks/useSmartPolling.js';
import adminService from '../services/adminService';

import DismissibleAlert from '../components/ui/DismissibleAlert.jsx';
const STATUS_OPTIONS = [
  { value: '', label: 'All statuses' },
  { value: 'PASS', label: 'Pass' },
  { value: 'WARNING', label: 'Warning' },
  { value: 'FAIL', label: 'Failure' },
  { value: 'INFO', label: 'Info' },
];

function filterReadiness(readiness, filters) {
  if (!readiness) {
    return readiness;
  }

  const sections = Array.isArray(readiness.sections) ? readiness.sections : [];
  const filteredSections = sections
    .filter((section) => !filters.area || section.code === filters.area)
    .map((section) => ({
      ...section,
      checks: (section.checks || []).filter(
        (check) => !filters.status || String(check.status || '').toUpperCase() === filters.status,
      ),
    }))
    .filter((section) => (section.checks || []).length > 0);

  return {
    ...readiness,
    sections: filteredSections,
  };
}

function ReadinessDashboard() {
  const [readiness, setReadiness] = useState(null);
  const [filters, setFilters] = useState({ area: '', status: '' });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [refreshingAt, setRefreshingAt] = useState(null);

  async function loadReadiness({ quiet = false } = {}) {
    if (!quiet) {
      setLoading(true);
      setError('');
    }

    try {
      const result = await adminService.getProductionReadiness();
      setReadiness(result);
      setRefreshingAt(new Date());

      return { activeCount: result?.counts?.warning || 0 };
    } catch (loadError) {
      if (!quiet) {
        setError(loadError.message || 'Failed to load readiness analytics.');
      }
      throw loadError;
    } finally {
      if (!quiet) {
        setLoading(false);
      }
    }
  }

  useEffect(() => {
    loadReadiness();
  }, []);

  const pollingState = useSmartPolling({
    getDelay: ({ hidden = false } = {}) =>
      hidden ? SMART_POLLING_INTERVALS.HIDDEN : SMART_POLLING_INTERVALS.SLOW,
    initialIntervalMs: SMART_POLLING_INTERVALS.SLOW,
    onPoll: () => loadReadiness({ quiet: true }),
  });

  const areaOptions = useMemo(() => {
    const sections = Array.isArray(readiness?.sections) ? readiness.sections : [];
    return sections.map((section) => ({
      value: section.code,
      label: section.label || section.code,
    }));
  }, [readiness]);

  const filteredReadiness = useMemo(
    () => filterReadiness(readiness, filters),
    [filters, readiness],
  );

  const filteredCounts = useMemo(() => {
    const sections = Array.isArray(filteredReadiness?.sections) ? filteredReadiness.sections : [];
    const checks = sections.flatMap((section) => section.checks || []);
    return {
      checks: checks.length,
      areas: sections.length,
    };
  }, [filteredReadiness]);

  function updateFilter(name, value) {
    setFilters((currentFilters) => ({ ...currentFilters, [name]: value }));
  }

  function resetFilters() {
    setFilters({ area: '', status: '' });
  }

  return (
    <>
      <PageHeader
        actionClassName="sky-dashboard-page-actions"
        actions={
          <DashboardRefreshActions
            activeLabel="Warnings"
            lastRefreshAt={refreshingAt}
            loading={loading}
            onRefresh={() => loadReadiness()}
            pollingState={pollingState}
          />
        }
        kicker="Dashboards · Readiness"
        subtitle="Review readiness score, status mix, category coverage, hardening progress, and risk concentration as a visual control surface."
        title="Readiness Dashboard"
      />

      {error && <DismissibleAlert tone="danger">{error}</DismissibleAlert>}

      <DashboardFilterCard
        actions={
          <button
            className="btn sky-btn-ghost"
            disabled={loading}
            onClick={resetFilters}
            type="button"
          >
            Reset filters
          </button>
        }
        meta={`${filteredCounts.checks} visible checks · ${filteredCounts.areas} readiness area(s)`}
        title="Readiness analytics filters"
      >
        <div>
          <label className="form-label" htmlFor="readinessDashboardArea">
            Readiness area
          </label>
          <select
            className="form-select sky-form-control"
            id="readinessDashboardArea"
            onChange={(event) => updateFilter('area', event.target.value)}
            value={filters.area}
          >
            <option value="">All areas</option>
            {areaOptions.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="form-label" htmlFor="readinessDashboardStatus">
            Check status
          </label>
          <select
            className="form-select sky-form-control"
            id="readinessDashboardStatus"
            onChange={(event) => updateFilter('status', event.target.value)}
            value={filters.status}
          >
            {STATUS_OPTIONS.map((option) => (
              <option key={option.value || 'all'} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </div>
      </DashboardFilterCard>

      <ProductionReadinessVisuals readiness={filteredReadiness} />
    </>
  );
}

export default ReadinessDashboard;
