import { Navigate, Route, Routes } from 'react-router-dom';
import { Layout } from './components/Layout';
import { LoginPage } from './auth/LoginPage';
import { RequireAuth } from './auth/RequireAuth';
import { AppointmentsPage } from './pages/AppointmentsPage';
import { ServicesPage } from './pages/ServicesPage';
import { HoursPage } from './pages/HoursPage';
import { GettingPaidPage } from './pages/PayoutsPage';
import { SupportPage } from './pages/SupportPage';

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
        <Route path="/services" element={<ServicesPage />} />
        <Route path="/hours" element={<HoursPage />} />
        <Route path="/getting-paid" element={<GettingPaidPage />} />
        <Route path="/help" element={<SupportPage />} />
      </Route>
      <Route path="*" element={<Navigate to="/appointments" replace />} />
    </Routes>
  );
}
