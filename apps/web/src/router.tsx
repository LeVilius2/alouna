import { createBrowserRouter, type RouteObject } from 'react-router';
import { HomePage } from './HomePage';
import { EditorPage } from './editor/EditorPage';
import { NavigatorPage } from './navigator/NavigatorPage';
import { NotFoundPage } from './NotFoundPage';

export const routes: RouteObject[] = [
  { path: '/', element: <HomePage /> },
  { path: '/editor', element: <EditorPage /> },
  { path: '/navigate', element: <NavigatorPage /> },
  { path: '*', element: <NotFoundPage /> },
];

export const router = createBrowserRouter(routes);
