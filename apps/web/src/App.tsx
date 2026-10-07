import { AlertTriangle } from 'lucide-react';
import { lazy, Suspense } from 'react';
import { Navigate, Route, Routes } from 'react-router-dom';
import { AppShell } from './components/layout/AppShell';
import { Alert, AlertDescription, AlertTitle } from './components/ui/alert';
import { Button } from './components/ui/button';
import { Skeleton } from './components/ui/skeleton';
import { errorMessage, useProfile } from './lib/queries';
import { ApplicationsPage } from './pages/ApplicationsPage';
import { CvImprovePage } from './pages/CvImprovePage';
import { InterviewPage } from './pages/InterviewPage';
import { InterviewsPage } from './pages/InterviewsPage';
import { JobsPage } from './pages/JobsPage';
import { OnboardingPage } from './pages/OnboardingPage';
import { ProfilePage } from './pages/ProfilePage';
import { SourcesPage } from './pages/SourcesPage';

// la revisione del CV porta con sé pdf.js: caricata solo quando serve
const CvReviewPage = lazy(() => import('./pages/CvReviewPage').then((m) => ({ default: m.CvReviewPage })));
const CoverLetterPage = lazy(() => import('./pages/CoverLetterPage').then((m) => ({ default: m.CoverLetterPage })));

export function PageSkeleton() {
  return (
    <div className="space-y-3 p-6" aria-busy="true" aria-label="Caricamento">
      <Skeleton className="h-8 w-64" />
      <Skeleton className="h-28 w-full" />
      <Skeleton className="h-28 w-full" />
      <Skeleton className="h-28 w-full" />
    </div>
  );
}

export function App() {
  const profile = useProfile();

  if (profile.isPending) return <PageSkeleton />;
  if (profile.isError) {
    return (
      <div className="mx-auto max-w-xl p-8">
        <Alert variant="destructive">
          <AlertTriangle />
          <AlertTitle>Impossibile contattare l’API</AlertTitle>
          <AlertDescription>
            <p>{errorMessage(profile.error)}</p>
            <p className="text-muted-foreground">
              Controlla lo stato dei container con <code>docker compose ps</code> e i log con{' '}
              <code>docker compose logs -f api</code>.
            </p>
            <Button variant="outline" size="sm" className="mt-2 w-fit" onClick={() => void profile.refetch()}>
              Riprova
            </Button>
          </AlertDescription>
        </Alert>
      </div>
    );
  }

  // primo avvio: finché non conosciamo paese e P.IVA si mostra solo l'onboarding
  if (!profile.data.onboardingComplete) return <OnboardingPage profile={profile.data} />;

  return (
    <AppShell>
      <Suspense fallback={<PageSkeleton />}>
        <Routes>
          <Route path="/" element={<JobsPage />} />
          <Route path="/applications" element={<ApplicationsPage />} />
          <Route path="/interviews" element={<InterviewsPage />} />
          <Route path="/interviews/:id" element={<InterviewPage />} />
          <Route path="/cv-review" element={<CvImprovePage />} />
          <Route path="/sources" element={<SourcesPage />} />
          <Route path="/profile" element={<ProfilePage />} />
          <Route path="/cv/:id" element={<CvReviewPage />} />
          <Route path="/letters/:id" element={<CoverLetterPage />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </Suspense>
    </AppShell>
  );
}
