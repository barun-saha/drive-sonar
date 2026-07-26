import React from "react";
import ReactDOM from "react-dom/client";
import { MantineProvider } from '@mantine/core';
import { ModalsProvider } from '@mantine/modals';
import App from "./App";

// Core Mantine styles (Must be imported before custom styles)
import '@mantine/core/styles.css';
import '@mantine/charts/styles.css';

import './App.css';

ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(
  <React.StrictMode>
    <MantineProvider defaultColorScheme="dark">
      <ModalsProvider>
        <App />
      </ModalsProvider>
    </MantineProvider>
  </React.StrictMode>
);
