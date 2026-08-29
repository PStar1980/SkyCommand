import { mean, quantileSorted, rollups } from 'd3-array';
import { timeDay } from 'd3-time';
import { timeFormat } from 'd3-time-format';

export function toChartDate(value) {
  if (!value) {
    return null;
  }

  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

export function dateFromField(item, fieldName) {
  return toChartDate(item?.[fieldName]);
}

export function getDateDiffMs(start, end) {
  const startDate = toChartDate(start);
  const endDate = toChartDate(end);

  if (!startDate || !endDate) {
    return null;
  }

  return Math.max(0, endDate.getTime() - startDate.getTime());
}

export function buildRecentDaySeries(items, { dateAccessor, daysBack = 7, predicate = () => true } = {}) {
  const today = timeDay.floor(new Date());
  const days = Array.from({ length: daysBack }, (_, index) =>
    timeDay.offset(today, index - (daysBack - 1)),
  );
  const formatKey = timeFormat('%Y-%m-%d');
  const formatLabel = timeFormat('%b %d');
  const startDate = days[0];

  const rolled = new Map(
    rollups(
      items
        .filter(predicate)
        .map((item) => toChartDate(dateAccessor?.(item)))
        .filter((date) => date && date >= startDate),
      (values) => values.length,
      (date) => formatKey(timeDay.floor(date)),
    ),
  );

  return {
    labels: days.map((date) => formatLabel(date)),
    values: days.map((date) => rolled.get(formatKey(date)) || 0),
  };
}

export function buildRecentDaySeriesFromField(items, fieldName, daysBack = 7) {
  return buildRecentDaySeries(items, {
    daysBack,
    dateAccessor: (item) => item?.[fieldName],
  });
}

export function buildRecentDayDurationSeries(
  items,
  { dateAccessor, durationAccessor, daysBack = 7 } = {},
) {
  const today = timeDay.floor(new Date());
  const days = Array.from({ length: daysBack }, (_, index) =>
    timeDay.offset(today, index - (daysBack - 1)),
  );
  const formatKey = timeFormat('%Y-%m-%d');
  const formatLabel = timeFormat('%b %d');
  const startDate = days[0];

  const durationRows = items
    .map((item) => ({
      date: toChartDate(dateAccessor?.(item)),
      durationMs: durationAccessor?.(item),
    }))
    .filter((item) => item.date && item.date >= startDate && Number.isFinite(item.durationMs));

  const rolled = new Map(
    rollups(
      durationRows,
      (values) => Math.round(mean(values, (item) => item.durationMs) || 0),
      (item) => formatKey(timeDay.floor(item.date)),
    ),
  );

  return {
    labels: days.map((date) => formatLabel(date)),
    values: days.map((date) => rolled.get(formatKey(date)) || 0),
  };
}


export function buildRecentDayDurationPercentileSeries(
  items,
  { dateAccessor, durationAccessor, daysBack = 7, percentiles = [0.5, 0.95] } = {},
) {
  const today = timeDay.floor(new Date());
  const days = Array.from({ length: daysBack }, (_, index) =>
    timeDay.offset(today, index - (daysBack - 1)),
  );
  const formatKey = timeFormat('%Y-%m-%d');
  const formatLabel = timeFormat('%b %d');
  const startDate = days[0];
  const buckets = new Map();

  for (const item of items) {
    const date = toChartDate(dateAccessor?.(item));
    const durationMs = durationAccessor?.(item);

    if (!date || date < startDate || !Number.isFinite(durationMs)) {
      continue;
    }

    const key = formatKey(timeDay.floor(date));
    const values = buckets.get(key) || [];
    values.push(Number(durationMs));
    buckets.set(key, values);
  }

  for (const values of buckets.values()) {
    values.sort((left, right) => left - right);
  }

  return {
    labels: days.map((date) => formatLabel(date)),
    percentileValues: percentiles.map((percentile) =>
      days.map((date) => {
        const values = buckets.get(formatKey(date)) || [];
        return values.length ? Math.round(quantileSorted(values, percentile) || 0) : 0;
      }),
    ),
  };
}

export function countByField(items, fieldName, statusOrder = []) {
  const rolled = new Map(
    rollups(
      items,
      (values) => values.length,
      (item) => item?.[fieldName] || 'UNKNOWN',
    ),
  );

  const ordered = statusOrder.map((status) => ({
    name: status,
    value: rolled.get(status) || 0,
  }));

  for (const [status, value] of rolled.entries()) {
    if (!statusOrder.includes(status)) {
      ordered.push({ name: status, value });
    }
  }

  return ordered.filter((item) => item.value > 0);
}
