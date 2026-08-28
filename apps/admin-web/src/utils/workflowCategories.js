export const DEFAULT_WORKFLOW_CATEGORY_CODE = 'GENERAL';

export function normalizeWorkflowCategories(items = []) {
  return [...(Array.isArray(items) ? items : [])]
    .filter((item) => item && item.categoryCode)
    .sort((left, right) => {
      const orderCompare = Number(left.displayOrder || 0) - Number(right.displayOrder || 0);

      if (orderCompare !== 0) {
        return orderCompare;
      }

      return String(left.displayName || left.categoryCode || '').localeCompare(
        String(right.displayName || right.categoryCode || ''),
      );
    });
}

export function getWorkflowCategoryCode(item = {}) {
  return String(
    item.categoryCode ||
      item.workflowCategoryCode ||
      item.metadata?.workflowCategoryCode ||
      DEFAULT_WORKFLOW_CATEGORY_CODE,
  ).trim() || DEFAULT_WORKFLOW_CATEGORY_CODE;
}

export function getWorkflowCategoryDisplayName(item = {}, categories = []) {
  const direct = String(
    item.categoryDisplayName ||
      item.workflowCategoryDisplayName ||
      item.metadata?.workflowCategoryDisplayName ||
      '',
  ).trim();

  if (direct) {
    return direct;
  }

  const categoryCode = getWorkflowCategoryCode(item);
  const matchedCategory = (Array.isArray(categories) ? categories : []).find(
    (category) => category.categoryCode === categoryCode,
  );

  return matchedCategory?.displayName || (categoryCode === DEFAULT_WORKFLOW_CATEGORY_CODE ? 'General' : categoryCode);
}

export function groupWorkflowsByCategory(items = []) {
  const groups = new Map();

  for (const item of Array.isArray(items) ? items : []) {
    if (!item) continue;

    const categoryCode = getWorkflowCategoryCode(item);
    const displayName = getWorkflowCategoryDisplayName(item);
    const displayOrder = Number(
      item.categoryDisplayOrder ?? item.workflowCategoryDisplayOrder ?? 999,
    );
    const current = groups.get(categoryCode) || {
      categoryCode,
      displayName,
      displayOrder: Number.isFinite(displayOrder) ? displayOrder : 999,
      items: [],
    };

    current.items.push(item);
    groups.set(categoryCode, current);
  }

  return [...groups.values()]
    .map((group) => ({
      ...group,
      items: [...group.items].sort((left, right) =>
        String(left.displayName || left.workflowCode || left.targetCode || '').localeCompare(
          String(right.displayName || right.workflowCode || right.targetCode || ''),
        )),
    }))
    .sort((left, right) => {
      const orderCompare = left.displayOrder - right.displayOrder;
      return orderCompare !== 0
        ? orderCompare
        : String(left.displayName || left.categoryCode).localeCompare(
            String(right.displayName || right.categoryCode),
          );
    });
}

