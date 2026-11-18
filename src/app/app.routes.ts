import { Component } from '@angular/core';
import { Routes } from '@angular/router';
import { ForgotPasswordComponent } from './auth/forgot-password.component';
import { ResetPasswordComponent } from './auth/reset-password.component';
import { DevMailboxComponent } from './dev/mailbox.component';

/** Rutas sin contenido propio: el panel y el login los dibuja AppComponent según el estado de sesión. */
@Component({ selector: 'app-blank', standalone: true, template: '' })
export class BlankRouteComponent {}

export const routes: Routes = [
  { path: 'forgot-password', component: ForgotPasswordComponent, title: 'Recuperar contraseña · EnRuta' },
  { path: 'reset-password', component: ResetPasswordComponent, title: 'Nueva contraseña · EnRuta' },
  // Vista de repartidor (mobile-first): carga diferida; no forma parte del panel de administración.
  { path: 'repartidor/vincular', loadComponent: () => import('./driver/driver-link.component').then((m) => m.DriverLinkComponent), title: 'Vincular dispositivo · EnRuta' },
  { path: 'repartidor', loadComponent: () => import('./driver/driver-home.component').then((m) => m.DriverHomeComponent), title: 'Mi ruta · EnRuta' },
  { path: 'dev/correo', component: DevMailboxComponent, title: 'Correo local (desarrollo) · EnRuta' },
  { path: 'login', component: BlankRouteComponent, title: 'Iniciar sesión · EnRuta' },
  { path: '**', component: BlankRouteComponent },
];
