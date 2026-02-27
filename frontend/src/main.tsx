import '../index.css';
import React from 'react';
import { createRoot } from 'react-dom/client';
import AppRoot from './app/AppRoot';

const rootElement = document.getElementById('root');
if (!rootElement) {
  throw new Error('Could not find root element to mount to');
}

createRoot(rootElement).render(
  <React.StrictMode>
    <AppRoot />
  </React.StrictMode>
);
