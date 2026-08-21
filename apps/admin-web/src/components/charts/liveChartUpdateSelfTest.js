const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const source = fs.readFileSync(path.join(__dirname, 'EChartCanvas.jsx'), 'utf8');

assert.match(
  source,
  /useEffect\(\(\) => \{[\s\S]*?echarts\.init\([\s\S]*?instance\.dispose\(\);[\s\S]*?\}, \[\]\);/,
  'ECharts must initialize/dispose with the canvas lifecycle rather than with every option update.',
);
assert.match(
  source,
  /instance\.setOption\(normalizedOption, \{[\s\S]*?lazyUpdate: true,[\s\S]*?notMerge: false,[\s\S]*?replaceMerge: \['series'\]/,
  'Live chart data must update the existing ECharts instance with merge semantics.',
);
assert.equal(
  (source.match(/echarts\.init\(/g) || []).length,
  1,
  'The shared chart canvas must have a single initialization path.',
);

console.log('✅ SkyCommand live ECharts update self-test passed.');
