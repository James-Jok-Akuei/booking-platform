import { Navigate, Route, Routes } from 'react-router-dom';
import { Layout } from './components/Layout';
import { LoginPage } from './auth/LoginPage';
import { RequireAuth } from './auth/RequireAuth';
import { BusinessesPage } from './pages/BusinessesPage';
import { PayoutDestinationsPage } from './pages/PayoutDestinationsPage';
import { PayoutsPage } from './pages/PayoutsPage';
import { CategoriesPage } from './pages/CategoriesPage';
import { PlacesPage } from './pages/PlacesPage';
import { SettingsPage } from './pages/SettingsPage';
import { LedgerPage } from './pages/LedgerPage';
import { ReviewsPage } from './pages/ReviewsPage';
import { StoriesPage } from './pages/StoriesPage';
import { AnnouncementsPage } from './pages/AnnouncementsPage';
import { NotificationSettingsPage } from './pages/NotificationSettingsPage';
import { AppointmentsPage } from './pages/AppointmentsPage';
import { UsersPage } from './pages/UsersPage';
import { LegalPage } from './pages/LegalPage';
import { OverviewPage } from './pages/OverviewPage';
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
        <Route index element={<OverviewPage />} />
        <Route path="/businesses" element={<BusinessesPage />} />
        <Route path="/payout-destinations" element={<PayoutDestinationsPage />} />
        <Route path="/payouts" element={<PayoutsPage />} />
        <Route path="/ledger" element={<LedgerPage />} />
        <Route path="/reviews" element={<ReviewsPage />} />
        <Route path="/stories" element={<StoriesPage />} />
        <Route path="/announcements" element={<AnnouncementsPage />} />
        <Route path="/notifications" element={<NotificationSettingsPage />} />
        <Route path="/appointments" element={<AppointmentsPage />} />
        <Route path="/users" element={<UsersPage />} />
        <Route path="/tickets" element={<TicketsPage />} />
        <Route path="/categories" element={<CategoriesPage />} />
        <Route path="/places" element={<PlacesPage />} />
        <Route path="/settings" element={<SettingsPage />} />
        <Route path="/legal" element={<LegalPage />} />
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
