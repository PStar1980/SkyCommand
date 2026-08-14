import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import RepositoryForm from '../components/RepositoryForm.jsx';
import { useAuth } from '../context/AuthContext.jsx';
import adminService from '../services/adminService';
import { createRepositoryForm, sanitizeRepositoryPayload } from './repositoryAdminUtils.js';

function AddRepository() {
  const { hasPermission } = useAuth();
  const canRead = hasPermission('ADMIN_REPOSITORY_READ');
  const canWrite = hasPermission('ADMIN_REPOSITORY_WRITE');
  const navigate = useNavigate();

  const [profiles, setProfiles] = useState([]);
  const [form, setForm] = useState(createRepositoryForm());
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  useEffect(() => {
    let active = true;

    async function loadProfiles() {
      setLoading(true);
      setError('');

      try {
        const result = await adminService.listConfigProfiles();
        if (!active) {
          return;
        }

        const nextProfiles = result.items || [];
        setProfiles(nextProfiles);
        setForm(createRepositoryForm(nextProfiles));
      } catch (loadError) {
        if (active) {
          setError(loadError.message || 'Failed to load repository configuration profiles.');
        }
      } finally {
        if (active) {
          setLoading(false);
        }
      }
    }

    loadProfiles();

    return () => {
      active = false;
    };
  }, []);

  function updateForm(key, value) {
    setForm((current) => ({ ...current, [key]: value }));
  }

  function updatePathForm(profileId, key, value) {
    setForm((current) => ({
      ...current,
      paths: current.paths.map((path) =>
        path.profileId === profileId ? { ...path, [key]: value } : path,
      ),
    }));
  }

  function resetForm() {
    setForm(createRepositoryForm(profiles));
    setError('');
    setSuccess('');
  }

  async function handleSubmit(event) {
    event.preventDefault();

    if (!canWrite) {
      return;
    }

    setSaving(true);
    setError('');
    setSuccess('');

    try {
      const payload = sanitizeRepositoryPayload(form);
      const result = await adminService.createRepository(payload);
      const createdRepository = result.repository;

      setSuccess(
        `Created repository ${createdRepository?.repoCode || payload.repoCode}. You can now manage its lifecycle and SkyCommand designation from Manage Repositories.`,
      );
      setForm(createRepositoryForm(profiles));
    } catch (saveError) {
      setError(saveError.message || 'Failed to create repository.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <>
      <header className="sky-page-header">
        <div>
          <div className="sky-page-kicker">Git Repositories · Create</div>
          <h1 className="sky-page-title">Add Repository</h1>
          <p className="sky-page-subtitle">
            Register repository identity, Git branch conventions, generated-artifact settings,
            optional remote metadata, and profile-specific local paths in one dedicated creation
            workspace.
          </p>
        </div>

        {canRead && (
          <button
            className="btn sky-btn-ghost"
            onClick={() => navigate('/git-repositories/manage')}
            type="button"
          >
            Manage repositories
          </button>
        )}
      </header>

      {error && <div className="alert alert-danger">{error}</div>}
      {success && <div className="alert alert-success">{success}</div>}

      <section className="sky-card">
        <div className="sky-card-header">
          <div>
            <div className="sky-page-kicker">Repository registration</div>
            <h2 className="h5 mb-0">New repository configuration</h2>
            <p className="sky-muted small mb-0">
              Repository code and name are required. Map/zip artifact settings and Remote URL are
              optional; local roots are stored independently for each SkyCommand configuration profile.
            </p>
          </div>
        </div>

        {loading ? (
          <div className="sky-empty-state py-5">
            <div className="spinner-border text-info" role="status" aria-label="Loading" />
          </div>
        ) : (
          <RepositoryForm
            canWrite={canWrite}
            form={form}
            idPrefix="add-repository"
            onFormChange={updateForm}
            onPathChange={updatePathForm}
            onReset={resetForm}
            onSubmit={handleSubmit}
            saving={saving}
            submitLabel="Add repository"
          />
        )}
      </section>
    </>
  );
}

export default AddRepository;
