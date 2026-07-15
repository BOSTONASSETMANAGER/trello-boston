import { Routes } from '@angular/router';
import { authGuard, guestGuard } from './core/auth.guard';

export const routes: Routes = [
  { path: '', pathMatch: 'full', redirectTo: 'boards' },
  {
    path: 'login',
    canActivate: [guestGuard],
    loadComponent: () => import('./features/auth/auth.component').then((m) => m.AuthComponent),
  },
  {
    path: 'boards',
    canActivate: [authGuard],
    loadComponent: () =>
      import('./features/boards-home/boards-home.component').then((m) => m.BoardsHomeComponent),
  },
  {
    path: 'my-cards',
    canActivate: [authGuard],
    loadComponent: () =>
      import('./features/my-cards/my-cards.component').then((m) => m.MyCardsComponent),
  },
  {
    path: 'usuarios',
    canActivate: [authGuard],
    loadComponent: () =>
      import('./features/admin/users-admin.component').then((m) => m.UsersAdminComponent),
  },
  {
    path: 'board/:id',
    canActivate: [authGuard],
    loadComponent: () =>
      import('./features/board/board-view.component').then((m) => m.BoardViewComponent),
    children: [
      {
        path: 'card/:cardId',
        loadComponent: () =>
          import('./features/card-detail/card-detail.component').then((m) => m.CardDetailComponent),
      },
    ],
  },
  { path: '**', redirectTo: 'boards' },
];
