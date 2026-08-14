const fs = require('fs');
const path = require('path');

const repoRoot = path.resolve(__dirname, '../../../..');
const mainSource = fs.readFileSync(path.join(repoRoot, 'apps/admin-web/src/main.jsx'), 'utf8');
const navbarSource = fs.readFileSync(
  path.join(repoRoot, 'apps/admin-web/src/components/Navbar.jsx'),
  'utf8',
);
const manageSource = fs.readFileSync(
  path.join(repoRoot, 'apps/admin-web/src/pages/ManageRepositories.jsx'),
  'utf8',
);
const addSource = fs.readFileSync(
  path.join(repoRoot, 'apps/admin-web/src/pages/AddRepository.jsx'),
  'utf8',
);
const utilsSource = fs.readFileSync(
  path.join(repoRoot, 'apps/admin-web/src/pages/repositoryAdminUtils.js'),
  'utf8',
);
const adminActionSource = fs.readFileSync(
  path.join(repoRoot, 'apps/api/src/services/adminActionService.js'),
  'utf8',
);

const checks = [
  [mainSource.includes('path="git-repositories/manage"'), 'Manage Repositories route is required.'],
  [mainSource.includes('path="git-repositories/add"'), 'Add Repository route is required.'],
  [
    mainSource.includes('path="configuration/repositories"') &&
      mainSource.includes('to="/git-repositories/manage"'),
    'Legacy repository route must redirect to Manage Repositories.',
  ],
  [navbarSource.includes("label: 'Git Repositories'"), 'Git Repositories navigation group is required.'],
  [navbarSource.includes("label: 'Manage Repositories'"), 'Manage Repositories navigation is required.'],
  [navbarSource.includes("label: 'Add Repository'"), 'Add Repository navigation is required.'],
  [
    utilsSource.includes('export const REPOSITORY_PAGE_SIZE = 10;'),
    'Repository catalogue page size must be 10.',
  ],
  [manageSource.includes('id="repositorySearch"'), 'Manage Repositories search is required.'],
  [manageSource.includes('id="repositoryStatusFilter"'), 'Repository status filter is required.'],
  [manageSource.includes('id="repositoryRoleFilter"'), 'Repository role filter is required.'],
  [manageSource.includes('Clear filters'), 'Manage Repositories clear filters action is required.'],
  [
    manageSource.includes('aria-label="Manage repositories pagination"'),
    'Manage Repositories pagination is required.',
  ],
  [
    manageSource.includes('<th className="text-end">Actions</th>') &&
      manageSource.includes('Repository Details') &&
      manageSource.includes('aria-label="Repository details"'),
    'Manage Repositories must expose row-level Repository Details actions and a details modal.',
  ],
  [
    !manageSource.includes('<h2 className="h5 mb-0">Repository detail</h2>') &&
      manageSource.includes('<h2 className="h5 mb-0">Repository configuration</h2>'),
    'Repository configuration must be the full-width workspace below the repository browser.',
  ],
  [
    !manageSource.includes('<h2 className="h5 mb-0">SkyCommand repository readiness</h2>'),
    'Manage Repositories must not render the SkyCommand repository readiness card.',
  ],
  [
    !manageSource.includes('Refresh repositories') &&
      manageSource.includes("? 'Refreshing...' : 'Refresh'"),
    'Manage Repositories refresh action must use the concise Refresh label.',
  ],
  [
    addSource.includes('<h1 className="sky-page-title">Add Repository</h1>') &&
      addSource.includes('adminService.createRepository(payload)'),
    'Add Repository must expose a dedicated creation surface.',
  ],
  [
    adminActionSource.includes("normalizeBoolean(filters.skycommand, 'skycommand')") &&
      adminActionSource.includes('is_skycommand_repository ='),
    'Repository role filtering must be enforced by the API query.',
  ],
];

const failures = checks.filter(([passed]) => !passed).map(([, message]) => message);

if (failures.length > 0) {
  console.error('[SkyCommand] Repository page split self-test failed:');
  failures.forEach((failure) => console.error(`- ${failure}`));
  process.exit(1);
}

console.log('[SkyCommand] Repository manage/add page split self-test passed.');
