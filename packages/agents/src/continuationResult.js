'use strict';

const TOP_LEVEL_KEYS = Object.freeze(['previous_task_summary', 'capability_result']);
const CAPABILITY_KEYS = Object.freeze(['ok', 'effectId', 'dispatchState', 'outcomeCertainty', 'browserAutomationRunId']);

function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function exactKeys(value, expected) {
  if (!isPlainObject(value)) return false;
  const keys = Object.keys(value).sort();
  const wanted = [...expected].sort();
  return keys.length === wanted.length && wanted.every((key, index) => keys[index] === key);
}

function validateContinuationResultObject(value, { requireSuccessfulCapability = true } = {}) {
  if (!exactKeys(value, TOP_LEVEL_KEYS)) return { valid: false, code: 'CONTINUATION_RESULT_TOP_LEVEL_SHAPE_INVALID' };
  const summary = value.previous_task_summary;
  if (typeof summary !== 'string' || !summary.trim() || summary.length > 2000) {
    return { valid: false, code: 'CONTINUATION_RESULT_SUMMARY_INVALID' };
  }
  const capability = value.capability_result;
  if (!exactKeys(capability, CAPABILITY_KEYS)
    || typeof capability.ok !== 'boolean'
    || ['effectId', 'dispatchState', 'outcomeCertainty', 'browserAutomationRunId']
      .some((key) => typeof capability[key] !== 'string' || !capability[key].trim())) {
    return { valid: false, code: 'CONTINUATION_RESULT_CAPABILITY_SHAPE_INVALID' };
  }
  if (requireSuccessfulCapability && (
    capability.ok !== true
    || capability.dispatchState !== 'COMPLETED'
    || capability.outcomeCertainty !== 'ACKNOWLEDGED'
  )) return { valid: false, code: 'CONTINUATION_RESULT_CAPABILITY_NOT_SUCCESSFUL' };

  return {
    valid: true,
    code: null,
    normalized: {
      previous_task_summary: summary,
      capability_result: Object.fromEntries(CAPABILITY_KEYS.map((key) => [key, capability[key]])),
    },
  };
}

function parseSingleContinuationResult(message, options = {}) {
  let value;
  try { value = JSON.parse(String(message || '')); }
  catch (_error) { return { valid: false, code: 'CONTINUATION_RESULT_JSON_INVALID', parsed: false, valueCount: 0 }; }
  const validation = validateContinuationResultObject(value, options);
  return { ...validation, parsed: true, valueCount: 1, values: [value] };
}

function parseAdjacentContinuationResultObjects(message, { maxValues = 8 } = {}) {
  const input = String(message || '');
  const values = [];
  const slices = [];
  let cursor = 0;
  const skipWhitespace = () => { while (cursor < input.length && /\s/.test(input[cursor])) cursor += 1; };

  skipWhitespace();
  while (cursor < input.length) {
    if (values.length >= maxValues || input[cursor] !== '{') {
      return { parsed: false, code: 'CONTINUATION_RESULT_SEQUENCE_INVALID', values: [], slices: [] };
    }
    const start = cursor;
    let depth = 0;
    let inString = false;
    let escaped = false;
    let end = -1;
    for (; cursor < input.length; cursor += 1) {
      const char = input[cursor];
      if (inString) {
        if (escaped) escaped = false;
        else if (char === '\\') escaped = true;
        else if (char === '"') inString = false;
        continue;
      }
      if (char === '"') {
        inString = true;
        continue;
      }
      if (char === '{') depth += 1;
      else if (char === '}') {
        depth -= 1;
        if (depth === 0) {
          end = cursor + 1;
          cursor = end;
          break;
        }
        if (depth < 0) break;
      }
    }
    if (end < 0 || inString || depth !== 0) {
      return { parsed: false, code: 'CONTINUATION_RESULT_SEQUENCE_INVALID', values: [], slices: [] };
    }
    const slice = input.slice(start, end);
    try {
      const value = JSON.parse(slice);
      if (!isPlainObject(value)) return { parsed: false, code: 'CONTINUATION_RESULT_SEQUENCE_INVALID', values: [], slices: [] };
      values.push(value);
      slices.push(slice);
    } catch (_error) {
      return { parsed: false, code: 'CONTINUATION_RESULT_SEQUENCE_INVALID', values: [], slices: [] };
    }
    skipWhitespace();
  }
  return { parsed: values.length > 0, code: values.length ? null : 'CONTINUATION_RESULT_SEQUENCE_INVALID', values, slices };
}

function selectFinalRevalidatableContinuationResult(message) {
  const sequence = parseAdjacentContinuationResultObjects(message);
  if (!sequence.parsed) return { valid: false, code: sequence.code, valueCount: 0 };
  const finalIndex = sequence.values.length - 1;
  const validation = validateContinuationResultObject(sequence.values[finalIndex], { requireSuccessfulCapability: true });
  if (!validation.valid) return { ...validation, valueCount: sequence.values.length, selectedIndex: finalIndex };
  return {
    ...validation,
    valueCount: sequence.values.length,
    selectedIndex: finalIndex,
    selectedSlice: sequence.slices[finalIndex],
    priorValues: sequence.values.slice(0, finalIndex),
  };
}

module.exports = {
  CAPABILITY_KEYS,
  TOP_LEVEL_KEYS,
  parseAdjacentContinuationResultObjects,
  parseSingleContinuationResult,
  selectFinalRevalidatableContinuationResult,
  validateContinuationResultObject,
};
