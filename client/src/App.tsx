import { Switch, Route, Redirect } from "wouter";
import { queryClient } from "./lib/queryClient";
import { QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { ThemeProvider } from "@/components/ThemeProvider";
import { LanguageProvider } from "@/i18n";
import { PendingEditsProvider } from "@/contexts/PendingEditsContext";
import NotFound from "@/pages/not-found";
import Library from "@/pages/Library";
import Explore from "@/pages/Explore";
import Viewer from "@/pages/Viewer";
import MySentences from "@/pages/MySentences";
import Flashcards from "@/pages/Flashcards";
import Notebooks from "@/pages/Notebooks";
import Glossary from "@/pages/Glossary";
import PracticeHub from "@/pages/PracticeHub";
import PracticeQuiz from "@/pages/PracticeQuiz";
import PracticeSession from "@/pages/PracticeSession";
import Settings from "@/pages/Settings";
import { AdminNew } from "@/pages/AdminNew";
import Login from "@/pages/Login";
import Signup from "@/pages/Signup";
import ForgotPassword from "@/pages/ForgotPassword";
import ResetPassword from "@/pages/ResetPassword";
import VerifyEmail from "@/pages/VerifyEmail";
import SetupUsername from "@/pages/SetupUsername";
import Home from "@/pages/Home";
import Pricing from "@/pages/Pricing";
import PaymentSuccess from "@/pages/PaymentSuccess";
import PaymentFailed from "@/pages/PaymentFailed";
import FAQ from "@/pages/FAQ";

function Router() {
  return (
    <Switch>
      {/* Authentication routes */}
      <Route path="/login" component={Login} />
      <Route path="/signup" component={Signup} />
      <Route path="/forgot-password" component={ForgotPassword} />
      <Route path="/reset-password" component={ResetPassword} />
      <Route path="/verify-email" component={VerifyEmail} />
      <Route path="/setup-username" component={SetupUsername} />

      {/* Main application routes */}
      <Route path="/" component={Home} />
      <Route path="/library" component={Library} />
      <Route path="/explore" component={Explore} />
      <Route path="/viewer/:id" component={Viewer} />
      <Route path="/sentences" component={MySentences} />
      <Route path="/my-sentences" component={MySentences} />
      <Route path="/flashcards" component={Flashcards} />
      <Route path="/notebooks" component={Notebooks} />
      <Route path="/glossary" component={Glossary} />
      <Route path="/practice" component={PracticeHub} />
      <Route path="/practice/:id" component={PracticeSession} />
      <Route path="/practice-legacy/:id" component={PracticeQuiz} />
      <Route path="/profile">{() => <Redirect to="/settings" />}</Route>
      <Route path="/settings" component={Settings} />
      <Route path="/admin" component={AdminNew} />
      <Route path="/pricing">{() => <Redirect to="/" />}</Route>
      <Route path="/payment-success" component={PaymentSuccess} />
      <Route path="/payment-failed" component={PaymentFailed} />
      <Route path="/faq" component={FAQ} />
      <Route component={NotFound} />
    </Switch>
  );
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <LanguageProvider>
        <ThemeProvider defaultTheme="light" storageKey="ui-theme">
          <TooltipProvider>
            <PendingEditsProvider>
              <Toaster />
              <Router />
            </PendingEditsProvider>
          </TooltipProvider>
        </ThemeProvider>
      </LanguageProvider>
    </QueryClientProvider>
  );
}

export default App;