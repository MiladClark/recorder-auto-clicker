import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import { DesktopSurface } from './components/DesktopSurface';
import { StartupShell } from './components/StartupShell';
import './index.css';

ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(
  <React.StrictMode>
    {new URLSearchParams(location.search).has('surface') ? <DesktopSurface surface={new URLSearchParams(location.search).get('surface')!} /> : <StartupShell><App /></StartupShell>}
  </React.StrictMode>
);
