import { Routes } from '@angular/router';

export const routes: Routes = [
    {
        path: 'home',
        loadComponent: () => import('../app/components/home/home').then(c => c.Home),
        title: 'Home'
    },
    {
        path: 'callback',
        loadComponent: () => import('../app/components/auth-callback/auth-callback').then(c => c.AuthCallback),
        title: 'Auth callback'
    },
    {
        path: '**',
        redirectTo: 'home'
    }
];
