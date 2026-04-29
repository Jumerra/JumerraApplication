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
import EmployersList from "@/pages/employers/index";
import EmployerDetail from "@/pages/employers/detail";
import InstitutionsList from "@/pages/institutions/index";
import InstitutionDetail from "@/pages/institutions/detail";
import CandidatesList from "@/pages/candidates/index";
import CandidateDetail from "@/pages/candidates/detail";
import CandidateDashboard from "@/pages/dashboard/candidate";
import EmployerDashboard from "@/pages/dashboard/employer";
import InstitutionDashboard from "@/pages/dashboard/institution";
import AdminDashboard from "@/pages/dashboard/admin";
import AdminRegistrationsPage from "@/pages/dashboard/admin/registrations";
import AdminOnboardPage from "@/pages/dashboard/admin/onboard";
import AdminSiteContentPage from "@/pages/dashboard/admin/site-content";
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
import LoginPage from "@/pages/auth/login";
import SignupPage from "@/pages/auth/signup";
import SetupPasswordPage from "@/pages/auth/setup-password";
import ForgotPasswordPage from "@/pages/auth/forgot-password";
import ChangePasswordPage from "@/pages/account/change-password";
import ProfilePage from "@/pages/account/profile";

const queryClient = new QueryClient();

function Router() {
  return (
    <Layout>
      <Switch>
        <Route path="/" component={Home} />
        
        <Route path="/jobs" component={JobsList} />
        <Route path="/jobs/:id" component={JobDetail} />
        <Route path="/post-job" component={JobPost} />
        <Route path="/apply/:jobId" component={JobApply} />
        
        <Route path="/employers" component={EmployersList} />
        <Route path="/employers/:id" component={EmployerDetail} />
        
        <Route path="/institutions" component={InstitutionsList} />
        <Route path="/institutions/:id" component={InstitutionDetail} />
        
        <Route path="/candidates" component={CandidatesList} />
        <Route path="/candidates/:id" component={CandidateDetail} />
        
        <Route path="/dashboard/candidate" component={CandidateDashboard} />
        <Route path="/dashboard/employer" component={EmployerDashboard} />
        <Route path="/dashboard/institution" component={InstitutionDashboard} />
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
        <Route path="/dashboard/admin/staff">
          <AdminLayout><StaffPage /></AdminLayout>
        </Route>
        <Route path="/dashboard/admin/account-managers">
          <AdminLayout><AdminAccountManagersPage /></AdminLayout>
        </Route>
        <Route path="/dashboard/admin/roles">
          <AdminLayout><AdminRolesPage /></AdminLayout>
        </Route>
        <Route path="/dashboard/employer/staff" component={StaffPage} />
        <Route path="/dashboard/employer/roles" component={OrgRolesPage} />
        <Route path="/dashboard/institution/staff" component={StaffPage} />
        <Route path="/dashboard/institution/roles" component={OrgRolesPage} />

        <Route path="/login" component={LoginPage} />
        <Route path="/signup" component={SignupPage} />
        <Route path="/setup-password" component={SetupPasswordPage} />
        <Route path="/forgot-password" component={ForgotPasswordPage} />
        <Route path="/account/profile" component={ProfilePage} />
        <Route path="/account/password" component={ChangePasswordPage} />
        
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
