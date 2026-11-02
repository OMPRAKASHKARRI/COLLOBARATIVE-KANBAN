import { BrowserRouter, Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { AuthProvider, useAuth } from './context/AuthContext';
import { ToastProvider } from './context/ToastContext';
import { WorkspaceProvider } from './context/WorkspaceContext';
import { RealtimeProvider } from './context/RealtimeContext';
import AppShell from './layouts/AppShell';
import { LoginPage, RegisterPage } from './pages/AuthPages';
import Dashboard from './pages/Dashboard';
import BoardPage from './pages/BoardPage';
import TeamPage from './pages/TeamPage';
import ActivityPage from './pages/ActivityPage';

function Protected({ children }) {
  const { user, booting } = useAuth();
  const loc = useLocation();
  if (booting) return <div className="flex h-full items-center justify-center" aria-busy="true"><div className="skeleton h-10 w-48" /></div>;
  if (!user) return <Navigate to="/login" replace state={{ from: loc.pathname }} />;
  return children;
}

export default function App() {
  return (
    <BrowserRouter>
      <ToastProvider>
        <AuthProvider>
          <WorkspaceProvider>
            <RealtimeProvider>
              <Routes>
                <Route path="/login" element={<LoginPage />} />
                <Route path="/register" element={<RegisterPage />} />
                <Route element={<Protected><AppShell /></Protected>}>
                  <Route index element={<Dashboard />} />
                  <Route path="boards/:boardId" element={<BoardPage />} />
                  <Route path="team" element={<TeamPage />} />
                  <Route path="activity" element={<ActivityPage />} />
                </Route>
                <Route path="*" element={<Navigate to="/" replace />} />
              </Routes>
            </RealtimeProvider>
          </WorkspaceProvider>
        </AuthProvider>
      </ToastProvider>
    </BrowserRouter>
  );
}
