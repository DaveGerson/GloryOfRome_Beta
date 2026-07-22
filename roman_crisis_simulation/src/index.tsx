
import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import ErrorBoundary from './components/ErrorBoundary';
import { GameProvider } from './state/GameContext';
// The Glory of Rome design system: tokens (fonts/colors/typography/spacing/
// effects) + component classes. Nox Romae (nocturne.css) is lazy-loaded by
// App's LVX/NOX switch.
import './design/styles.css';

const rootElement = document.getElementById('root');
if (!rootElement) {
  throw new Error("Could not find root element to mount to");
}

const root = ReactDOM.createRoot(rootElement);
root.render(
  <React.StrictMode>
    <ErrorBoundary>
      <GameProvider>
        <App />
      </GameProvider>
    </ErrorBoundary>
  </React.StrictMode>
);
