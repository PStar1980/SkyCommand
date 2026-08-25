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


export function compareTableValues(leftValue, rightValue) {
  const leftEmpty = leftValue === '' || leftValue === null || leftValue === undefined;
  const rightEmpty = rightValue === '' || rightValue === null || rightValue === undefined;

  if (leftEmpty && rightEmpty) return 0;
  if (leftEmpty) return 1;
  if (rightEmpty) return -1;

  if (typeof leftValue === 'number' && typeof rightValue === 'number') {
    return leftValue - rightValue;
  }

  return String(leftValue).localeCompare(String(rightValue), undefined, {
    numeric: true,
    sensitivity: 'base',
  });
}

export function sortItemsBySorts(items = [], sorts = [], getSortValue = (item, field) => item?.[field]) {
  if (!Array.isArray(sorts) || sorts.length === 0) {
    return items;
  }

  return [...items].sort((left, right) => {
    for (const sort of sorts) {
      const leftValue = getSortValue(left, sort.field);
      const rightValue = getSortValue(right, sort.field);
      const leftEmpty = leftValue === '' || leftValue === null || leftValue === undefined;
      const rightEmpty = rightValue === '' || rightValue === null || rightValue === undefined;

      if (leftEmpty || rightEmpty) {
        if (leftEmpty && rightEmpty) continue;
        return leftEmpty ? 1 : -1;
      }

      const comparison = compareTableValues(leftValue, rightValue);

      if (comparison !== 0) {
        return sort.direction === 'desc' ? -comparison : comparison;
      }
    }

    return 0;
  });
}
