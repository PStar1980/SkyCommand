import { useMemo } from 'react';
import StatCard from '../ui/StatCard.jsx';
import StatusPill from '../ui/StatusPill.jsx';
import TrendAreaChart from './TrendAreaChart.jsx';
import { CHART_COLORS } from './chartTheme.js';
import { buildDockerStaleDataMessage, getDockerLiveLaneState } from '../../utils/dockerLiveStatus.js';

function formatBytes(value) {
  const bytes = Number(value || 0);
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let amount = bytes;
  let index = 0;
  while (amount >= 1024 && index < units.length - 1) {
    amount /= 1024;
    index += 1;
  }
  return `${amount >= 10 || index === 0 ? amount.toFixed(0) : amount.toFixed(1)} ${units[index]}`;
}

function formatRate(value) {
  return `${formatBytes(value)}/s`;
}

function formatPercent(value) {
  const number = Number(value || 0);
  return `${number >= 10 ? number.toFixed(1) : number.toFixed(2)}%`;
}

function formatTime(value) {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  return date.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit', second: '2-digit' });
}

function buildSeries(samples, field) {
  return samples.map((sample) => Number(sample?.totals?.[field] || 0));
}

function DockerTelemetryVisuals({ telemetry }) {
  const samples = Array.isArray(telemetry?.samples) ? telemetry.samples : [];
  const latest = telemetry?.latestSample || null;
  const totals = latest?.totals || {};
  const labels = useMemo(() => samples.map((sample) => formatTime(sample.capturedAt)), [samples]);
  const topContainers = useMemo(
    () =>
      [...(Array.isArray(latest?.containers) ? latest.containers : [])]
        .sort(
          (left, right) =>
            Number(right.cpuPercent || 0) - Number(left.cpuPercent || 0) ||
            Number(right.memoryBytes || 0) - Number(left.memoryBytes || 0),
        )
        .slice(0, 8),
    [latest],
  );
  const sampleSeconds = telemetry?.sampleIntervalMs
    ? Math.max(1, Math.round(telemetry.sampleIntervalMs / 1000))
    : 5;
  const lane = getDockerLiveLaneState(telemetry);
  const online = lane.live;
  const staleNotice = buildDockerStaleDataMessage({
    noun: 'Docker resource telemetry',
    sourceErrorCode: telemetry?.sourceErrorCode,
    sourceStatus: telemetry?.sourceStatus,
  });

  return (
    <section className="sky-dashboard-visuals mb-3">
      <div className="sky-dashboard-section-heading mb-3">
        <div>
          <div className="sky-page-kicker">Live resource telemetry</div>
          <h2 className="h5 mb-0">Docker Runtime Pressure</h2>
          <div className="small sky-muted mt-1">
            Host Agent samples Docker resource statistics every {sampleSeconds}s. Charts update the existing ECharts canvas in place rather than remounting it.
          </div>
        </div>
        <div className="d-flex flex-wrap gap-2 align-items-center">
          <StatusPill
            label={`Browser ${telemetry?.connectionStatus || 'CONNECTING'}`}
            status={telemetry?.connectionStatus === 'CONNECTED' ? 'ONLINE' : 'WARNING'}
          />
          <StatusPill
            label={`Docker source ${lane.label}`}
            status={lane.status}
          />
          <span className="small sky-muted">
            Last sample {formatTime(telemetry?.lastSampleAt)}
          </span>
        </div>
      </div>

      {telemetry?.error && <div className="small text-warning mb-2">{telemetry.error}</div>}
      {!online && staleNotice && samples.length > 0 && (
        <div className="alert alert-warning py-2 mb-3">
          <strong>Historical sample retained.</strong> {staleNotice}
        </div>
      )}

      <div className="row g-3 mb-3">
        <div className="col-6 col-xl">
          <StatCard
            helper={`${totals.containerCount || 0} running container(s)`}
            label="Container CPU"
            status={online ? 'ONLINE' : 'WARNING'}
            value={formatPercent(totals.cpuPercent)}
          />
        </div>
        <div className="col-6 col-xl">
          <StatCard
            helper={`${formatPercent(totals.memoryPercent)} aggregate share`}
            label="Memory Used"
            status={online ? 'ONLINE' : 'WARNING'}
            value={formatBytes(totals.memoryBytes)}
          />
        </div>
        <div className="col-6 col-xl">
          <StatCard
            helper={`TX ${formatRate(totals.networkTxRateBytesPerSec)}`}
            label="Network RX"
            status="INFO"
            value={formatRate(totals.networkRxRateBytesPerSec)}
          />
        </div>
        <div className="col-6 col-xl">
          <StatCard
            helper={`Write ${formatRate(totals.blockWriteRateBytesPerSec)}`}
            label="Block Read"
            status="INFO"
            value={formatRate(totals.blockReadRateBytesPerSec)}
          />
        </div>
        <div className="col-6 col-xl">
          <StatCard
            helper={telemetry?.sourceHostname || 'Host source pending'}
            label="Processes"
            status="INFO"
            value={totals.pids || 0}
          />
        </div>
      </div>

      <div className="sky-dashboard-chart-grid sky-dashboard-chart-grid-expanded mb-3">
        <TrendAreaChart
          colors={[CHART_COLORS.gold]}
          height={270}
          isEmpty={samples.length === 0}
          kicker="Compute"
          labels={labels}
          series={[{ name: 'Container CPU', values: buildSeries(samples, 'cpuPercent'), areaOpacity: 0.12 }]}
          subtitle="Aggregate Docker container CPU across the live host sample window. Multi-core workloads may exceed 100%."
          title="CPU Utilization"
          valueFormatter={(value) => formatPercent(value)}
          yAxisFormatter={(value) => `${Number(value || 0).toFixed(0)}%`}
        />
        <TrendAreaChart
          colors={[CHART_COLORS.cyan]}
          height={270}
          isEmpty={samples.length === 0}
          kicker="Memory"
          labels={labels}
          series={[{ name: 'Memory used', values: buildSeries(samples, 'memoryBytes'), areaOpacity: 0.12 }]}
          subtitle="Sum of current container memory usage reported by Docker."
          title="Memory Pressure"
          valueFormatter={(value) => formatBytes(value)}
          yAxisFormatter={(value) => formatBytes(value)}
        />
        <TrendAreaChart
          colors={[CHART_COLORS.green, CHART_COLORS.blue, CHART_COLORS.gold, CHART_COLORS.violet]}
          height={270}
          isEmpty={samples.length === 0}
          kicker="Throughput"
          labels={labels}
          series={[
            { name: 'Network RX', values: buildSeries(samples, 'networkRxRateBytesPerSec'), areaOpacity: 0.08 },
            { name: 'Network TX', values: buildSeries(samples, 'networkTxRateBytesPerSec'), areaOpacity: 0.05 },
            { name: 'Block read', values: buildSeries(samples, 'blockReadRateBytesPerSec'), areaOpacity: 0.04 },
            { name: 'Block write', values: buildSeries(samples, 'blockWriteRateBytesPerSec'), areaOpacity: 0.03 },
          ]}
          subtitle="Per-second rates derived from successive Docker cumulative I/O counters. Counter resets are treated as zero-rate restarts."
          title="I/O Throughput"
          valueFormatter={(value) => formatRate(value)}
          yAxisFormatter={(value) => formatRate(value)}
        />
      </div>

      <section className="sky-card">
        <div className="sky-card-header">
          <div>
            <div className="sky-page-kicker">Hot containers</div>
            <h2 className="h5 mb-0">Current Resource Leaders</h2>
            <div className="small sky-muted mt-1">Newest live sample, ordered by CPU and then memory usage.</div>
          </div>
        </div>
        <div className="table-responsive sky-table-card border-0 rounded-0">
          <table className="table table-sm table-hover sky-table align-middle mb-0">
            <thead>
              <tr>
                <th>Container</th>
                <th>Project</th>
                <th className="text-end">CPU</th>
                <th className="text-end">Memory</th>
                <th className="text-end">Network RX</th>
                <th className="text-end">Network TX</th>
                <th className="text-end">PIDs</th>
              </tr>
            </thead>
            <tbody>
              {topContainers.length === 0 ? (
                <tr>
                  <td className="sky-muted text-center py-4" colSpan="7">
                    {online
                      ? 'Waiting for the first Docker telemetry sample…'
                      : 'Waiting for a healthy Docker telemetry source…'}
                  </td>
                </tr>
              ) : (
                topContainers.map((container) => (
                  <tr key={container.containerId || container.containerName}>
                    <td>
                      <div className="fw-semibold">{container.containerName || container.containerId}</div>
                      {container.service && <div className="small sky-muted">{container.service}</div>}
                    </td>
                    <td>{container.project || '—'}</td>
                    <td className="text-end">{formatPercent(container.cpuPercent)}</td>
                    <td className="text-end">{formatBytes(container.memoryBytes)}</td>
                    <td className="text-end">{formatRate(container.networkRxRateBytesPerSec)}</td>
                    <td className="text-end">{formatRate(container.networkTxRateBytesPerSec)}</td>
                    <td className="text-end">{container.pids || 0}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </section>
    </section>
  );
}

export default DockerTelemetryVisuals;
