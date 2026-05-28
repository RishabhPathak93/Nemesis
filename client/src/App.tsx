import { useEffect } from 'react';
import { Routes, Route, Navigate } from 'react-router-dom';
import { useAuthStore } from '@/store/auth';
import { attachCsrfInterceptor } from '@/lib/csrf';
import { AppLayout } from '@/components/layout/AppLayout';
import { ProtectedRoute } from '@/components/layout/ProtectedRoute';
import Login from '@/pages/Login';
import Signup from '@/pages/Signup';
import ForgotPassword from '@/pages/ForgotPassword';
import ResetPassword from '@/pages/ResetPassword';
import VerifyEmail from '@/pages/VerifyEmail';
import AcceptInvite from '@/pages/AcceptInvite';
import Dashboard from '@/pages/Dashboard';
import Agents from '@/pages/Agents';
import NewAgent from '@/pages/NewAgent';
import AgentDetail from '@/pages/AgentDetail';
import Reports from '@/pages/Reports';
import ReportDetail from '@/pages/ReportDetail';
import Settings from '@/pages/Settings';
import Security from '@/pages/Security';
import ApiKeys from '@/pages/ApiKeys';
import AuditLog from '@/pages/AuditLog';
import SharedReport from '@/pages/SharedReport';
import Knowledge from '@/pages/Knowledge';
import ProbeLibrary from '@/pages/securityEngine/ProbeLibrary';
import ComplianceHeatmap from '@/pages/securityEngine/ComplianceHeatmap';
import Datasets from '@/pages/securityEngine/Datasets';
import DryRun from '@/pages/securityEngine/DryRun';
import Verticals from '@/pages/securityEngine/Verticals';
import Webhooks from '@/pages/Webhooks';
import Notifications from '@/pages/Notifications';
import ScheduledReports from '@/pages/ScheduledReports';
import Compliance from '@/pages/Compliance';

// Wire the CSRF interceptor once at module load — single global axios instance.
attachCsrfInterceptor();

export default function App() {
  const init = useAuthStore((s) => s.init);
  useEffect(() => {
    void init();
  }, [init]);

  return (
    <Routes>
      <Route path="/login" element={<Login />} />
      {/* Self-serve signup is closed — redirect bookmarks to /login. */}
      <Route path="/signup" element={<Navigate to="/login" replace />} />
      <Route path="/forgot-password" element={<ForgotPassword />} />
      <Route path="/reset/:token" element={<ResetPassword />} />
      <Route path="/verify-email/:token" element={<VerifyEmail />} />
      <Route path="/invite/:token" element={<AcceptInvite />} />
      <Route path="/share/:token" element={<SharedReport />} />

      <Route
        element={
          <ProtectedRoute>
            <AppLayout />
          </ProtectedRoute>
        }
      >
        <Route path="/dashboard" element={<Dashboard />} />
        <Route path="/agents" element={<Agents />} />
        <Route path="/agents/new" element={<NewAgent />} />
        <Route path="/agents/:id" element={<AgentDetail />} />
        <Route path="/reports" element={<Reports />} />
        <Route path="/reports/:id" element={<ReportDetail />} />
        <Route path="/knowledge" element={<Knowledge />} />
        <Route path="/security-engine/probes" element={<ProbeLibrary />} />
        <Route path="/security-engine/compliance" element={<ComplianceHeatmap />} />
        <Route path="/security-engine/datasets" element={<Datasets />} />
        <Route path="/security-engine/dry-run" element={<DryRun />} />
        <Route path="/security-engine/verticals" element={<Verticals />} />
        <Route path="/webhooks" element={<Webhooks />} />
        <Route path="/notifications" element={<Notifications />} />
        <Route path="/scheduled-reports" element={<ScheduledReports />} />
        <Route path="/compliance" element={<Compliance />} />
        <Route path="/security" element={<Security />} />
        <Route path="/api-keys" element={<ApiKeys />} />
        <Route path="/audit" element={<AuditLog />} />
        <Route path="/settings" element={<Settings />} />
      </Route>

      <Route path="/" element={<Navigate to="/dashboard" replace />} />
      <Route path="*" element={<Navigate to="/dashboard" replace />} />
    </Routes>
  );
}
