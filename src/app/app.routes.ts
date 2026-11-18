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
  { path: 'dev/correo', component: DevMailboxComponent, title: 'Correo local (desarrollo) · EnRuta' },
  { path: 'login', component: BlankRouteComponent, title: 'Iniciar sesión · EnRuta' },
  { path: '**', component: BlankRouteComponent },
];
