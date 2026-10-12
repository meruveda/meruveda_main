/** Shared Excel export helpers — real .xlsx workbooks via lazy `xlsx` import. */
const XLSX_MIME_TYPE =
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

export async function writeWorkbook(
  sheets: Record<string, Record<string, unknown>[]>,
  fileName: string,
) {
  const XLSX = await import('xlsx');
  const workbook = XLSX.utils.book_new();
  for (const [name, rows] of Object.entries(sheets)) {
    const safeRows = rows.length > 0 ? rows : [{ Note: 'No data for the selected filters' }];
    const ws = XLSX.utils.json_to_sheet(safeRows);
    // Auto-size columns from content (capped so one long cell can't blow out the sheet).
    const keys = Object.keys(safeRows[0] || {});
    ws['!cols'] = keys.map((k) => {
      const max = safeRows.reduce(
        (m, r) => Math.max(m, String((r as any)[k] ?? '').length),
        k.length,
      );
      return { wch: Math.min(48, Math.max(12, max + 2)) };
    });
    XLSX.utils.book_append_sheet(workbook, ws, name.slice(0, 31));
  }
  // Generate raw bytes and trigger the download via Blob + temporary anchor.
  // This is more reliable across browsers than `XLSX.writeFile` (which can
  // fail silently in sandboxed iframes / strict popup-blocker setups) and
  // lets us set the correct MIME type explicitly.
  const bytes = XLSX.write(workbook, { bookType: 'xlsx', type: 'array' });
  const blob = new Blob([bytes], { type: XLSX_MIME_TYPE });
  const url = URL.createObjectURL(blob);
  try {
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = fileName;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
  } finally {
    // Give the browser a tick to start the download before revoking.
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
}

export const excelFileName = (prefix: string) =>
  `${prefix}-${new Date().toISOString().slice(0, 10)}.xlsx`;
