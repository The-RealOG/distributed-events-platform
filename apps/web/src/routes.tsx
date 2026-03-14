import { Link, Navigate, type RouteObject } from 'react-router';
import { AppLayout } from './features/auth/AppLayout';
import { LoginPage } from './features/auth/LoginPage';
import { BoardPage } from './features/board/BoardPage';
import { TaskDialog } from './features/tasks/TaskDialog';
import { WorkspacePage } from './features/workspaces/WorkspacePage';
import { WorkspacesPage } from './features/workspaces/WorkspacesPage';

export const routes: RouteObject[] = [
  { path: '/login', element: <LoginPage /> },
  {
    element: <AppLayout />,
    children: [
      { path: '/', element: <Navigate to="/workspaces" replace /> },
      { path: '/workspaces', element: <WorkspacesPage /> },
      { path: '/workspaces/:workspaceId', element: <WorkspacePage /> },
      {
        path: '/projects/:projectId',
        element: <BoardPage />,
        children: [{ path: 'tasks/:taskId', element: <TaskDialog /> }],
      },
      {
        path: '*',
        element: (
          <p>
            Page not found. <Link to="/workspaces">Go to workspaces</Link>
          </p>
        ),
      },
    ],
  },
];
