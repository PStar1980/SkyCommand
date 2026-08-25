export function serializeSorts(sorts = []) {
  return sorts.map((sort) => `${sort.field}:${sort.direction}`).join(',');
}

export function sortStacksMatch(left = [], right = []) {
  return serializeSorts(left) === serializeSorts(right);
}

export function getNextSortState({
  sorts = [],
  defaultSorts = [],
  sortingCustomized = false,
  field,
  shiftKey = false,
} = {}) {
  const currentSorts = sorts.length > 0 ? sorts : defaultSorts;
  const activeIndex = currentSorts.findIndex((sort) => sort.field === field);

  if (shiftKey) {
    if (activeIndex < 0) {
      return {
        sorts: [...currentSorts, { field, direction: 'asc' }],
        customized: true,
      };
    }

    const activeSort = currentSorts[activeIndex];

    if (!sortingCustomized && sortStacksMatch(currentSorts, defaultSorts)) {
      const nextSorts = [...currentSorts];
      nextSorts[activeIndex] = { field, direction: 'asc' };
      return { sorts: nextSorts, customized: true };
    }

    if (activeSort.direction === 'asc') {
      const nextSorts = [...currentSorts];
      nextSorts[activeIndex] = { ...activeSort, direction: 'desc' };
      return { sorts: nextSorts, customized: true };
    }

    const nextSorts = currentSorts.filter((_, index) => index !== activeIndex);
    const normalizedSorts = nextSorts.length > 0 ? nextSorts : defaultSorts;
    return {
      sorts: normalizedSorts,
      customized: !sortStacksMatch(normalizedSorts, defaultSorts),
    };
  }

  if (currentSorts.length > 1) {
    const nextPrimarySort =
      activeIndex >= 0 ? { ...currentSorts[activeIndex] } : { field, direction: 'asc' };
    return { sorts: [nextPrimarySort], customized: true };
  }

  if (activeIndex < 0) {
    return { sorts: [{ field, direction: 'asc' }], customized: true };
  }

  const activeSort = currentSorts[0];

  if (!sortingCustomized && sortStacksMatch(currentSorts, defaultSorts)) {
    return { sorts: [{ field, direction: 'asc' }], customized: true };
  }

  if (activeSort.direction === 'asc') {
    return { sorts: [{ field, direction: 'desc' }], customized: true };
  }

  return { sorts: defaultSorts, customized: false };
}
