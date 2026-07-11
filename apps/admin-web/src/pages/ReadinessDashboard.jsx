import { useEffect, useMemo, useState } from 'react';
import ProductionReadinessVisuals from '../components/charts/ProductionReadinessVisuals.jsx';
import DashboardFilterCard from '../components/ui/DashboardFilterCard.jsx';
import PageHeader from '../components/ui/PageHeader.jsx';
import adminService from '../services/adminService';

const STATUS_OPTIONS = [
  { value: '', label: 'All statuses' },
  { value: 'PASS', label: 'Pass' },
  { value: 'WARNING', label: 'Warning' },
  { value: 'FAIL', label: 'Failure' },
  { value: 'INFO', label: 'Info' },
];

function formatDate(value) {
  if (!value) {
    return '—';
  }

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return '—';
  }

  return new Intl.DateTimeFormat(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(date);
}

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

  async function loadReadiness() {
    setLoading(true);
    setError('');

    try {
      const result = await adminService.getProductionReadiness();
      setReadiness(result);
      setRefreshingAt(new Date());
    } catch (loadError) {
      setError(loadError.message || 'Failed to load readiness analytics.');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadReadiness();
  }, []);

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
        actions={(
          <>
            <button className="btn sky-btn-ghost" disabled={loading} onClick={loadReadiness} type="button">
              {loading ? 'Refreshing...' : 'Refresh analytics'}
            </button>
            <div className="small sky-muted mt-2">Last refresh: {refreshingAt ? formatDate(refreshingAt) : '—'}</div>
          </>
        )}
        kicker="Dashboards · Readiness"
        subtitle="Review readiness score, status mix, category coverage, hardening progress, and risk concentration as a visual control surface."
        title="Readiness Dashboard"
      />

      {error && <div className="alert alert-danger">{error}</div>}

      <DashboardFilterCard
        actions={(
          <button className="btn sky-btn-ghost" disabled={loading} onClick={resetFilters} type="button">
            Reset filters
          </button>
        )}
        meta={`${filteredCounts.checks} visible checks · ${filteredCounts.areas} readiness area(s)`}
        title="Readiness analytics filters"
      >
        <div>
          <label className="form-label" htmlFor="readinessDashboardArea">Readiness area</label>
          <select
            className="form-select sky-form-control"
            id="readinessDashboardArea"
            onChange={(event) => updateFilter('area', event.target.value)}
            value={filters.area}
          >
            <option value="">All areas</option>
            {areaOptions.map((option) => (
              <option key={option.value} value={option.value}>{option.label}</option>
            ))}
          </select>
        </div>
        <div>
          <label className="form-label" htmlFor="readinessDashboardStatus">Check status</label>
          <select
            className="form-select sky-form-control"
            id="readinessDashboardStatus"
            onChange={(event) => updateFilter('status', event.target.value)}
            value={filters.status}
          >
            {STATUS_OPTIONS.map((option) => (
              <option key={option.value || 'all'} value={option.value}>{option.label}</option>
            ))}
          </select>
        </div>
      </DashboardFilterCard>

      <ProductionReadinessVisuals readiness={filteredReadiness} />
    </>
  );
}

export default ReadinessDashboard;
