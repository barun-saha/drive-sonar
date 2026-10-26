import React from "react";
import ReactDOM from "react-dom/client";
import { MantineProvider } from '@mantine/core';
import { ModalsProvider } from '@mantine/modals';
import { LucideProvider } from 'lucide-react';
import App from "./App";
import { theme, cssVariablesResolver } from './theme';

// Core Mantine styles (Must be imported before custom styles)
import '@mantine/core/styles.css';
import '@mantine/charts/styles.css';

import './App.css';

ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(
  <React.StrictMode>
    <MantineProvider theme={theme} cssVariablesResolver={cssVariablesResolver} defaultColorScheme="dark">
      <ModalsProvider>
        {/* One default icon size and stroke for the whole app */}
        <LucideProvider size={16} strokeWidth={1.75}>
          <App />
        </LucideProvider>
      </ModalsProvider>
    </MantineProvider>
  </React.StrictMode>
);
