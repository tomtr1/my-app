import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import 'leaflet/dist/leaflet.css';
import './styles/app.css';
import App from './App';
import { useApp } from './store/app';

void useApp.getState().init();

// Dev-only handle for debugging & UI tests (stripped from production builds).
if (import.meta.env.DEV) (window as unknown as Record<string, unknown>).__lifedash = useApp;

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
