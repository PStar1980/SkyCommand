export const SMART_TABLE_DEFAULT_PAGE_SIZE = 10;
export const SMART_TABLE_PAGE_SIZE_OPTIONS = [10, 25, 50];

export function getAvailableTablePageSizes(total) {
  const recordCount = Math.max(0, Number(total) || 0);

  return SMART_TABLE_PAGE_SIZE_OPTIONS.filter((size) => {
    if (size === 10) return true;
    if (size === 25) return recordCount >= 11;
    if (size === 50) return recordCount >= 26;
    return false;
  });
}

export function normalizeTablePageSize(pageSize, total) {
  const availablePageSizes = getAvailableTablePageSizes(total);
  const numericPageSize = Number(pageSize);

  if (availablePageSizes.includes(numericPageSize)) {
    return numericPageSize;
  }

  return availablePageSizes[availablePageSizes.length - 1] || SMART_TABLE_DEFAULT_PAGE_SIZE;
}

export function getPageForAbsoluteIndex(index, pageSize) {
  const safeIndex = Math.max(0, Number(index) || 0);
  const safePageSize = Math.max(1, Number(pageSize) || SMART_TABLE_DEFAULT_PAGE_SIZE);
  return Math.floor(safeIndex / safePageSize) + 1;
}
