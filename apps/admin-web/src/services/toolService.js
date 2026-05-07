import api from './api';

function flattenCategories(categories = []) {
  return categories.flatMap((category) =>
    (category.tools || []).map((tool) => ({
      ...tool,
      category: {
        categoryId: category.categoryId,
        categoryCode: category.categoryCode,
        label: category.label,
        description: category.description,
        displayOrder: category.displayOrder,
      },
    })),
  );
}

async function listTools() {
  const result = await api.get('/api/tools');
  const categories = result.categories || [];
  const tools = flattenCategories(categories);

  return {
    ...result,
    categories,
    tools,
  };
}

async function getTool(toolCode) {
  return api.get(`/api/tools/${encodeURIComponent(toolCode)}`);
}

async function runTool(toolCode, parameters = {}) {
  return api.post(`/api/tools/${encodeURIComponent(toolCode)}/run`, {
    parameters,
  });
}

const toolService = {
  listTools,
  getTool,
  runTool,
};

export default toolService;
