import { ReactNode } from 'react';
import { Navigate } from 'react-router-dom';
import { useAuthStore } from '@/store/auth';
import { FullPageLoader } from '@/components/shared/LoadingSpinner';

export function ProtectedRoute({ children }: { children: ReactNode }) {
  const { user, initialized } = useAuthStore();
  if (!initialized) return <FullPageLoader />;
  if (!user) return <Navigate to="/login" replace />;
  return <>{children}</>;
}
