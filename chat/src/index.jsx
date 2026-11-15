import React from 'react';
import ReactDOM from 'react-dom/client';
import './index.css';
import './css/Theme.css';
import App from './App.jsx';
import reportWebVitals from './reportWebVitals';
import { getSavedTheme } from './theme';

// Apply the saved theme (light by default) before the first paint
document.documentElement.dataset.theme = getSavedTheme();

const root = ReactDOM.createRoot(document.getElementById('root'));
root.render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);

reportWebVitals();
