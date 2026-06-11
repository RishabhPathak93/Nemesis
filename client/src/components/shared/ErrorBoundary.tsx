import { Component, ErrorInfo, ReactNode } from 'react';

interface Props {
  children: ReactNode;
  fallback?: ReactNode;
}
interface State {
  error: Error | null;
}

/**
 * L-09: top-level error boundary. A render-time throw (e.g. an unexpected
 * server/LLM-shaped payload) previously unmounted the whole SPA, leaving a
 * blank page with no recovery path. This catches it and offers a reload.
 */
export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    // eslint-disable-next-line no-console
    console.error('Unhandled UI error:', error, info.componentStack);
  }

  render(): ReactNode {
    if (this.state.error) {
      if (this.props.fallback) return this.props.fallback;
      return (
        <div className="flex h-full min-h-screen flex-col items-center justify-center gap-4 bg-background p-6 text-center">
          <div className="text-lg font-semibold text-foreground">Something went wrong</div>
          <p className="max-w-md text-sm text-muted-foreground">
            The page hit an unexpected error. Reloading usually fixes it. If it keeps happening,
            let your administrator know.
          </p>
          <button
            type="button"
            onClick={() => window.location.reload()}
            className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90"
          >
            Reload
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}
