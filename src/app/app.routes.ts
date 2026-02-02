import { Routes } from '@angular/router';

export const routes: Routes = [
    {
        path: 'home',
        loadComponent: () => import('../app/components/home/home').then(c => c.Home),
        title: 'Home'
    },
    {
        path: '**',
        redirectTo: 'home'
    }
];
