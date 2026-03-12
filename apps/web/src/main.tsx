import React from 'react';
import ReactDOM from 'react-dom/client';

import { App } from './App.js';
import { AppProviders, createAppQueryClient } from './providers.js';
import './styles.css';

const queryClient = createAppQueryClient();

ReactDOM.createRoot(document.getElementById('root')!).render(
  <AppProviders client={queryClient}>
    <App />
  </AppProviders>,
);
