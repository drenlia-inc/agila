/** Shared print helpers for Reports (light paper output, hide UI chrome). */

export type PrintReportOptions = {
  /** Run before print (e.g. switch chart to print dimensions). */
  onPrepare?: () => void | Promise<void>;
  /** Run after print dialog closes. */
  onCleanup?: () => void;
};

/** CSS px at 96dpi — conservative Letter landscape minus @page margins (matches burndown @page). */
export function estimateLandscapePrintableSizePx(
  paper: 'letter' | 'legal' = 'letter',
  marginCm = 0.6,
): { width: number; height: number } {
  const marginIn = (marginCm * 2) / 2.54;
  const pageWidthIn = paper === 'legal' ? 14 : 11;
  const pageHeightIn = 8.5;
  return {
    width: Math.floor((pageWidthIn - marginIn) * 96),
    height: Math.floor((pageHeightIn - marginIn) * 96),
  };
}

/** Chart width that fits Letter landscape; avoids clipping when paper size is unknown. */
export function estimateBurndownPrintChartWidthPx(): number {
  return estimateLandscapePrintableSizePx('letter').width;
}

/** Remaining vertical space for chart after title + metric row on a landscape page. */
export function estimateBurndownPrintChartHeightPx(): number {
  const { height } = estimateLandscapePrintableSizePx('letter');
  return Math.min(480, Math.max(320, height - 200));
}

const REPORT_PRINT_CHROME_HIDE = `
  header,
  nav,
  .no-print,
  .reports-tabs,
  .reports-header,
  [class*="ActivityFeed"],
  [class*="activity-feed"],
  div[style*="position: fixed"],
  div[style*="position:fixed"],
  div[class*="fixed"],
  [style*="z-index: 9999"],
  [style*="z-index:9999"],
  [class*="NetworkStatus"],
  [class*="ToastContainer"],
  [class*="Toast"],
  [class*="ModalManager"],
  [class*="TaskLinkingOverlay"],
  [class*="VersionUpdateBanner"],
  [class*="ResetCountdown"],
  [class*="DebugPanel"],
  [class*="sticky"] {
    display: none !important;
    visibility: hidden !important;
    position: absolute !important;
    left: -9999px !important;
  }

  button[title="Print report"] {
    display: none !important;
  }
`;

const REPORT_PRINT_LIGHT_BASE = `
  html, body {
    background: white !important;
    color: #111827 !important;
    color-scheme: light !important;
  }

  body > *:not(script),
  html {
    margin: 0 !important;
    padding: 0 !important;
  }

  .flex-1,
  .w-4\\/5,
  .mx-auto {
    width: 100% !important;
    max-width: 100% !important;
    margin: 0 !important;
  }

  .space-y-6 {
    margin: 0 !important;
    padding: 0 !important;
  }

  .space-y-6 > * {
    page-break-inside: avoid;
    margin-top: 0.5rem !important;
  }

  .space-y-6 > *:first-child {
    margin-top: 0 !important;
  }

  .grid {
    display: grid !important;
  }

  h2 {
    font-size: 1.25rem !important;
    margin-bottom: 0.25rem !important;
    page-break-after: avoid !important;
    color: #111827 !important;
  }

  h2 + p {
    font-size: 0.75rem !important;
    margin-bottom: 0.25rem !important;
    page-break-after: avoid !important;
    color: #4b5563 !important;
  }

  .text-gray-900, .dark\\:text-white {
    color: #111827 !important;
  }

  .text-gray-600, .text-gray-500, .dark\\:text-gray-400 {
    color: #4b5563 !important;
  }

  .bg-white, .dark\\:bg-gray-800 {
    background-color: white !important;
  }

  .bg-blue-50, .bg-green-50, .bg-purple-50, .bg-orange-50,
  .dark\\:bg-blue-900\\/20, .dark\\:bg-green-900\\/20,
  .dark\\:bg-purple-900\\/20, .dark\\:bg-orange-900\\/20 {
    background-color: #f9fafb !important;
    -webkit-print-color-adjust: exact;
    print-color-adjust: exact;
  }

  [class*="recharts"] {
    -webkit-print-color-adjust: exact;
    print-color-adjust: exact;
  }
`;

const BURNDOWN_PRINT_LAYOUT = `
  @page {
    size: landscape;
    margin: 0.6cm;
  }

  .grid.grid-cols-1,
  .grid[class*="grid-cols-1"],
  .grid[class*="grid-cols-3"],
  .grid[class*="md:grid-cols-3"] {
    grid-template-columns: repeat(3, minmax(0, 1fr)) !important;
  }

  .burndown-print-root .space-y-6 > * {
    margin-top: 0.35rem !important;
  }

  .burndown-print-root {
    width: 100% !important;
    max-width: 100% !important;
    overflow: visible !important;
  }

  .burndown-print-data {
    padding: 0.5rem 0.75rem !important;
    page-break-inside: avoid;
    border: none !important;
    box-shadow: none !important;
    width: 100% !important;
    max-width: 100% !important;
    overflow: visible !important;
  }

  .burndown-print-metrics {
    grid-template-columns: repeat(3, minmax(0, 1fr)) !important;
    gap: 0.35rem !important;
    margin-bottom: 0.25rem !important;
  }

  .burndown-print-metrics > div {
    padding: 0.35rem 0.5rem !important;
  }

  .burndown-print-metrics .text-2xl {
    font-size: 1.125rem !important;
  }

  .burndown-print-metrics .text-sm {
    font-size: 0.7rem !important;
  }

  .burndown-print-chart {
    page-break-inside: avoid;
    width: 100% !important;
    max-width: 100% !important;
    margin-top: 0.25rem !important;
    overflow: visible !important;
  }

  .burndown-print-chart .burndown-chart-wrap {
    overflow: visible !important;
    max-width: 100% !important;
    margin-left: auto !important;
    margin-right: auto !important;
  }

  .burndown-print-chart .burndown-chart-print-host {
    max-width: 100% !important;
    margin-left: auto !important;
    margin-right: auto !important;
  }

  .burndown-print-chart .recharts-cartesian-axis-tick text {
    font-size: 8px !important;
    fill: #374151 !important;
  }

  .burndown-print-chart .recharts-label {
    font-size: 9px !important;
    fill: #374151 !important;
  }

  .burndown-print-chart h3 {
    font-size: 0.9rem !important;
    margin-bottom: 0.25rem !important;
  }

  .burndown-print-root > .flex.items-center.justify-between:first-of-type h2 svg {
    display: none !important;
  }

  .burndown-print-chart .recharts-line-curve {
    stroke-width: 2px !important;
  }
`;

const TABLE_REPORT_PRINT_LAYOUT = `
  @page {
    size: landscape;
    margin: 0.5cm;
  }

  .space-y-6 > .table-report-print-data {
    page-break-inside: auto !important;
    margin-top: 0.35rem !important;
  }

  .table-report-print-metrics {
    page-break-inside: avoid !important;
    page-break-after: avoid !important;
    margin-bottom: 0.25rem !important;
    padding: 0.5rem !important;
  }

  .table-report-print-table {
    page-break-before: avoid !important;
    page-break-inside: auto !important;
  }

  .table-report-print-metrics.grid,
  .table-report-print-metrics[class*="grid-cols"] {
    display: grid !important;
  }

  .table-report-print-metrics.grid-cols-1,
  .table-report-print-metrics[class*="grid-cols-1"],
  .table-report-print-metrics[class*="grid-cols-2"],
  .table-report-print-metrics[class*="grid-cols-4"],
  .table-report-print-metrics[class*="md:grid-cols-4"] {
    grid-template-columns: repeat(4, minmax(0, 1fr)) !important;
  }

  table {
    width: 100% !important;
    table-layout: fixed !important;
    font-size: 9px !important;
    page-break-before: avoid !important;
    margin-top: 0 !important;
  }

  .overflow-x-auto {
    overflow: visible !important;
    width: 100% !important;
  }

  thead {
    display: table-header-group !important;
  }

  tbody {
    display: table-row-group !important;
  }

  th, td {
    padding: 3px 4px !important;
    font-size: 9px !important;
    overflow: hidden !important;
    text-overflow: ellipsis !important;
    word-wrap: break-word !important;
    color: #111827 !important;
  }

  tr {
    page-break-inside: avoid;
    page-break-after: auto;
  }

  .table-report-print-metrics .text-2xl {
    font-size: 1.25rem !important;
  }

  .table-report-print-metrics .text-sm {
    font-size: 0.75rem !important;
  }

  .table-report-print-table.bg-white.rounded-lg.border {
    padding: 0.5rem !important;
  }
`;

export type ReportPrintVariant = 'burndown' | 'taskList' | 'teamPerformance';

export function getReportPrintStyles(variant: ReportPrintVariant): string {
  const variantLayout =
    variant === 'burndown'
      ? BURNDOWN_PRINT_LAYOUT
      : TABLE_REPORT_PRINT_LAYOUT;

  return `
    @media print {
      ${REPORT_PRINT_CHROME_HIDE}
      ${REPORT_PRINT_LIGHT_BASE}
      ${variantLayout}
    }
  `;
}

function waitForPaint(): Promise<void> {
  return new Promise((resolve) => {
    requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
  });
}

/** Print on white/light paper even when the app is in dark mode. */
export async function printReport(options?: PrintReportOptions): Promise<void> {
  const root = document.documentElement;
  const wasDark = root.classList.contains('dark');

  if (wasDark) {
    root.classList.remove('dark');
  }

  if (options?.onPrepare) {
    await options.onPrepare();
  }

  // Let Recharts/layout settle after theme + print-layout changes.
  await waitForPaint();
  await new Promise((resolve) => setTimeout(resolve, 300));

  let restored = false;
  const restore = () => {
    if (restored) return;
    restored = true;
    if (wasDark) {
      root.classList.add('dark');
    }
    options?.onCleanup?.();
    window.removeEventListener('afterprint', restore);
  };

  window.addEventListener('afterprint', restore);
  window.setTimeout(restore, 3000);

  window.print();
}
