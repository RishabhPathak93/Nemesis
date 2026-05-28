import { AlertTriangle, RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';

interface ErrorStateProps {
  /** Short human-readable message — usually the result of apiError(). */
  message: string;
  /** Optional title; defaults to "Couldn't load this page". */
  title?: string;
  /** Retry handler. If omitted the retry button is hidden. */
  onRetry?: () => void;
  /** When true, render full-page-centred. Otherwise inline as a card. */
  full?: boolean;
}

export function ErrorState({ message, title = "Couldn't load this page", onRetry, full = false }: ErrorStateProps) {
  const body = (
    <Card className="mx-auto max-w-md border-red-200 bg-red-50">
      <CardContent className="flex flex-col items-center gap-3 py-8 text-center">
        <div className="flex h-10 w-10 items-center justify-center rounded-full bg-red-100 text-red-700">
          <AlertTriangle className="h-5 w-5" />
        </div>
        <div>
          <div className="font-semibold text-red-900">{title}</div>
          <div className="mt-1 max-w-sm break-words text-sm text-red-700">{message}</div>
        </div>
        {onRetry && (
          <Button variant="outline" size="sm" onClick={onRetry}>
            <RefreshCw className="h-3.5 w-3.5" /> Retry
          </Button>
        )}
      </CardContent>
    </Card>
  );
  if (full) return <div className="flex h-full items-center justify-center py-12">{body}</div>;
  return <div className="py-6">{body}</div>;
}
