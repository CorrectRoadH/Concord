import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { createBrowserRouter, RouterProvider } from 'react-router-dom';
import '@mdxeditor/editor/style.css';
import 'react-diff-view/style/index.css';
import './styles.css';
import { App } from './app.tsx';
import type { ReadBlockers } from './lib/draft-navigation.ts';
import { initializeTheme } from './theme.tsx';

if (import.meta.env.DEV) void import('react-grab');

initializeTheme();

const readBlockers: ReadBlockers = () => router.state.blockers.values();
const router = createBrowserRouter([{ path: '*', element: <App readBlockers={readBlockers} /> }]);
const target = document.getElementById('root');
if (!target) throw new Error('Missing application root.');
createRoot(target).render(<StrictMode><RouterProvider router={router} /></StrictMode>);
