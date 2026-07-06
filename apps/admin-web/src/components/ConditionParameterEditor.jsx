const DEFAULT_CONDITION_PARAMETERS = {
  leftPath: 'input.condition',
  leftValue: '',
  leftType: 'AUTO',
  operator: 'TRUTHY',
  rightValue: '',
  rightType: 'AUTO',
  caseSensitive: false,
  onFalse: 'STOP_SUCCESS',
};

const CONDITION_OPERATORS = [
  { value: 'TRUTHY', label: 'is truthy', unary: true },
  { value: 'FALSY', label: 'is falsy', unary: true },
  { value: 'EXISTS', label: 'exists', unary: true },
  { value: 'NOT_EXISTS', label: 'does not exist', unary: true },
  { value: 'EQUALS', label: 'equals' },
  { value: 'NOT_EQUALS', label: 'does not equal' },
  { value: 'CONTAINS', label: 'contains' },
  { value: 'NOT_CONTAINS', label: 'does not contain' },
  { value: 'GREATER_THAN', label: 'is greater than' },
  { value: 'GREATER_OR_EQUAL', label: 'is greater than or equal to' },
  { value: 'LESS_THAN', label: 'is less than' },
  { value: 'LESS_OR_EQUAL', label: 'is less than or equal to' },
];

const CONDITION_VALUE_TYPES = [
  { value: 'AUTO', label: 'Auto' },
  { value: 'STRING', label: 'String' },
  { value: 'NUMBER', label: 'Number' },
  { value: 'BOOLEAN', label: 'Boolean' },
  { value: 'JSON', label: 'JSON' },
];

const CONDITION_FALSE_ACTIONS = [
  { value: 'STOP_SUCCESS', label: 'Stop workflow successfully' },
  { value: 'FAIL_WORKFLOW', label: 'Fail workflow' },
  { value: 'CONTINUE', label: 'Continue anyway' },
];

function isUnaryOperator(operator) {
  return CONDITION_OPERATORS.some((item) => item.value === operator && item.unary);
}

function normalizeConditionParameters(parameters = {}) {
  return {
    ...DEFAULT_CONDITION_PARAMETERS,
    ...(parameters || {}),
    operator: String(parameters.operator || DEFAULT_CONDITION_PARAMETERS.operator).toUpperCase(),
    onFalse: String(parameters.onFalse || DEFAULT_CONDITION_PARAMETERS.onFalse).toUpperCase(),
    leftType: String(parameters.leftType || DEFAULT_CONDITION_PARAMETERS.leftType).toUpperCase(),
    rightType: String(parameters.rightType || DEFAULT_CONDITION_PARAMETERS.rightType).toUpperCase(),
    caseSensitive: parameters.caseSensitive === true || parameters.caseSensitive === 'true' || parameters.caseSensitive === '1',
  };
}

function cleanConditionParameterValues(values = {}) {
  const parameters = normalizeConditionParameters(values);
  const leftPath = String(parameters.leftPath || '').trim();
  const leftValue = String(parameters.leftValue ?? '').trim();
  const operator = CONDITION_OPERATORS.some((item) => item.value === parameters.operator)
    ? parameters.operator
    : DEFAULT_CONDITION_PARAMETERS.operator;
  const onFalse = CONDITION_FALSE_ACTIONS.some((item) => item.value === parameters.onFalse)
    ? parameters.onFalse
    : DEFAULT_CONDITION_PARAMETERS.onFalse;
  const leftType = CONDITION_VALUE_TYPES.some((item) => item.value === parameters.leftType)
    ? parameters.leftType
    : DEFAULT_CONDITION_PARAMETERS.leftType;
  const rightType = CONDITION_VALUE_TYPES.some((item) => item.value === parameters.rightType)
    ? parameters.rightType
    : DEFAULT_CONDITION_PARAMETERS.rightType;
  const rightValue = String(parameters.rightValue ?? '').trim();

  if (!leftPath && !leftValue) {
    throw new Error('Condition nodes require a left path or left literal/fallback value.');
  }

  if (!isUnaryOperator(operator) && !rightValue) {
    throw new Error('This condition operator requires a comparison value.');
  }

  return Object.fromEntries(
    Object.entries({
      leftPath,
      leftValue,
      leftType,
      operator,
      rightValue,
      rightType,
      caseSensitive: Boolean(parameters.caseSensitive),
      onFalse,
    }).filter(([, value]) => value !== undefined && value !== null && value !== ''),
  );
}

function getConditionExpressionSummary(parameters = {}) {
  const values = normalizeConditionParameters(parameters);
  const operator = CONDITION_OPERATORS.find((item) => item.value === values.operator);
  const left = values.leftPath || values.leftValue || 'condition source';

  if (operator?.unary) {
    return `${left} ${operator.label}`;
  }

  return `${left} ${operator?.label || 'compares to'} ${values.rightValue || 'value'}`;
}

function ConditionParameterEditor({ idPrefix = 'condition-parameter', parameters = {}, onChange }) {
  const values = normalizeConditionParameters(parameters);
  const unaryOperator = isUnaryOperator(values.operator);

  function patch(changes) {
    const nextValues = normalizeConditionParameters({ ...values, ...changes });

    if (isUnaryOperator(nextValues.operator)) {
      nextValues.rightValue = '';
      nextValues.rightType = 'AUTO';
    }

    onChange(nextValues);
  }

  return (
    <div className="row g-3">
      <div className="col-lg-8">
        <label className="form-label" htmlFor={`${idPrefix}-leftPath`}>Left path</label>
        <input
          className="form-control sky-form-control sky-mono"
          id={`${idPrefix}-leftPath`}
          onChange={(event) => patch({ leftPath: event.target.value })}
          placeholder="input.condition or nodes.fred_ingestion.status"
          value={values.leftPath || ''}
        />
        <div className="form-text sky-muted">
          Use dot paths from the workflow context: input.*, nodes.&lt;node_key&gt;.*, or previous.*.
        </div>
      </div>
      <div className="col-lg-4">
        <label className="form-label" htmlFor={`${idPrefix}-leftType`}>Left fallback type</label>
        <select
          className="form-select sky-form-control"
          id={`${idPrefix}-leftType`}
          onChange={(event) => patch({ leftType: event.target.value })}
          value={values.leftType || 'AUTO'}
        >
          {CONDITION_VALUE_TYPES.map((type) => <option key={type.value} value={type.value}>{type.label}</option>)}
        </select>
      </div>
      <div className="col-12">
        <label className="form-label" htmlFor={`${idPrefix}-leftValue`}>Left literal / fallback value</label>
        <input
          className="form-control sky-form-control sky-mono"
          id={`${idPrefix}-leftValue`}
          onChange={(event) => patch({ leftValue: event.target.value })}
          placeholder="Optional; used when no left path is set or the path is missing"
          value={values.leftValue ?? ''}
        />
      </div>
      <div className="col-lg-5">
        <label className="form-label" htmlFor={`${idPrefix}-operator`}>Operator</label>
        <select
          className="form-select sky-form-control"
          id={`${idPrefix}-operator`}
          onChange={(event) => patch({ operator: event.target.value })}
          value={values.operator || 'TRUTHY'}
        >
          {CONDITION_OPERATORS.map((operator) => <option key={operator.value} value={operator.value}>{operator.label}</option>)}
        </select>
      </div>
      <div className="col-lg-5">
        <label className="form-label" htmlFor={`${idPrefix}-rightValue`}>Comparison value</label>
        <input
          className="form-control sky-form-control sky-mono"
          disabled={unaryOperator}
          id={`${idPrefix}-rightValue`}
          onChange={(event) => patch({ rightValue: event.target.value })}
          placeholder={unaryOperator ? 'Not used for this operator' : 'Value to compare against'}
          value={values.rightValue ?? ''}
        />
      </div>
      <div className="col-lg-2">
        <label className="form-label" htmlFor={`${idPrefix}-rightType`}>Type</label>
        <select
          className="form-select sky-form-control"
          disabled={unaryOperator}
          id={`${idPrefix}-rightType`}
          onChange={(event) => patch({ rightType: event.target.value })}
          value={values.rightType || 'AUTO'}
        >
          {CONDITION_VALUE_TYPES.map((type) => <option key={type.value} value={type.value}>{type.label}</option>)}
        </select>
      </div>
      <div className="col-lg-6">
        <label className="form-label" htmlFor={`${idPrefix}-onFalse`}>When false</label>
        <select
          className="form-select sky-form-control"
          id={`${idPrefix}-onFalse`}
          onChange={(event) => patch({ onFalse: event.target.value })}
          value={values.onFalse || 'STOP_SUCCESS'}
        >
          {CONDITION_FALSE_ACTIONS.map((action) => <option key={action.value} value={action.value}>{action.label}</option>)}
        </select>
      </div>
      <div className="col-lg-6 d-flex align-items-end">
        <div className="form-check form-switch mb-2">
          <input
            checked={Boolean(values.caseSensitive)}
            className="form-check-input"
            id={`${idPrefix}-caseSensitive`}
            onChange={(event) => patch({ caseSensitive: event.target.checked })}
            type="checkbox"
          />
          <label className="form-check-label" htmlFor={`${idPrefix}-caseSensitive`}>Case-sensitive string comparison</label>
        </div>
      </div>
      <div className="col-12">
        <div className="sky-empty-state text-start py-3">
          <span className="fw-semibold">Preview:</span> {getConditionExpressionSummary(values)}. If false: {CONDITION_FALSE_ACTIONS.find((action) => action.value === values.onFalse)?.label || values.onFalse}.
        </div>
      </div>
    </div>
  );
}

export {
  cleanConditionParameterValues,
  DEFAULT_CONDITION_PARAMETERS,
  getConditionExpressionSummary,
};

export default ConditionParameterEditor;
