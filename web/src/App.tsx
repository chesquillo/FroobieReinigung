import { Navigate, NavLink, Outlet, Route, Routes, useLocation } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { LangSwitcher, Loading, useAuth } from './components';
import { LoginPage, RegisterPage } from './pages/Auth';
import { HomePage, MachinePage, MyRecordsPage, ProfilePage, RecordPage, ScanPage } from './pages/Worker';
import { AdminLayout, DashboardPage, IncidentsPage, MachineAdminPage, MachinesAdminPage, MaintenancePage, ReportsPage, UsersPage } from './pages/Admin';

function RequireAuth({ admin = false }: { admin?: boolean }) {
  const { user, loading } = useAuth();
  const loc = useLocation();
  if (loading) return <Loading />;
  if (!user) return <Navigate to={`/login?next=${encodeURIComponent(loc.pathname)}`} replace />;
  if (admin && user.role !== 'ADMIN') return <Navigate to="/" replace />;
  return <Outlet />;
}

function Shell() {
  const { t } = useTranslation();
  const { user } = useAuth();
  const isAdmin = user?.role === 'ADMIN';
  return (
    <>
      <header className="topbar">
        <img src="/logo.jpg" alt="Froobie" className="logo" />
        <span className="brand">{t('appTagline')}</span>
        <span className="spacer" />
        <LangSwitcher />
      </header>
      <main className="container">
        <Outlet />
      </main>
      <nav className="bottomnav">
        <NavLink to="/" end>
          <span className="ico">🧽</span>
          {t('today')}
        </NavLink>
        <NavLink to="/my">
          <span className="ico">📋</span>
          {t('myCleanings')}
        </NavLink>
        {isAdmin && (
          <NavLink to="/admin">
            <span className="ico">📊</span>
            {t('admin')}
          </NavLink>
        )}
        <NavLink to="/profile">
          <span className="ico">👤</span>
          {t('profile')}
        </NavLink>
      </nav>
    </>
  );
}

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route path="/register" element={<RegisterPage />} />
      <Route element={<RequireAuth />}>
        <Route path="/m/:token" element={<ScanPage />} />
        <Route element={<Shell />}>
          <Route path="/" element={<HomePage />} />
          <Route path="/machine/:id" element={<MachinePage />} />
          <Route path="/my" element={<MyRecordsPage />} />
          <Route path="/record/:id" element={<RecordPage />} />
          <Route path="/profile" element={<ProfilePage />} />
          <Route element={<RequireAuth admin />}>
            <Route path="/admin" element={<AdminLayout />}>
              <Route index element={<DashboardPage />} />
              <Route path="machines" element={<MachinesAdminPage />} />
              <Route path="machines/:id" element={<MachineAdminPage />} />
              <Route path="incidents" element={<IncidentsPage />} />
              <Route path="maintenance" element={<MaintenancePage />} />
              <Route path="users" element={<UsersPage />} />
              <Route path="reports" element={<ReportsPage />} />
            </Route>
          </Route>
        </Route>
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
