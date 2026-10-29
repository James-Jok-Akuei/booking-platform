import { Route, Routes } from 'react-router-dom';
import { Layout } from './components/Layout';
import { LoginPage } from './auth/LoginPage';
import { RequireAuth } from './auth/RequireAuth';
import { BusinessesPage } from './pages/BusinessesPage';
import { PayoutDestinationsPage } from './pages/PayoutDestinationsPage';
import { PayoutsPage } from './pages/PayoutsPage';
import { CategoriesPage } from './pages/CategoriesPage';
import { PlacesPage } from './pages/PlacesPage';
import { CountriesPage } from './pages/CountriesPage';
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
import { SecurityPage } from './pages/SecurityPage';
import { NotFoundPage } from './pages/NotFoundPage';
import { StatisticsPage } from './pages/statistics/StatisticsPage';
import { PitchSheet } from './pages/statistics/PitchSheet';
import { MoneyOnly } from './components/MoneyOnly';

export function App() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      {/* The pitch sheet (§316): a page to print, outside the frame. */}
      <Route
        path="/statistics/pitch"
        element={
          <RequireAuth>
            <MoneyOnly>
              <PitchSheet />
            </MoneyOnly>
          </RequireAuth>
        }
      />
      <Route
        element={
          <RequireAuth>
            <Layout />
          </RequireAuth>
        }
      >
        <Route index element={<OverviewPage />} />
        {/* Money pages (§317): for the primary administrator and those they trust with money. */}
        <Route path="/statistics" element={<MoneyOnly><StatisticsPage /></MoneyOnly>} />
        <Route path="/businesses" element={<BusinessesPage />} />
        <Route path="/payout-destinations" element={<MoneyOnly><PayoutDestinationsPage /></MoneyOnly>} />
        <Route path="/payouts" element={<MoneyOnly><PayoutsPage /></MoneyOnly>} />
        <Route path="/ledger" element={<MoneyOnly><LedgerPage /></MoneyOnly>} />
        <Route path="/reviews" element={<ReviewsPage />} />
        <Route path="/stories" element={<StoriesPage />} />
        <Route path="/announcements" element={<AnnouncementsPage />} />
        <Route path="/notifications" element={<NotificationSettingsPage />} />
        <Route path="/security" element={<SecurityPage />} />
        <Route path="/appointments" element={<AppointmentsPage />} />
        <Route path="/users" element={<UsersPage />} />
        <Route path="/tickets" element={<TicketsPage />} />
        <Route path="/categories" element={<CategoriesPage />} />
        <Route path="/countries" element={<CountriesPage />} />
        <Route path="/places" element={<PlacesPage />} />
        <Route path="/settings" element={<MoneyOnly><SettingsPage /></MoneyOnly>} />
        <Route path="/legal" element={<LegalPage />} />
        {/* An address that is no page says so, inside the frame (§311). */}
        <Route path="*" element={<NotFoundPage />} />
      </Route>
    </Routes>
  );
}
