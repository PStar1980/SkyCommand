const APPROVAL_ACTION_OPTIONS = [
  { value: 'STOP_SUCCESS', label: 'Stop workflow successfully' },
  { value: 'FAIL_WORKFLOW', label: 'Fail workflow' },
  { value: 'CONTINUE', label: 'Continue anyway' },
];

const TIMEOUT_UNIT_OPTIONS = [
  { value: 'MINUTES', label: 'Minutes' },
  { value: 'HOURS', label: 'Hours' },
  { value: 'DAYS', label: 'Days' },
];

export const DEFAULT_HUMAN_APPROVAL_PARAMETERS = {
  approvalTitle: 'Approval required',
  instructions: 'Review the workflow run before allowing the next node to continue.',
  approvalKey: '',
  requiredRoleCode: 'SUPER_ADMIN',
  onReject: 'STOP_SUCCESS',
  timeoutDuration: '24',
  timeoutUnit: 'HOURS',
  onTimeout: 'FAIL_WORKFLOW',
};

function normalizeRoleCode(value) {
  return String(value || '')
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9_]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

function getApprovalActionLabel(value) {
  return APPROVAL_ACTION_OPTIONS.find((option) => option.value === value)?.label || value || 'Stop workflow successfully';
}

function compactObject(value = {}) {
  return Object.fromEntries(
    Object.entries(value).filter(([, item]) => item !== undefined && item !== null && item !== ''),
  );
}

export function cleanHumanApprovalParameterValues(values = {}, roleOptions = []) {
  const parameters = {
    ...DEFAULT_HUMAN_APPROVAL_PARAMETERS,
    ...(values || {}),
  };
  const title = String(parameters.approvalTitle || parameters.title || '').trim();
  const instructions = String(parameters.instructions || parameters.prompt || '').trim();
  const approvalKey = String(parameters.approvalKey || '').trim();
  const requiredRoleCode = normalizeRoleCode(parameters.requiredRoleCode || parameters.requiredRole);
  const timeoutDuration = String(parameters.timeoutDuration || '').trim();
  const availableRoleCodes = new Set((roleOptions || []).map((role) => normalizeRoleCode(role.roleCode)).filter(Boolean));

  if (!title) {
    throw new Error('Human approval nodes require an approval title.');
  }

  if (requiredRoleCode && availableRoleCodes.size > 0 && !availableRoleCodes.has(requiredRoleCode)) {
    throw new Error(`Human approval role ${requiredRoleCode} is not active in SkyServer Admin.`);
  }

  const output = {
    approvalTitle: title,
    instructions,
    approvalKey,
    requiredRoleCode,
    onReject: parameters.onReject || 'STOP_SUCCESS',
    onTimeout: parameters.onTimeout || 'FAIL_WORKFLOW',
  };

  if (timeoutDuration) {
    const parsed = Number(timeoutDuration);

    if (!Number.isFinite(parsed) || parsed <= 0) {
      throw new Error('Human approval timeout duration must be a positive number or blank.');
    }

    output.timeoutDuration = timeoutDuration;
    output.timeoutUnit = parameters.timeoutUnit || 'HOURS';
  }

  return compactObject(output);
}

export function getHumanApprovalSummary(parameters = {}) {
  const values = {
    ...DEFAULT_HUMAN_APPROVAL_PARAMETERS,
    ...(parameters || {}),
  };
  const title = values.approvalTitle || values.title || 'Approval required';
  const timeoutDuration = String(values.timeoutDuration || '').trim();
  const timeoutText = timeoutDuration
    ? ` · timeout ${timeoutDuration} ${String(values.timeoutUnit || 'HOURS').toLowerCase()}`
    : ' · no timeout';

  return `${title}${timeoutText} · reject: ${getApprovalActionLabel(values.onReject)}`;
}

function HumanApprovalParameterEditor({ idPrefix, parameters = {}, onChange, roleOptions = [] }) {
  const values = {
    ...DEFAULT_HUMAN_APPROVAL_PARAMETERS,
    ...(parameters || {}),
  };
  const sortedRoleOptions = [...(roleOptions || [])].sort((a, b) => String(a.roleCode || '').localeCompare(String(b.roleCode || '')));
  const selectedRoleCode = normalizeRoleCode(values.requiredRoleCode || values.requiredRole);
  const selectedRoleExists = !selectedRoleCode || sortedRoleOptions.some((role) => normalizeRoleCode(role.roleCode) === selectedRoleCode);

  function patch(changes) {
    onChange({ ...values, ...changes });
  }

  return (
    <div className="row g-3">
      <div className="col-lg-8">
        <label className="form-label" htmlFor={`${idPrefix}-title`}>Approval title</label>
        <input
          className="form-control sky-form-control"
          id={`${idPrefix}-title`}
          onChange={(event) => patch({ approvalTitle: event.target.value })}
          placeholder="Review generated repo artifacts"
          value={values.approvalTitle || ''}
        />
      </div>
      <div className="col-lg-4">
        <label className="form-label" htmlFor={`${idPrefix}-approvalKey`}>Approval key</label>
        <input
          className="form-control sky-form-control sky-mono"
          id={`${idPrefix}-approvalKey`}
          onChange={(event) => patch({ approvalKey: event.target.value })}
          placeholder="Optional stable key"
          value={values.approvalKey || ''}
        />
        <div className="form-text">Blank uses the node key.</div>
      </div>
      <div className="col-12">
        <label className="form-label" htmlFor={`${idPrefix}-instructions`}>Instructions / prompt</label>
        <textarea
          className="form-control sky-form-control"
          id={`${idPrefix}-instructions`}
          onChange={(event) => patch({ instructions: event.target.value })}
          placeholder="Explain what the approver should inspect before approving."
          rows={3}
          value={values.instructions || ''}
        />
      </div>
      <div className="col-lg-4">
        <label className="form-label" htmlFor={`${idPrefix}-role`}>Required role</label>
        {sortedRoleOptions.length > 0 ? (
          <select
            className="form-select sky-form-control sky-mono"
            id={`${idPrefix}-role`}
            onChange={(event) => patch({ requiredRoleCode: event.target.value })}
            value={selectedRoleCode}
          >
            <option value="">No role gate</option>
            {!selectedRoleExists ? (
              <option value={selectedRoleCode}>{selectedRoleCode} · inactive or missing</option>
            ) : null}
            {sortedRoleOptions.map((role) => (
              <option key={role.roleCode} value={role.roleCode}>
                {role.roleCode} · {role.roleName || role.displayName || role.roleCode}
              </option>
            ))}
          </select>
        ) : (
          <input
            className="form-control sky-form-control sky-mono"
            id={`${idPrefix}-role`}
            onChange={(event) => patch({ requiredRoleCode: normalizeRoleCode(event.target.value) })}
            placeholder="SUPER_ADMIN"
            value={selectedRoleCode}
          />
        )}
        <div className="form-text">Optional role gate checked against active SkyServer Admin roles.</div>
        {!selectedRoleExists ? (
          <div className="form-text text-warning">
            Configured role is not currently active in the role catalog. Pick an active role before saving.
          </div>
        ) : null}
      </div>
      <div className="col-lg-4">
        <label className="form-label" htmlFor={`${idPrefix}-reject`}>When rejected</label>
        <select
          className="form-select sky-form-control"
          id={`${idPrefix}-reject`}
          onChange={(event) => patch({ onReject: event.target.value })}
          value={values.onReject || 'STOP_SUCCESS'}
        >
          {APPROVAL_ACTION_OPTIONS.map((option) => (
            <option key={option.value} value={option.value}>{option.label}</option>
          ))}
        </select>
      </div>
      <div className="col-lg-4">
        <label className="form-label" htmlFor={`${idPrefix}-timeoutAction`}>When timed out</label>
        <select
          className="form-select sky-form-control"
          id={`${idPrefix}-timeoutAction`}
          onChange={(event) => patch({ onTimeout: event.target.value })}
          value={values.onTimeout || 'FAIL_WORKFLOW'}
        >
          {APPROVAL_ACTION_OPTIONS.map((option) => (
            <option key={option.value} value={option.value}>{option.label}</option>
          ))}
        </select>
      </div>
      <div className="col-lg-4">
        <label className="form-label" htmlFor={`${idPrefix}-timeoutDuration`}>Timeout duration</label>
        <input
          className="form-control sky-form-control sky-mono"
          id={`${idPrefix}-timeoutDuration`}
          onChange={(event) => patch({ timeoutDuration: event.target.value })}
          placeholder="Blank for no timeout"
          type="number"
          value={values.timeoutDuration || ''}
        />
      </div>
      <div className="col-lg-4">
        <label className="form-label" htmlFor={`${idPrefix}-timeoutUnit`}>Timeout unit</label>
        <select
          className="form-select sky-form-control"
          id={`${idPrefix}-timeoutUnit`}
          onChange={(event) => patch({ timeoutUnit: event.target.value })}
          value={values.timeoutUnit || 'HOURS'}
        >
          {TIMEOUT_UNIT_OPTIONS.map((option) => (
            <option key={option.value} value={option.value}>{option.label}</option>
          ))}
        </select>
      </div>
      <div className="col-lg-4 d-flex align-items-end">
        <div className="form-text sky-muted">
          Temporal-backed workflows wait durably for an approve/reject signal. The API request is not blocked.
        </div>
      </div>
      <div className="form-text sky-muted">
        Pending requests appear under Workflows → Approvals and can be approved or rejected by authorized users.
      </div>
    </div>
  );
}

export default HumanApprovalParameterEditor;
