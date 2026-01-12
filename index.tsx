// This MUST be the first thing in the file
(window as any).process = {
  env: {
    API_KEY: import.meta.env.VITE_GEMINI_API_KEY
  }
};

import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';

const rootElement = document.getElementById('root');
if (!rootElement) {
  throw new Error("Could not find root element to mount to");
}

const root = ReactDOM.createRoot(rootElement);
root.render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
