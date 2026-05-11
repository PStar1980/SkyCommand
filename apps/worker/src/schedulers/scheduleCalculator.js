const UNIT_TO_MILLISECONDS = {
  MINUTE: 60 * 1000,
  HOUR: 60 * 60 * 1000,
  DAY: 24 * 60 * 60 * 1000,
  WEEK: 7 * 24 * 60 * 60 * 1000,
};

function toDate(value) {
  if (!value) {
    return null;
  }

  const date = value instanceof Date ? value : new Date(value);

  return Number.isNaN(date.getTime()) ? null : date;
}

function addInterval(dateValue, intervalValue, intervalUnit) {
  const date = toDate(dateValue);
  const unit = String(intervalUnit || '').toUpperCase();
  const amount = Number(intervalValue);
  const unitMs = UNIT_TO_MILLISECONDS[unit];

  if (!date || !Number.isFinite(amount) || amount <= 0 || !unitMs) {
    return null;
  }

  return new Date(date.getTime() + amount * unitMs);
}

function calculateInitialNextRun(schedule, referenceDate = new Date()) {
  if (!schedule?.enabled) {
    return null;
  }

  const scheduleType = String(schedule.scheduleType || schedule.schedule_type || '').toUpperCase();
  const runAt = toDate(schedule.runAt || schedule.run_at);
  const nextRunAt = toDate(schedule.nextRunAt || schedule.next_run_at);

  if (nextRunAt) {
    return nextRunAt;
  }

  if (scheduleType === 'ONCE') {
    return runAt;
  }

  if (scheduleType === 'INTERVAL') {
    const now = toDate(referenceDate) || new Date();
    let candidate = runAt || now;

    while (candidate && candidate <= now) {
      candidate = addInterval(
        candidate,
        schedule.intervalValue || schedule.interval_value,
        schedule.intervalUnit || schedule.interval_unit,
      );
    }

    return candidate;
  }

  return null;
}

function calculateNextRunAfterExecution(schedule, referenceDate = new Date()) {
  const scheduleType = String(schedule.scheduleType || schedule.schedule_type || '').toUpperCase();
  const now = toDate(referenceDate) || new Date();

  if (scheduleType === 'ONCE') {
    return null;
  }

  if (scheduleType !== 'INTERVAL') {
    return null;
  }

  let candidate = addInterval(
    schedule.nextRunAt || schedule.next_run_at || schedule.lastRunAt || schedule.last_run_at || now,
    schedule.intervalValue || schedule.interval_value,
    schedule.intervalUnit || schedule.interval_unit,
  );

  while (candidate && candidate <= now) {
    candidate = addInterval(
      candidate,
      schedule.intervalValue || schedule.interval_value,
      schedule.intervalUnit || schedule.interval_unit,
    );
  }

  return candidate;
}

module.exports = {
  addInterval,
  calculateInitialNextRun,
  calculateNextRunAfterExecution,
};
