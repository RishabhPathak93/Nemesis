import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { Toaster } from 'sonner';
import App from './App';
import { ErrorBoundary } from './components/shared/ErrorBoundary';
import { initTheme, useThemeStore } from './store/theme';
import './index.css';

// Apply the persisted/system theme and wire OS-preference syncing before render.
initTheme();

/** Keeps the sonner toasts in step with the app theme. */
function ThemedToaster() {
  const resolved = useThemeStore((s) => s.resolved);
  return <Toaster position="top-right" richColors closeButton theme={resolved} />;
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <ErrorBoundary>
      <BrowserRouter>
        <App />
        <ThemedToaster />
      </BrowserRouter>
    </ErrorBoundary>
  </React.StrictMode>,
);
