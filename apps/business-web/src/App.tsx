import { Navigate, Route, Routes } from 'react-router-dom';
import { Layout } from './components/Layout';
import { LoginPage } from './auth/LoginPage';
import { RequireAuth } from './auth/RequireAuth';
import { AppointmentsPage } from './pages/AppointmentsPage';

export function App() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route
        element={
          <RequireAuth>
            <Layout />
          </RequireAuth>
        }
      >
        <Route path="/appointments" element={<AppointmentsPage />} />
      </Route>
      <Route path="*" element={<Navigate to="/appointments" replace />} />
    </Routes>
  );
}
