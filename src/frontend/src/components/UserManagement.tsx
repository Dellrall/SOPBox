
import { useState } from 'react';
import { DEFAULT_STAFF_PERMISSIONS } from '../types';
import type { Page, StaffAccount } from '../types';

type Props = {
  accounts: StaffAccount[];
  onCreate: (username: string, password: string) => string;
  onUpdate: (account: StaffAccount) => void;
  onRemove: (id: string) => void;
};

const modules: { key: Page; label: string }[] = [
  { key: 'dashboard', label: 'Dashboard' },
  { key: 'receiving', label: 'Receiving Check' },
  { key: 'records', label: 'Delivery Records' },
  { key: 'products', label: 'Products & SOP' },
  { key: 'approvals', label: 'Approvals' },
  { key: 'activity', label: 'Activity Logs' },
];

export function UserManagement({
  accounts,
  onCreate,
  onUpdate,
  onRemove,
}: Props) {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [message, setMessage] = useState('');
  const [editing, setEditing] = useState<StaffAccount | null>(null);

  const loginLink = window.location.origin + window.location.pathname;

  function createStaff() {
    const result = onCreate(username.trim(), password);
    setMessage(result);

    if (result === 'Staff account created successfully.') {
      setUsername('');
      setPassword('');
    }
  }

  function togglePermission(page: Page) {
    if (!editing) return;

    const permissions = editing.permissions.includes(page)
      ? editing.permissions.filter(p => p !== page)
      : [...editing.permissions, page];

    setEditing({ ...editing, permissions });
  }

  async function copyLoginLink() {
    try {
      await navigator.clipboard.writeText(loginLink);
      setMessage('Login link copied!');
    } catch {
      setMessage('Unable to copy. Please copy the URL from your browser.');
    }
  }

  return (
    <>
      <div className="page-heading">
        <div>
          <h1>User Management</h1>
          <p>Create staff accounts and manage module permissions.</p>
        </div>
      </div>

      <div className="notice warn">
        Frontend demo only. Accounts are stored in browser memory.
        A shared backend is required for real staff login and access control.
      </div>

      <section className="panel form-panel">
        <div className="panel-head">
          <div>
            <h2>Create Staff Account</h2>
            <p>Register a new staff member.</p>
          </div>
        </div>

        <div className="form-grid user-form">

        <div className="form-field">
            <label htmlFor="staff-username">
            Username
            </label>

            <input
            id="staff-username"
            type="text"
            className="form-input"
            placeholder="e.g. kitchen01"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            />
        </div>

        <div className="form-field">
            <label htmlFor="staff-password">
            Temporary Password
            </label>

            <input
            id="staff-password"
            type="password"
            className="form-input"
            placeholder="Minimum 8 characters"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            />
        </div>

        </div>

        {message && (
          <div className="notice info" role="status">
            {message}
          </div>
        )}

        <div className="panel-footer">
          <button className="outline-btn" onClick={copyLoginLink}>
            Copy Login Link
          </button>

          <button className="primary-btn" onClick={createStaff}>
            Create Staff Account
          </button>
        </div>
      </section>

      <section className="panel">
        <div className="panel-head">
          <h2>Staff Accounts</h2>
        </div>

        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Username</th>
                <th>Role</th>
                <th>Status</th>
                <th>Module Access</th>
                <th>Actions</th>
              </tr>
            </thead>

            <tbody>
              {accounts.map(account => (
                <tr key={account.id}>
                  <td>{account.username}</td>

                  <td>
                    {account.role === 'admin' ? 'Admin' : 'Staff'}
                  </td>

                  <td>{account.active ? 'Active' : 'Inactive'}</td>

                  <td>
                    {account.role === 'admin'
                      ? 'All Modules'
                      : account.permissions.length + ' Modules'}
                  </td>

                  <td>
                    {account.role === 'admin' ? (
                      <span>Protected</span>
                    ) : (
                      <div style={{
                        display: 'flex',
                        gap: 8,
                        flexWrap: 'wrap',
                      }}>
                        <button
                          className="outline-btn"
                          onClick={() => setEditing({
                            ...account,
                            permissions: [...account.permissions],
                          })}
                        >
                          Edit
                        </button>

                        <button
                          className="outline-btn"
                          onClick={() => onUpdate({
                            ...account,
                            active: !account.active,
                          })}
                        >
                          {account.active ? 'Deactivate' : 'Reactivate'}
                        </button>

                        <button
                          className="danger-btn"
                          onClick={() => {
                            if (window.confirm(
                              `Remove ${account.username}?`
                            )) {
                              onRemove(account.id);
                            }
                          }}
                        >
                          Remove
                        </button>
                      </div>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {editing && (
        <div
          className="modal-backdrop"
          onClick={() => setEditing(null)}
        >
          <div
            className="modal"
            onClick={e => e.stopPropagation()}
          >
            <div className="modal-title">
              <h2>Edit Staff Access</h2>

              <button
                className="icon-button"
                onClick={() => setEditing(null)}
              >
                ✕
              </button>
            </div>

            <div className="modal-body">
              <label>
                Username
                <input
                  value={editing.username}
                  onChange={e => setEditing({
                    ...editing,
                    username: e.target.value,
                  })}
                />
              </label>

              <h3>Module Permissions</h3>

              {modules.map(module => (
                <label
                  key={module.key}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 12,
                    marginBottom: 12,
                  }}
                >
                  <input
                    type="checkbox"
                    checked={editing.permissions.includes(module.key)}
                    onChange={() => togglePermission(module.key)}
                  />

                  {module.label}
                </label>
              ))}

              <button
                className="outline-btn"
                onClick={() => setEditing({
                  ...editing,
                  permissions: [...DEFAULT_STAFF_PERMISSIONS],
                })}
              >
                Reset to Default
              </button>
            </div>

            <div className="modal-actions">
              <button
                className="outline-btn"
                onClick={() => setEditing(null)}
              >
                Cancel
              </button>

              <button
                className="primary-btn"
                onClick={() => {
                  onUpdate(editing);
                  setEditing(null);
                }}
              >
                Save Changes
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
