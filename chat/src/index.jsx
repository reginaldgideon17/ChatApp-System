import React from 'react';
import ReactDOM from 'react-dom/client';
import './index.css';
import './css/Theme.css';
import App from './App.jsx';
import './css/Style.css'; // must come after App so the new looks sit on top of every page's CSS
import reportWebVitals from './reportWebVitals';
import { getSavedTheme } from './theme';

// Apply the saved theme (light by default) before the first paint
document.documentElement.dataset.theme = getSavedTheme();
document.documentElement.dataset.style = "morph";

const root = ReactDOM.createRoot(document.getElementById('root'));
root.render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);

reportWebVitals();
