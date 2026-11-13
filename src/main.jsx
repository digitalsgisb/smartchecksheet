import React from 'react';
import { createRoot } from 'react-dom/client';
import App from './App.jsx';
import './styles.css';
import './operator-controls.css';
import './tablet-polish.css';
import './smooth-controls.css';
import './black-theme.css';
import './sidebar.css';
import './design-system.css';

createRoot(document.getElementById('root')).render(<React.StrictMode><App /></React.StrictMode>);
