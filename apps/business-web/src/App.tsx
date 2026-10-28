import { Route, Routes } from 'react-router-dom';
import { Layout } from './components/Layout';
import { LoginPage } from './auth/LoginPage';
import { RequireAuth } from './auth/RequireAuth';
import { AppointmentsPage } from './pages/AppointmentsPage';
import { ServicesPage } from './pages/ServicesPage';
import { HoursPage } from './pages/HoursPage';
import { GettingPaidPage } from './pages/PayoutsPage';
import { ProfilePage } from './pages/ProfilePage';
import { StoriesPage } from './pages/StoriesPage';
import { NotificationSettingsPage } from './pages/NotificationSettingsPage';
import { SecurityPage } from './pages/SecurityPage';
import { FollowersPage } from './pages/FollowersPage';
import { AppQrPage } from './pages/AppQrPage';
import { PapersPage } from './pages/PapersPage';
import { ClosuresPage } from './pages/ClosuresPage';
import { AnalyticsPage } from './pages/AnalyticsPage';
import { ReviewsPage } from './pages/ReviewsPage';
import { StaffPage } from './pages/StaffPage';
import { SupportPage } from './pages/SupportPage';
import { MessagesPage } from './pages/MessagesPage';
import { LegalPage } from './pages/LegalPage';
import { OverviewPage } from './pages/OverviewPage';
import { NotFoundPage } from './pages/NotFoundPage';
import { Welcome } from './onboarding/Welcome';
import { Allowed } from './components/Allowed';

export function App() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      {/* Setting up a shop (§256): full screen, outside the app's frame. */}
      <Route
        path="/welcome"
        element={
          <RequireAuth>
            <Welcome />
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
        <Route path="/" element={<OverviewPage />} />
        <Route path="/appointments" element={<AppointmentsPage />} />
        <Route path="/services" element={<ServicesPage />} />
        <Route path="/hours" element={<HoursPage />} />
        <Route
          path="/getting-paid"
          element={
            <Allowed need="money">
              <GettingPaidPage />
            </Allowed>
          }
        />
        <Route path="/profile" element={<ProfilePage />} />
        <Route path="/stories" element={<StoriesPage />} />
        <Route path="/followers" element={<FollowersPage />} />
        <Route path="/app-qr" element={<AppQrPage />} />
        <Route
          path="/papers"
          element={
            <Allowed need="runsBusiness">
              <PapersPage />
            </Allowed>
          }
        />
        <Route path="/notifications" element={<NotificationSettingsPage />} />
        <Route path="/security" element={<SecurityPage />} />
        <Route path="/people" element={<StaffPage />} />
        <Route path="/closures" element={<ClosuresPage />} />
        <Route path="/messages" element={<MessagesPage />} />
        <Route path="/reviews" element={<ReviewsPage />} />
        <Route
          path="/analytics"
          element={
            <Allowed need="insights">
              <AnalyticsPage />
            </Allowed>
          }
        />
        <Route path="/help" element={<SupportPage />} />
        <Route path="/legal" element={<LegalPage />} />
        {/* An address that is no page says so, inside the frame (§311). */}
        <Route path="*" element={<NotFoundPage />} />
      </Route>
    </Routes>
  );
}
