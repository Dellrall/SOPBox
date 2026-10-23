import type { Page, Role } from '../types';

const icons: Record<Page, string> = {
  dashboard: '▦', receiving: '▣', records: '▤', products: '▧',
  approvals: '✓', activity: '◷', users: '♙',
};

type NavItem = { key: Page; label: string; admin?: boolean };

type Props = {
  role: Role; 
  username: string; 
  page: Page; 
  pending: number; 
  navItems: NavItem[];
  onNavigate: (page: Page) => void; 
  onCollapse: () => void; 
  onLogout: () => void;
  collapsed: boolean;
  mobileOpen: boolean;
  onCloseMobile: () => void;
};

export function Sidebar({
  role,
  username,
  page,
  pending,
  navItems,
  collapsed,
  mobileOpen,
  onCloseMobile,
  onNavigate,
  onCollapse,
  onLogout,
}: Props) {
  return (
    <aside
      className={[
        'sidebar',
        collapsed ? 'collapsed' : '',
        mobileOpen ? 'mobile-open' : '',
      ].filter(Boolean).join(' ')}
    >

    <div className="brand-row">
      <div className="brand"><img src="/SOPBox_Logo.jpeg" alt="SOPBox Logo" className="brand-logo"/><span className="brand-name">SOPBox</span></div>
      <button
        type="button"
        className="sidebar-toggle"
        title={mobileOpen ? 'Close menu' : collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
        aria-label={mobileOpen ? 'Close menu' : collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
        onClick={mobileOpen ? onCloseMobile : onCollapse}>
        {mobileOpen ? '✕' : collapsed ? '☰' : '◧'}
      </button>
    </div>

    <div className="org-select"><span className="org-icon">▦</span><span><small>Current organization</small><strong>SDC_Committee_Demo_2</strong></span><span className="chevron">⌄</span></div>
    <div className="nav-caption">Navigation</div>
    <nav className="nav-list" aria-label="Main navigation">

      {navItems
        .filter(item => role === 'admin' || !item.admin)
        .map(item => (

          <button
            key={item.key}
            type="button"
            className={`nav-link ${page === item.key ? 'active' : ''}`}
            aria-current={page === item.key ? 'page' : undefined}
            aria-label={item.label}
            title={collapsed && !mobileOpen ? item.label : undefined}
            onClick={() => {
              onNavigate(item.key);

              if (mobileOpen) {
                onCloseMobile();
              }
            }}
          >

            {/* Navigation Icon */}
            <span className="nav-icon">
              {icons[item.key]}
            </span>

            {/* Navigation Label */}
            {(!collapsed || mobileOpen) && (
              <span className="nav-label">
                {item.label}
              </span>
            )}

            {/* Pending Approval Count */}
            {item.key === 'approvals' &&
              pending > 0 &&
              (!collapsed || mobileOpen) && (
                <span className="nav-count">
                  {pending}
                </span>
              )}

          </button>

        ))}

    </nav>
    <div className="sidebar-bottom">
      <div className="avatar">{role === 'admin' ? 'AD' : 'ST'}</div>
      <div className="sidebar-profile"><strong>{username}</strong><small>{role === 'admin' ? 'SOPBox Admin' : 'SOPBox Staff'}</small></div>
      <button className="sidebar-logout" title="Log out" aria-label="Log out" onClick={onLogout}>↪</button>
    </div>
  </aside>);
}
