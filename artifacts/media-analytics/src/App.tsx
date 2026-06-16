import React from "react";
import { Switch, Route, Router as WouterRouter, Redirect } from "wouter";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import NotFound from "@/pages/not-found";
import { Layout } from "@/components/layout";

import Dashboard from "@/pages/dashboard";
import Directories from "@/pages/directories";
import SessionsList from "@/pages/sessions";
import NewSession from "@/pages/sessions/new";
import SessionDetail from "@/pages/sessions/detail";
import Login from "@/pages/login";
import Profile from "@/pages/profile";
import AdminUsers from "@/pages/admin-users";
import { AuthProvider, useAuth } from "@/lib/auth";
import { ChangePasswordForm } from "@/components/ChangePasswordForm";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: 1,
      refetchOnWindowFocus: false,
    },
  },
});

function ForcedChangePassword() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-muted/30 p-4">
      <Card className="w-full max-w-md">
        <CardHeader>
          <CardTitle>Смените временный пароль</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground mb-4">
            Для вашей учётной записи задан временный пароль. Чтобы продолжить, задайте новый.
          </p>
          <ChangePasswordForm />
        </CardContent>
      </Card>
    </div>
  );
}

function AppRoutes() {
  const { user, loading } = useAuth();

  if (loading) {
    return <div className="min-h-screen flex items-center justify-center text-muted-foreground">Загрузка…</div>;
  }

  if (!user) {
    return (
      <Switch>
        <Route path="/login" component={Login} />
        <Route>
          <Redirect to="/login" />
        </Route>
      </Switch>
    );
  }

  if (user.mustChangePassword) {
    return <ForcedChangePassword />;
  }

  return (
    <Layout>
      <Switch>
        <Route path="/login">
          <Redirect to="/" />
        </Route>
        <Route path="/" component={Dashboard} />
        <Route path="/directories" component={Directories} />
        <Route path="/sessions" component={SessionsList} />
        <Route path="/sessions/new" component={NewSession} />
        <Route path="/sessions/:id" component={SessionDetail} />
        <Route path="/profile" component={Profile} />
        {user.role === "admin" && <Route path="/admin/users" component={AdminUsers} />}
        <Route component={NotFound} />
      </Switch>
    </Layout>
  );
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <TooltipProvider>
          <WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, "")}>
            <AppRoutes />
          </WouterRouter>
          <Toaster />
        </TooltipProvider>
      </AuthProvider>
    </QueryClientProvider>
  );
}

export default App;
