import { Router } from 'express';
import { authMiddleware, requireRole, requirePermission, requireScope } from '../middleware/auth';
import { authLimiter, passwordResetLimiter } from '../lib/rateLimits';
import * as auth from '../controllers/authController';
import * as authPassword from '../controllers/authPasswordController';
import * as authRefresh from '../controllers/authRefreshController';
import * as authMfa from '../controllers/authMfaController';
import * as agents from '../controllers/agentController';
import * as runs from '../controllers/testRunController';
import * as reports from '../controllers/reportController';
import * as dashboard from '../controllers/dashboardController';
import * as settings from '../controllers/settingsController';
import * as knowledge from '../controllers/knowledgeController';
import * as audit from '../controllers/auditController';
import * as apiKeys from '../controllers/apiKeyController';
import * as share from '../controllers/shareController';
import * as invites from '../controllers/inviteController';
import * as branding from '../controllers/brandingController';
import * as securityEngine from '../controllers/securityEngineController';
import * as webhooks from '../controllers/webhookController';
import * as notifications from '../controllers/notificationController';
import * as scheduledReports from '../controllers/scheduledReportController';
import * as exporter from '../controllers/exportController';
import * as sso from '../controllers/ssoController';
import * as testRunCancel from '../controllers/testRunCancelController';
import * as orgPolicy from '../controllers/orgPolicyController';
import * as quota from '../controllers/quotaController';
import * as dsr from '../controllers/dsrController';
import * as impersonation from '../controllers/impersonationController';
import * as privacy from '../controllers/privacyController';
import * as oidc from '../controllers/oidcController';
import * as webauthn from '../controllers/webauthnController';
import * as evidence from '../controllers/complianceEvidenceController';
import * as siem from '../controllers/siemController';
import * as scim from '../controllers/scimController';
import * as permGrants from '../controllers/permissionGrantController';
import * as memberships from '../controllers/membershipController';
import * as smtp from '../controllers/smtpController';
import { logoUpload } from '../middleware/uploadLimits';
import { csrfTokenIssuer } from '../lib/csrf';
import { ipAllowlistMiddleware } from '../middleware/ipAllowlist';

const router = Router();

// CSRF token mint endpoint — public (no auth needed to *get* a token; the
// double-submit check enforces possession of the cookie + matching header).
router.get('/csrf', csrfTokenIssuer);

// v2.0 — SCIM 2.0 endpoints (public; auth is bearer-token in the controller).
// Mounted before authMiddleware so IdPs can hit them with their own credentials.
router.get('/scim/v2/Users', scim.listUsers);
router.post('/scim/v2/Users', scim.createUser);
router.get('/scim/v2/Users/:id', scim.getUser);
router.put('/scim/v2/Users/:id', scim.replaceUser);
router.patch('/scim/v2/Users/:id', scim.patchUser);
router.delete('/scim/v2/Users/:id', scim.deleteUser);

// ──────────────────────────────────────────────────────────────────────
// Public auth surface — heavily rate-limited
// ──────────────────────────────────────────────────────────────────────
router.post('/auth/signup', authLimiter, auth.signup);
router.post('/auth/login', authLimiter, auth.login);
router.post('/auth/refresh', authLimiter, authRefresh.refresh);
router.post('/auth/logout', authRefresh.logout);
router.post('/auth/verify-mfa', authLimiter, authMfa.verifyLogin);

// Password reset
router.post('/auth/forgot-password', passwordResetLimiter, authPassword.forgotPassword);
router.post('/auth/reset-password', passwordResetLimiter, authPassword.resetPassword);

// Email verification
router.post('/auth/request-verification', passwordResetLimiter, auth.requestVerificationEmail);
router.get('/auth/verify-email/:token', auth.verifyEmail);

// Invite preview / accept (public)
router.get('/invites/:token', invites.previewInvite);
router.post('/invites/:token/accept', authLimiter, invites.acceptInvite);

// Public share link
router.get('/reports/share/:token', reports.getReportByShareToken);

// SAML SSO public surface (v1.3 inc 4)
router.post('/sso/discover', authLimiter, sso.discoverSso);
router.get('/auth/saml/:orgSlug/login', sso.samlLogin);
router.post('/auth/saml/:orgSlug/acs', sso.samlAcs);
router.get('/auth/saml/:orgSlug/metadata', sso.samlMetadata);

// OIDC SSO public surface (v2.0)
router.post('/sso/discover-oidc', authLimiter, oidc.discoverOidc);
router.get('/auth/oidc/:orgSlug/login', oidc.oidcLogin);
router.get('/auth/oidc/:orgSlug/callback', oidc.oidcCallback);

// WebAuthn login surface (v2.0) — public; mfaSessionToken proves prior password step
router.post('/auth/webauthn/has-passkey', authLimiter, webauthn.hasPasskey);
router.post('/auth/webauthn/auth/options', authLimiter, webauthn.authenticationOptions);
router.post('/auth/webauthn/auth/verify', authLimiter, webauthn.authenticationVerify);

// ──────────────────────────────────────────────────────────────────────
// Authenticated routes
// ──────────────────────────────────────────────────────────────────────
router.use(authMiddleware);
// IP allowlist gate runs after auth (so we know the org) but before any handler.
router.use(ipAllowlistMiddleware);

router.get('/auth/me', auth.me);
router.post('/auth/change-password', authPassword.changePassword);
router.get('/auth/sessions', authRefresh.listSessions);
router.delete('/auth/sessions/:id', authRefresh.revokeSession);

// MFA management (self-service)
router.post('/auth/mfa/setup', authMfa.setupMfa);
router.post('/auth/mfa/verify-setup', authMfa.verifySetup);
router.post('/auth/mfa/disable', authMfa.disableMfa);
router.post('/auth/mfa/backup-codes', authMfa.regenerateBackupCodes);

// Agents — gated by permission table; API keys also need explicit scope
router.get('/agents', requirePermission('agents:read'), requireScope('agents:read'), agents.listAgents);
router.post('/agents', requirePermission('agents:write'), requireScope('agents:write'), agents.createAgent);
router.get('/agents/:id', requirePermission('agents:read'), requireScope('agents:read'), agents.getAgent);
router.put('/agents/:id', requirePermission('agents:write'), requireScope('agents:write'), agents.updateAgent);
router.delete('/agents/:id', requirePermission('agents:write'), requireScope('agents:write'), agents.deleteAgent);
router.get('/agents/:id/test-connection', requirePermission('agents:read'), requireScope('agents:read'), agents.testAgentConnection);
router.post('/agents/:id/understand', requirePermission('agents:write'), requireScope('agents:write'), agents.understandAgent);
router.get('/agents/:id/test-suites', requirePermission('runs:read'), requireScope('runs:read'), agents.listTestSuites);
router.post('/agents/:id/test-suites', requirePermission('runs:write'), requireScope('runs:write'), agents.generateSuite);
router.post('/agents/:id/run-tests', requirePermission('agents:run'), requireScope('runs:write'), agents.runTests);

// Test runs / results
router.get('/test-runs/:id/status', requirePermission('runs:read'), requireScope('runs:read'), runs.getStatus);
router.get('/test-runs/:id/report', requirePermission('reports:read'), requireScope('reports:read'), runs.getReportForRun);
router.get('/test-runs/:id/results', requirePermission('runs:read'), requireScope('runs:read'), runs.getResults);

// Reports
router.get('/reports', requirePermission('reports:read'), requireScope('reports:read'), reports.listReports);
router.get('/reports/:id', requirePermission('reports:read'), requireScope('reports:read'), reports.getReport);
router.post('/reports/:id/share', requirePermission('reports:share'), share.updateShare);
router.delete('/reports/:id/share', requirePermission('reports:share'), share.revokeShare);
router.get('/reports/:id/share/views', requirePermission('reports:share'), share.listShareViews);

// Dashboard
router.get('/dashboard/stats', dashboard.getStats);

// Knowledge
router.get('/knowledge/stats', knowledge.getStats);
router.get('/knowledge/patterns', knowledge.listPatterns);
router.delete('/knowledge/patterns/:id', knowledge.removePattern);
router.get('/knowledge/research', knowledge.listResearch);
router.post('/knowledge/research', knowledge.runAdhocResearch);
router.post('/knowledge/extract', knowledge.extractFromRun);
router.get('/knowledge/articles', knowledge.listArticles);
router.get('/knowledge/articles/categories', knowledge.listCategories);
router.get('/knowledge/articles/:id', knowledge.getArticle);

// Settings — org
router.get('/settings/org', settings.getOrg);
router.put('/settings/org', requireRole('ADMIN'), settings.updateOrg);
router.post('/settings/llm/test', settings.testLlmConnection);

// Settings — SMTP (admin only). Per-org transport for outbound email.
router.get('/settings/smtp', requireRole('ADMIN'), smtp.getSmtp);
router.put('/settings/smtp', requireRole('ADMIN'), smtp.updateSmtp);
router.post('/settings/smtp/test', requireRole('ADMIN'), smtp.testSmtp);
router.delete('/settings/smtp', requireRole('ADMIN'), smtp.disableSmtp);

// Settings — members & invites
router.get('/settings/members', settings.listMembers);
router.post('/settings/invites', requireRole('ADMIN'), settings.createInvite);
router.delete('/settings/invites/:id', requireRole('ADMIN'), settings.deleteInvite);
router.post('/settings/members/:id/deactivate', requireRole('ADMIN'), settings.deactivateMember);
router.post('/settings/members/:id/reactivate', requireRole('ADMIN'), settings.reactivateMember);
router.put('/settings/members/:id/role', requireRole('ADMIN'), settings.updateMemberRole);

// Settings — API keys (admin only)
router.get('/settings/api-keys', requirePermission('apikeys:read'), apiKeys.listApiKeys);
router.post('/settings/api-keys', requirePermission('apikeys:manage'), apiKeys.createApiKey);
router.delete('/settings/api-keys/:id', requirePermission('apikeys:manage'), apiKeys.revokeApiKey);

// Audit log (admin only)
router.get('/audit/logs', requirePermission('audit:read'), audit.listAuditLogs);
router.get('/audit/actions', requirePermission('audit:read'), audit.listActions);

// Danger
router.delete('/settings/danger/data', requirePermission('danger:delete'), settings.deleteOrgData);

// ──────────────────────────────────────────────────────────────────────
// v1.3 increment 1 — Branding
// ──────────────────────────────────────────────────────────────────────
router.get('/settings/branding', requirePermission('branding:read'), branding.getBranding);
router.put('/settings/branding', requirePermission('branding:write'), branding.updateBranding);
router.get('/settings/branding/logo', requirePermission('branding:read'), branding.downloadBrandingLogo);
router.post(
  '/settings/branding/logo',
  requirePermission('branding:write'),
  logoUpload.single('logo'),
  branding.uploadBrandingLogo,
);
router.delete('/settings/branding/logo', requirePermission('branding:write'), branding.removeBrandingLogo);

// ──────────────────────────────────────────────────────────────────────
// SE-1 — Security engine catalog (browse + heatmap; execution wired in SE-2+)
// ──────────────────────────────────────────────────────────────────────
router.get('/security-engine/probes', requirePermission('security_engine:read'), securityEngine.listProbes);
router.get('/security-engine/probes/facets', requirePermission('security_engine:read'), securityEngine.listProbeFacets);
router.put('/security-engine/probes/:id/toggle', requirePermission('security_engine:manage'), securityEngine.toggleProbe);
router.get('/security-engine/strategies', requirePermission('security_engine:read'), securityEngine.listStrategies);
router.get('/security-engine/detectors', requirePermission('security_engine:read'), securityEngine.listDetectors);
router.get('/security-engine/verticals', requirePermission('security_engine:read'), securityEngine.listVerticals);
router.get('/security-engine/compliance/heatmap', requirePermission('security_engine:read'), securityEngine.complianceHeatmap);
router.get('/security-engine/datasets', requirePermission('security_engine:read'), securityEngine.listDatasets);
router.post('/security-engine/datasets/refresh', requirePermission('security_engine:manage'), securityEngine.refreshDataset);
router.post('/security-engine/datasets/promote', requirePermission('security_engine:manage'), securityEngine.promoteDatasetItem);
router.post('/security-engine/datasets/promote-all', requirePermission('security_engine:manage'), securityEngine.promoteDatasetSource);
router.get('/security-engine/datasets/:source/items', requirePermission('security_engine:read'), securityEngine.listDatasetItems);
router.post('/security-engine/dry-run', requirePermission('security_engine:dry_run'), securityEngine.dryRun);

// ──────────────────────────────────────────────────────────────────────
// v1.3 inc 2 — Webhooks
// ──────────────────────────────────────────────────────────────────────
router.get('/settings/webhooks', requirePermission('webhooks:read'), webhooks.listWebhooks);
router.post('/settings/webhooks', requirePermission('webhooks:manage'), webhooks.createWebhook);
router.put('/settings/webhooks/:id', requirePermission('webhooks:manage'), webhooks.updateWebhook);
router.delete('/settings/webhooks/:id', requirePermission('webhooks:manage'), webhooks.deleteWebhook);
router.post('/settings/webhooks/:id/rotate-secret', requirePermission('webhooks:manage'), webhooks.rotateSecret);
router.post('/settings/webhooks/:id/test', requirePermission('webhooks:manage'), webhooks.testWebhook);
router.get('/settings/webhooks/:id/deliveries', requirePermission('webhooks:read'), webhooks.listDeliveries);

// ──────────────────────────────────────────────────────────────────────
// v1.3 inc 3a — Notification channels
// ──────────────────────────────────────────────────────────────────────
router.get('/settings/notifications', requirePermission('notifications:read'), notifications.listChannels);
router.post('/settings/notifications', requirePermission('notifications:manage'), notifications.createChannel);
router.put('/settings/notifications/:id', requirePermission('notifications:manage'), notifications.updateChannel);
router.delete('/settings/notifications/:id', requirePermission('notifications:manage'), notifications.deleteChannel);
router.post('/settings/notifications/:id/test', requirePermission('notifications:manage'), notifications.testChannel);

// ──────────────────────────────────────────────────────────────────────
// v1.3 inc 3b — Scheduled reports
// ──────────────────────────────────────────────────────────────────────
router.get('/settings/scheduled-reports', requirePermission('reports:schedule'), scheduledReports.listScheduledReports);
router.post('/settings/scheduled-reports', requirePermission('reports:schedule'), scheduledReports.createScheduledReport);
router.put('/settings/scheduled-reports/:id', requirePermission('reports:schedule'), scheduledReports.updateScheduledReport);
router.delete('/settings/scheduled-reports/:id', requirePermission('reports:schedule'), scheduledReports.deleteScheduledReport);
router.post('/settings/scheduled-reports/:id/run-now', requirePermission('reports:schedule'), scheduledReports.runNow);
router.get('/settings/scheduled-reports/:id/runs', requirePermission('reports:schedule'), scheduledReports.listRuns);

// ──────────────────────────────────────────────────────────────────────
// v1.3 inc 3c — Report export (HTML server-side; PDF stays client-side)
// ──────────────────────────────────────────────────────────────────────
router.get('/reports/:id/export', requirePermission('reports:export'), exporter.exportReport);

// ──────────────────────────────────────────────────────────────────────
// v1.3 inc 4 — SAML SSO (admin)
// ──────────────────────────────────────────────────────────────────────
router.get('/settings/sso', requirePermission('sso:read'), sso.getSso);
router.put('/settings/sso', requirePermission('sso:write'), sso.updateSso);
router.post('/settings/sso/test', requirePermission('sso:write'), sso.testSso);

// v2.0 — OIDC SSO config (per-org)
router.get('/settings/oidc', requirePermission('sso:read'), oidc.getOidc);
router.put('/settings/oidc', requirePermission('sso:write'), oidc.updateOidc);

// v2.0 — WebAuthn passkeys (self-service)
router.get('/auth/webauthn/credentials', webauthn.listCredentials);
router.delete('/auth/webauthn/credentials/:id', webauthn.removeCredential);
router.post('/auth/webauthn/register/options', webauthn.registrationOptions);
router.post('/auth/webauthn/register/verify', webauthn.registrationVerify);

// ──────────────────────────────────────────────────────────────────────
// v1.4 — Test run cancellation
// ──────────────────────────────────────────────────────────────────────
router.post('/test-runs/:id/cancel', requirePermission('runs:write'), testRunCancel.cancelTestRun);
// Remediation Re-test — clone + re-run a completed run's failed/partial findings.
router.post('/test-runs/:id/reverify', requirePermission('runs:write'), requireScope('runs:write'), runs.reverifyRun);

// ──────────────────────────────────────────────────────────────────────
// v1.5 — IP allowlist + SSO-only (admin)
// ──────────────────────────────────────────────────────────────────────
router.get('/settings/policy', requirePermission('org:read'), orgPolicy.getPolicy);
router.put('/settings/policy', requirePermission('org:write'), orgPolicy.updatePolicy);

// ──────────────────────────────────────────────────────────────────────
// v1.5 — Quotas / usage
// ──────────────────────────────────────────────────────────────────────
router.get('/settings/usage', requirePermission('org:read'), quota.getUsage);
router.put('/settings/usage/caps', requirePermission('org:write'), quota.setCaps);
router.post('/settings/usage/reset', requirePermission('org:write'), quota.resetMonthlyCounters);

// ──────────────────────────────────────────────────────────────────────
// v1.5 — GDPR Data Subject Requests
// ──────────────────────────────────────────────────────────────────────
router.get('/data-subject-requests', dsr.listDsrs);
router.post('/data-subject-requests', dsr.createDsr);
router.post('/data-subject-requests/:id/decision', requireRole('ADMIN'), dsr.approveDsr);
router.get('/data-subject-requests/:id/download', requireRole('ADMIN'), dsr.downloadDsr);

// ──────────────────────────────────────────────────────────────────────
// v1.5 — Impersonation (admin-only)
// ──────────────────────────────────────────────────────────────────────
router.post('/admin/impersonate', requireRole('ADMIN'), impersonation.startImpersonation);
router.post('/admin/impersonate/:id/end', requireRole('ADMIN'), impersonation.endImpersonation);
router.get('/admin/impersonate', requireRole('ADMIN'), impersonation.listImpersonations);

// ──────────────────────────────────────────────────────────────────────
// v1.5 — Privacy / ToS / DPA acceptance
// ──────────────────────────────────────────────────────────────────────
router.get('/legal/required', privacy.getRequiredAcceptances);
router.post('/legal/accept', privacy.recordAcceptance);

// v1.5 — Compliance evidence collector (admin)
router.get('/compliance/evidence', requireRole('ADMIN'), evidence.listEvidence);
router.post('/compliance/evidence/generate', requireRole('ADMIN'), evidence.generateEvidenceNow);
router.get('/compliance/evidence/:id/download', requireRole('ADMIN'), evidence.downloadEvidence);

// v2.0 — SIEM forwarders (admin)
router.get('/settings/siem', requireRole('ADMIN'), siem.listForwarders);
router.post('/settings/siem', requireRole('ADMIN'), siem.createForwarder);
router.put('/settings/siem/:id', requireRole('ADMIN'), siem.updateForwarder);
router.delete('/settings/siem/:id', requireRole('ADMIN'), siem.deleteForwarder);

// v2.0 — SCIM endpoint admin (issue / rotate / disable the bearer token)
router.get('/settings/scim', requireRole('ADMIN'), scim.getScimConfig);
router.post('/settings/scim/rotate', requireRole('ADMIN'), scim.rotateScimToken);
router.post('/settings/scim/disable', requireRole('ADMIN'), scim.disableScim);

// v2.0 — Granular ACL overrides per org
router.get('/settings/permissions', requireRole('ADMIN'), permGrants.listGrants);
router.put('/settings/permissions', requireRole('ADMIN'), permGrants.setGrant);
router.delete('/settings/permissions/:id', requireRole('ADMIN'), permGrants.clearGrant);

// v2.0 — Multi-org Membership
router.get('/auth/memberships', memberships.listMyMemberships);
router.post('/auth/memberships/switch', memberships.switchOrg);
router.get('/settings/memberships', requireRole('ADMIN'), memberships.listMembershipsForOrg);
router.post('/settings/memberships', requireRole('ADMIN'), memberships.addMembership);
router.delete('/settings/memberships/:id', requireRole('ADMIN'), memberships.removeMembership);

export default router;
