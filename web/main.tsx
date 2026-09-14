import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { createBrowserRouter, RouterProvider } from 'react-router-dom';
import '@mdxeditor/editor/style.css';
import 'react-diff-view/style/index.css';
import './styles.css';
import { App } from './app';
import { initializeTheme } from './theme';

if (import.meta.env.DEV) void import('react-grab');

initializeTheme();

const router = createBrowserRouter([{ path: '*', element: <App /> }]);
const target = document.getElementById('root');
if (!target) throw new Error('Missing application root.');
createRoot(target).render(<StrictMode><RouterProvider router={router} /></StrictMode>);
