import { Switch, Route, Router as WouterRouter } from "wouter";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { AuthProvider } from "@/lib/auth";
import { Layout } from "@/components/layout";
import { ThemeProvider } from "@/components/theme-provider";
import NotFound from "@/pages/not-found";

import Home from "@/pages/home";
import JobsList from "@/pages/jobs/index";
import JobDetail from "@/pages/jobs/detail";
import JobPost from "@/pages/jobs/post";
import JobApply from "@/pages/jobs/apply";
import MockInterviewPage from "@/pages/jobs/mock-interview";
import EmployersList from "@/pages/employers/index";
import EmployerDetail from "@/pages/employers/detail";
import InstitutionsList from "@/pages/institutions/index";
import InstitutionDetail from "@/pages/institutions/detail";
import CandidatesList from "@/pages/candidates/index";
import CandidateDetail from "@/pages/candidates/detail";
import PublicReferenceFormPage from "@/pages/references/[token]";
import CandidateDashboard from "@/pages/dashboard/candidate";
import EmployerDashboard from "@/pages/dashboard/employer";
import InterviewInvitePage from "@/pages/interviews/invite";
import InstitutionDashboard from "@/pages/dashboard/institution";
import InstitutionEditPage from "@/pages/dashboard/institution-edit";
import InstitutionDepartmentsPage from "@/pages/dashboard/institution-departments";
import InstitutionFacultiesPage from "@/pages/dashboard/institution-faculties";
import InstitutionFacilitiesPage from "@/pages/dashboard/institution-facilities";
import InstitutionAnalyticsPage from "@/pages/dashboard/institution-analytics";
import InstitutionPendingEndorsementsPage from "@/pages/dashboard/institution-pending-endorsements";
import InstitutionCohortsPage from "@/pages/dashboard/institution-cohorts";
import AdminDashboard from "@/pages/dashboard/admin";
import AdminRegistrationsPage from "@/pages/dashboard/admin/registrations";
import AdminOnboardPage from "@/pages/dashboard/admin/onboard";
import AdminSiteContentPage from "@/pages/dashboard/admin/site-content";
import AdminBoostSettingsPage from "@/pages/dashboard/admin/boost-settings";
import AdminPartnersPage from "@/pages/dashboard/admin/partners";
import AdminCvSettingsPage from "@/pages/dashboard/admin/cv-settings";
import AdminInstitutionSubscriptionSettingsPage from "@/pages/dashboard/admin/institution-subscription-settings";
import AdminJobTierSettingsPage from "@/pages/dashboard/admin/job-tier-settings";
import JobsPromoteReturnPage from "@/pages/jobs/promote-return";
import JobBoostPage from "@/pages/jobs/boost";
import BoostReturnPage from "@/pages/boost/return";
import CvReturnPage from "@/pages/cv/return";
import CvBuilderPage from "@/pages/cv/builder";
import InstitutionSubscriptionPage from "@/pages/dashboard/institution-subscription";
import EmployerSubscriptionPage from "@/pages/dashboard/employer-subscription";
import TalentPoolsPage from "@/pages/dashboard/employer/pools";
import TalentPoolDetailPage from "@/pages/dashboard/employer/pool-detail";
import MessageTemplatesPage from "@/pages/dashboard/employer/templates";
import PipelineKanbanPage from "@/pages/dashboard/employer/kanban";
import EmployerSubscriptionReturnPage from "@/pages/employer-subscription/return";
import InstitutionSubscriptionReturnPage from "@/pages/institution-subscription/return";
import AdminAccountManagersPage from "@/pages/dashboard/admin/account-managers";
import AdminCandidatesPage from "@/pages/dashboard/admin/candidates";
import AdminEmployersPage from "@/pages/dashboard/admin/employers";
import AdminInstitutionsPage from "@/pages/dashboard/admin/institutions";
import AdminApplicationsPage from "@/pages/dashboard/admin/applications";
import AdminHiresPage from "@/pages/dashboard/admin/hires";
import AdminPartnerAnalyticsPage from "@/pages/dashboard/admin/partner-analytics";
import AdminRolesPage from "@/pages/dashboard/admin/roles";
import OrgRolesPage from "@/pages/dashboard/org-roles";
import StaffPage from "@/pages/dashboard/staff";
import { AdminLayout } from "@/components/admin-layout";
import { InstitutionLayout } from "@/components/institution-layout";
import { EmployerLayout } from "@/components/employer-layout";
import LoginPage from "@/pages/auth/login";
import SignupPage from "@/pages/auth/signup";
import SetupPasswordPage from "@/pages/auth/setup-password";
import ForgotPasswordPage from "@/pages/auth/forgot-password";
import ChangePasswordPage from "@/pages/account/change-password";
import ProfilePage from "@/pages/account/profile";
import ProfileViewsPage from "@/pages/account/profile-views";
import NotificationsPage from "@/pages/account/notifications";
import ApplicationDetailPage from "@/pages/account/application-detail";
import OffersInboxPage from "@/pages/account/offers";
import EmployerOpenCandidatesPage from "@/pages/dashboard/employer-open-candidates";
import CandidateMentorsPage from "@/pages/dashboard/candidate-mentors";
import CandidateMentorRequestsPage from "@/pages/dashboard/candidate-mentor-requests";
import AdminNetworkPage from "@/pages/dashboard/admin/network";

const queryClient = new QueryClient();

function Router() {
  return (
    <Layout>
      <Switch>
        <Route path="/" component={Home} />
        
        <Route path="/jobs" component={JobsList} />
        <Route path="/jobs/:id/boost" component={JobBoostPage} />
        <Route path="/jobs/:id" component={JobDetail} />
        <Route path="/post-job" component={JobPost} />
        <Route path="/apply/:jobId" component={JobApply} />
        
        <Route path="/employers" component={EmployersList} />
        <Route path="/employers/:id" component={EmployerDetail} />
        
        <Route path="/institutions" component={InstitutionsList} />
        <Route path="/institutions/:id" component={InstitutionDetail} />
        
        <Route path="/candidates" component={CandidatesList} />
        <Route path="/candidates/:id" component={CandidateDetail} />
        <Route path="/references/:token" component={PublicReferenceFormPage} />
        
        <Route path="/dashboard/candidate" component={CandidateDashboard} />
        <Route path="/dashboard/candidate/mentors" component={CandidateMentorsPage} />
        <Route path="/dashboard/candidate/mentor-requests" component={CandidateMentorRequestsPage} />
        <Route path="/account/applications/:id" component={ApplicationDetailPage} />
        <Route path="/jobs/:jobId/mock-interview" component={MockInterviewPage} />
        <Route path="/interviews/:id" component={InterviewInvitePage} />
        <Route path="/dashboard/employer">
          <EmployerLayout><EmployerDashboard /></EmployerLayout>
        </Route>
        <Route path="/dashboard/institution">
          <InstitutionLayout><InstitutionDashboard /></InstitutionLayout>
        </Route>
        <Route path="/dashboard/institution/edit">
          <InstitutionLayout><InstitutionEditPage /></InstitutionLayout>
        </Route>
        <Route path="/dashboard/institution/departments">
          <InstitutionLayout><InstitutionDepartmentsPage /></InstitutionLayout>
        </Route>
        <Route path="/dashboard/institution/faculties">
          <InstitutionLayout><InstitutionFacultiesPage /></InstitutionLayout>
        </Route>
        <Route path="/dashboard/institution/facilities">
          <InstitutionLayout><InstitutionFacilitiesPage /></InstitutionLayout>
        </Route>
        <Route path="/dashboard/institution/analytics">
          <InstitutionLayout><InstitutionAnalyticsPage /></InstitutionLayout>
        </Route>
        <Route path="/dashboard/institution/endorsements">
          <InstitutionLayout><InstitutionPendingEndorsementsPage /></InstitutionLayout>
        </Route>
        <Route path="/dashboard/institution/cohorts">
          <InstitutionLayout><InstitutionCohortsPage /></InstitutionLayout>
        </Route>
        <Route path="/dashboard/admin">
          <AdminLayout><AdminDashboard /></AdminLayout>
        </Route>
        <Route path="/dashboard/admin/candidates">
          <AdminLayout><AdminCandidatesPage /></AdminLayout>
        </Route>
        <Route path="/dashboard/admin/employers">
          <AdminLayout><AdminEmployersPage /></AdminLayout>
        </Route>
        <Route path="/dashboard/admin/institutions">
          <AdminLayout><AdminInstitutionsPage /></AdminLayout>
        </Route>
        <Route path="/dashboard/admin/applications">
          <AdminLayout><AdminApplicationsPage /></AdminLayout>
        </Route>
        <Route path="/dashboard/admin/hires">
          <AdminLayout><AdminHiresPage /></AdminLayout>
        </Route>
        <Route path="/dashboard/admin/partner-analytics">
          <AdminLayout><AdminPartnerAnalyticsPage /></AdminLayout>
        </Route>
        <Route path="/dashboard/admin/registrations">
          <AdminLayout><AdminRegistrationsPage /></AdminLayout>
        </Route>
        <Route path="/dashboard/admin/onboard">
          <AdminLayout><AdminOnboardPage /></AdminLayout>
        </Route>
        <Route path="/dashboard/admin/site-content">
          <AdminLayout><AdminSiteContentPage /></AdminLayout>
        </Route>
        <Route path="/dashboard/admin/network">
          <AdminLayout><AdminNetworkPage /></AdminLayout>
        </Route>
        <Route path="/dashboard/admin/partners">
          <AdminLayout><AdminPartnersPage /></AdminLayout>
        </Route>
        <Route path="/dashboard/admin/boost-settings">
          <AdminLayout><AdminBoostSettingsPage /></AdminLayout>
        </Route>
        <Route path="/dashboard/admin/cv-settings">
          <AdminLayout><AdminCvSettingsPage /></AdminLayout>
        </Route>
        <Route path="/dashboard/admin/institution-subscription-settings">
          <AdminLayout><AdminInstitutionSubscriptionSettingsPage /></AdminLayout>
        </Route>
        <Route path="/dashboard/admin/job-tier-settings">
          <AdminLayout><AdminJobTierSettingsPage /></AdminLayout>
        </Route>
        <Route path="/jobs/promote/return" component={JobsPromoteReturnPage} />
        {/* Legacy admin subscription settings page is retired; the route
            now redirects to the new per-job tier settings. */}
        <Route path="/dashboard/admin/employer-subscription-settings">
          <AdminLayout><AdminJobTierSettingsPage /></AdminLayout>
        </Route>
        <Route path="/dashboard/institution/subscription">
          <InstitutionLayout><InstitutionSubscriptionPage /></InstitutionLayout>
        </Route>
        <Route path="/dashboard/employer/subscription">
          <EmployerLayout><EmployerSubscriptionPage /></EmployerLayout>
        </Route>
        <Route path="/institution-subscription/return" component={InstitutionSubscriptionReturnPage} />
        <Route path="/employer-subscription/return" component={EmployerSubscriptionReturnPage} />
        <Route path="/boost/return" component={BoostReturnPage} />
        <Route path="/cv/return" component={CvReturnPage} />
        <Route path="/cv/builder" component={CvBuilderPage} />
        <Route path="/dashboard/admin/staff">
          <AdminLayout><StaffPage /></AdminLayout>
        </Route>
        <Route path="/dashboard/admin/account-managers">
          <AdminLayout><AdminAccountManagersPage /></AdminLayout>
        </Route>
        <Route path="/dashboard/admin/roles">
          <AdminLayout><AdminRolesPage /></AdminLayout>
        </Route>
        <Route path="/dashboard/employer/pipeline">
          <EmployerLayout><PipelineKanbanPage /></EmployerLayout>
        </Route>
        <Route path="/dashboard/employer/open-candidates">
          <EmployerLayout><EmployerOpenCandidatesPage /></EmployerLayout>
        </Route>
        <Route path="/account/offers" component={OffersInboxPage} />
        <Route path="/dashboard/employer/talent-pools/:poolId">
          <EmployerLayout><TalentPoolDetailPage /></EmployerLayout>
        </Route>
        <Route path="/dashboard/employer/talent-pools">
          <EmployerLayout><TalentPoolsPage /></EmployerLayout>
        </Route>
        <Route path="/dashboard/employer/templates">
          <EmployerLayout><MessageTemplatesPage /></EmployerLayout>
        </Route>
        <Route path="/dashboard/employer/staff">
          <EmployerLayout><StaffPage /></EmployerLayout>
        </Route>
        <Route path="/dashboard/employer/roles">
          <EmployerLayout><OrgRolesPage /></EmployerLayout>
        </Route>
        <Route path="/dashboard/institution/staff">
          <InstitutionLayout><StaffPage /></InstitutionLayout>
        </Route>
        <Route path="/dashboard/institution/roles">
          <InstitutionLayout><OrgRolesPage /></InstitutionLayout>
        </Route>

        <Route path="/login" component={LoginPage} />
        <Route path="/signup" component={SignupPage} />
        <Route path="/setup-password" component={SetupPasswordPage} />
        <Route path="/forgot-password" component={ForgotPasswordPage} />
        <Route path="/account/profile" component={ProfilePage} />
        <Route path="/account/password" component={ChangePasswordPage} />
        <Route path="/account/profile-views" component={ProfileViewsPage} />
        <Route path="/account/notifications" component={NotificationsPage} />
        
        <Route component={NotFound} />
      </Switch>
    </Layout>
  );
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <ThemeProvider defaultTheme="light" storageKey="talentlink-theme">
        <TooltipProvider>
          <AuthProvider>
            <WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, "")}>
              <Router />
            </WouterRouter>
          </AuthProvider>
          <Toaster />
        </TooltipProvider>
      </ThemeProvider>
    </QueryClientProvider>
  );
}

export default App;
