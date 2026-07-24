const fs = require('fs');
const path = require('path');

const chartDirectory = __dirname;
const themeSource = fs.readFileSync(path.join(chartDirectory, 'chartTheme.js'), 'utf8');
const canvasSource = fs.readFileSync(path.join(chartDirectory, 'EChartCanvas.jsx'), 'utf8');
const overlaySource = fs.readFileSync(path.join(chartDirectory, 'ChartFullscreenOverlay.jsx'), 'utf8');

function requireSource(source, pattern, message) {
  if (!pattern.test(source)) {
    throw new Error(message);
  }
}

requireSource(
  themeSource,
  /card:\s*\{[\s\S]*tooltipFontSize:\s*14,[\s\S]*legendFontSize:\s*16,[\s\S]*axisFontSize:\s*16,/,
  'Card chart legends and axes must use the 16px demo-readability baseline while preserving the 14px tooltip.',
);
requireSource(
  themeSource,
  /overlay:\s*\{[\s\S]*tooltipFontSize:\s*20,[\s\S]*legendFontSize:\s*22,[\s\S]*axisFontSize:\s*22,/,
  'Overlay legends and axes must use the 22px demo-readability baseline while preserving the 20px tooltip.',
);
requireSource(
  themeSource,
  /export function applyChartTypography\(option, variant = 'card'\)/,
  'Chart typography must be normalized through the shared chart theme.',
);
requireSource(
  themeSource,
  /hideOverlap:\s*true/,
  'Axis-label overlap protection must remain enabled after increasing chart text size.',
);
requireSource(
  themeSource,
  /containLabel:\s*true/,
  'Chart grids must contain the larger axis labels instead of clipping them.',
);
requireSource(
  canvasSource,
  /applyChartTypography\(option, variant\)/,
  'Every ECharts canvas must apply the shared typography normalizer.',
);
requireSource(
  canvasSource,
  /variant = 'card'/,
  'Chart canvases must default to card typography.',
);
requireSource(
  overlaySource,
  /variant="overlay"/,
  'Expanded charts must use the overlay typography profile.',
);
requireSource(
  overlaySource,
  /OVERLAY_GEOMETRY_SCALE/,
  'Expanded charts must retain geometry scaling independently of text sizing.',
);

if (/OVERLAY_FONT_SCALE/.test(overlaySource)) {
  throw new Error('Legacy recursive overlay font scaling must not override the shared typography profile.');
}

console.log('[SkyCommand] Dashboard chart typography self-test passed.');
