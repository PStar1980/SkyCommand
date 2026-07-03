const { query } = require('../../../../packages/db/src/connection');

const APP_CODE = process.env.SKYSERVER_CORE_APP_CODE || 'SKYSERVER_CORE';
const PROFILE_CODE =
  process.env.SKYSERVER_CONFIG_PROFILE ||
  process.env.SKYSERVER_CORE_PROFILE ||
  process.env.CONFIG_PROFILE ||
  'DEV_LOCAL';

function toBoolean(value) {
  return value === true || value === 'true' || value === 't' || value === 1 || value === '1';
}

function getPermissionCodeSet(permissionRows = []) {
  return new Set(
    permissionRows
      .map((permission) => permission.permissionCode || permission.permission_code)
      .filter(Boolean),
  );
}

function canAccessTool(row, permissionCodes) {
  if (!row.permission_code) {
    return true;
  }

  return permissionCodes.has(row.permission_code);
}

function sanitizeTool(row) {
  return {
    toolId: row.tool_id,
    toolCode: row.tool_code,
    name: row.name,
    label: row.label,
    description: row.description,
    permissionCode: row.permission_code,
    riskCode: row.risk_code,
    riskRank: row.risk_rank,
    requiresConfirmation: toBoolean(row.requires_confirmation),
    confirmationText: row.confirmation_text || null,
    capturesOutput: toBoolean(row.captures_output),
    allowParams: toBoolean(row.allow_params),
    displayOrder: row.display_order,
    enabled: toBoolean(row.enabled),
    parameters: [],
  };
}

function sanitizeCategory(row) {
  return {
    categoryId: row.category_id,
    categoryCode: row.category_code,
    label: row.category_label,
    description: row.category_description,
    displayOrder: row.category_display_order,
    tools: [],
  };
}

function sanitizeParameter(row, options = []) {
  return {
    parameterId: row.parameter_id,
    parameterName: row.parameter_name,
    label: row.label,
    paramTypeCode: row.param_type_code,
    prompt: row.prompt,
    required: toBoolean(row.required),
    defaultValue: row.default_value,
    optionSourceCode: row.option_source_code,
    displayOrder: row.display_order,
    enabled: toBoolean(row.enabled),
    options,
  };
}

function isRepositoryParameter(parameter) {
  return parameter.param_type_code === 'repo' || parameter.option_source_code === 'repositories';
}

function isSkyserverWorkflowParameter(parameter) {
  return parameter.option_source_code === 'skyserver_workflows';
}

function groupToolsByCategory(rows, toolsByCode = new Map()) {
  const categoriesByCode = new Map();

  for (const row of rows) {
    if (!categoriesByCode.has(row.category_code)) {
      categoriesByCode.set(row.category_code, sanitizeCategory(row));
    }

    const tool = toolsByCode.get(row.tool_code) || sanitizeTool(row);
    categoriesByCode.get(row.category_code).tools.push(tool);
  }

  const categories = [...categoriesByCode.values()];

  categories.sort((a, b) => {
    if (a.displayOrder !== b.displayOrder) {
      return a.displayOrder - b.displayOrder;
    }

    return a.label.localeCompare(b.label);
  });

  for (const category of categories) {
    category.tools.sort((a, b) => {
      if (a.displayOrder !== b.displayOrder) {
        return a.displayOrder - b.displayOrder;
      }

      return a.label.localeCompare(b.label);
    });
  }

  return categories;
}

async function getApplicationHeader() {
  const result = await query(
    `
      SELECT
        app_code,
        title,
        manifest_version,
        description
      FROM core.applications
      WHERE app_code = $1
        AND active = TRUE
      LIMIT 1
    `,
    [APP_CODE],
  );

  const app = result.rows[0];

  if (!app) {
    return {
      appCode: APP_CODE,
      title: 'SkyServer Core',
      manifestVersion: null,
      description: null,
    };
  }

  return {
    appCode: app.app_code,
    title: app.title,
    manifestVersion: app.manifest_version,
    description: app.description,
  };
}

async function getAdminWebToolRows() {
  const result = await query(
    `
      SELECT
        app_code,
        category_id,
        category_code,
        category_label,
        category_description,
        category_display_order,
        tool_id,
        tool_code,
        name,
        label,
        description,
        permission_code,
        risk_code,
        risk_rank,
        requires_confirmation,
        confirmation_text,
        captures_output,
        allow_params,
        display_order,
        enabled
      FROM core.vw_admin_web_tools
      WHERE app_code = $1
      ORDER BY category_display_order, display_order, label
    `,
    [APP_CODE],
  );

  return result.rows;
}

async function getAdminWebToolRow(toolCode) {
  const result = await query(
    `
      SELECT
        app_code,
        category_id,
        category_code,
        category_label,
        category_description,
        category_display_order,
        tool_id,
        tool_code,
        name,
        label,
        description,
        permission_code,
        risk_code,
        risk_rank,
        requires_confirmation,
        confirmation_text,
        captures_output,
        allow_params,
        display_order,
        enabled
      FROM core.vw_admin_web_tools
      WHERE app_code = $1
        AND tool_code = $2
      LIMIT 1
    `,
    [APP_CODE, toolCode],
  );

  return result.rows[0] || null;
}

async function getParametersForTools(toolCodes) {
  if (!Array.isArray(toolCodes) || toolCodes.length === 0) {
    return [];
  }

  const result = await query(
    `
      SELECT
        tool_id,
        tool_code,
        parameter_id,
        parameter_name,
        label,
        param_type_code,
        prompt,
        required,
        default_value,
        option_source_code,
        display_order,
        enabled
      FROM core.vw_tool_parameters
      WHERE tool_code = ANY($1::text[])
      ORDER BY tool_code, display_order, parameter_name
    `,
    [toolCodes],
  );

  return result.rows;
}

async function getStaticOptionsForTools(toolCodes) {
  if (!Array.isArray(toolCodes) || toolCodes.length === 0) {
    return [];
  }

  const result = await query(
    `
      SELECT
        tool_code,
        parameter_name,
        option_id,
        option_label,
        option_value,
        display_order,
        enabled
      FROM core.vw_tool_parameter_options
      WHERE tool_code = ANY($1::text[])
      ORDER BY tool_code, parameter_name, display_order, option_label
    `,
    [toolCodes],
  );

  return result.rows;
}

async function getSkyserverWorkflowOptions() {
  const result = await query(
    `
      SELECT workflow_code, display_name
      FROM worker.vw_workflow_definitions
      WHERE status = 'ACTIVE'
        AND enabled = TRUE
        AND visible_in_admin = TRUE
        AND published_version_id IS NOT NULL
      ORDER BY display_name, workflow_code
    `,
  );

  return result.rows.map((row) => ({
    label: `${row.display_name} (${row.workflow_code})`,
    value: row.workflow_code,
    displayOrder: 100,
  }));
}

async function getRepositoryOptions() {
  const result = await query(
    `
      SELECT
        repo_code,
        repo_name,
        display_order
      FROM core.vw_repository_paths
      WHERE profile_code = $1
      ORDER BY display_order, repo_name
    `,
    [PROFILE_CODE],
  );

  return result.rows.map((row) => ({
    label: row.repo_name || row.repo_code,
    value: row.repo_code,
    displayOrder: row.display_order,
  }));
}

function groupStaticOptions(optionRows) {
  const optionsByToolAndParam = new Map();

  for (const option of optionRows) {
    const key = `${option.tool_code}:${option.parameter_name}`;

    if (!optionsByToolAndParam.has(key)) {
      optionsByToolAndParam.set(key, []);
    }

    optionsByToolAndParam.get(key).push({
      optionId: option.option_id,
      label: option.option_label,
      value: option.option_value,
      displayOrder: option.display_order,
      enabled: toBoolean(option.enabled),
    });
  }

  return optionsByToolAndParam;
}

async function hydrateToolsParameters(tools) {
  if (!Array.isArray(tools) || tools.length === 0) {
    return [];
  }

  const toolCodes = [...new Set(tools.map((tool) => tool.toolCode).filter(Boolean))];

  const [parameterRows, staticOptionRows] = await Promise.all([
    getParametersForTools(toolCodes),
    getStaticOptionsForTools(toolCodes),
  ]);

  const staticOptionsByParam = groupStaticOptions(staticOptionRows);
  const parametersByToolCode = new Map(toolCodes.map((toolCode) => [toolCode, []]));

  let repositoryOptions = null;
  let skyserverWorkflowOptions = null;

  for (const parameter of parameterRows) {
    const key = `${parameter.tool_code}:${parameter.parameter_name}`;
    let options = staticOptionsByParam.get(key) || [];

    if (isRepositoryParameter(parameter)) {
      if (!repositoryOptions) {
        repositoryOptions = await getRepositoryOptions();
      }

      options = repositoryOptions;
    }

    if (isSkyserverWorkflowParameter(parameter)) {
      if (!skyserverWorkflowOptions) {
        skyserverWorkflowOptions = await getSkyserverWorkflowOptions();
      }

      options = skyserverWorkflowOptions;
    }

    if (!parametersByToolCode.has(parameter.tool_code)) {
      parametersByToolCode.set(parameter.tool_code, []);
    }

    parametersByToolCode.get(parameter.tool_code).push(sanitizeParameter(parameter, options));
  }

  return tools.map((tool) => ({
    ...tool,
    parameters: parametersByToolCode.get(tool.toolCode) || [],
  }));
}

async function hydrateToolParameters(tool) {
  const [hydratedTool] = await hydrateToolsParameters([tool]);

  return (
    hydratedTool || {
      ...tool,
      parameters: [],
    }
  );
}

async function listToolsForUser({ permissions = [] } = {}) {
  const [app, rows] = await Promise.all([getApplicationHeader(), getAdminWebToolRows()]);
  const permissionCodes = getPermissionCodeSet(permissions);

  const allowedRows = rows.filter((row) => canAccessTool(row, permissionCodes));
  const hydratedTools = await hydrateToolsParameters(allowedRows.map(sanitizeTool));
  const toolsByCode = new Map(hydratedTools.map((tool) => [tool.toolCode, tool]));

  return {
    app,
    channel: 'admin-web',
    profileCode: PROFILE_CODE,
    categories: groupToolsByCategory(allowedRows, toolsByCode),
  };
}

async function getToolForUser({ toolCode, permissions = [] } = {}) {
  const row = await getAdminWebToolRow(toolCode);

  if (!row) {
    return {
      found: false,
      allowed: false,
      tool: null,
      permissionCode: null,
    };
  }

  const permissionCodes = getPermissionCodeSet(permissions);
  const allowed = canAccessTool(row, permissionCodes);

  if (!allowed) {
    return {
      found: true,
      allowed: false,
      tool: null,
      permissionCode: row.permission_code,
    };
  }

  const tool = await hydrateToolParameters(sanitizeTool(row));

  return {
    found: true,
    allowed: true,
    tool: {
      category: sanitizeCategory(row),
      ...tool,
    },
    permissionCode: row.permission_code,
  };
}

module.exports = {
  listToolsForUser,
  getToolForUser,
};
