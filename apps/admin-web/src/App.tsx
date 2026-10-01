import { Navigate, Route, Routes } from 'react-router-dom';
import { Layout } from './components/Layout';
import { LoginPage } from './auth/LoginPage';
import { RequireAuth } from './auth/RequireAuth';
import { BusinessesPage } from './pages/BusinessesPage';
import { PayoutDestinationsPage } from './pages/PayoutDestinationsPage';
import { PayoutsPage } from './pages/PayoutsPage';
import { SettingsPage } from './pages/SettingsPage';
import { LedgerPage } from './pages/LedgerPage';
import { ReviewsPage } from './pages/ReviewsPage';
import { UsersPage } from './pages/UsersPage';
import { TicketsPage } from './pages/TicketsPage';

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
        <Route path="/businesses" element={<BusinessesPage />} />
        <Route path="/payout-destinations" element={<PayoutDestinationsPage />} />
        <Route path="/payouts" element={<PayoutsPage />} />
        <Route path="/ledger" element={<LedgerPage />} />
        <Route path="/reviews" element={<ReviewsPage />} />
        <Route path="/users" element={<UsersPage />} />
        <Route path="/tickets" element={<TicketsPage />} />
        <Route path="/settings" element={<SettingsPage />} />
      </Route>
      <Route path="*" element={<Navigate to="/businesses" replace />} />
    </Routes>
  );
}
