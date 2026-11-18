import { ValidateFormDirective } from './core/validate-form.directive';
import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { NavigationEnd, Router, RouterOutlet } from '@angular/router';
import { filter } from 'rxjs';
import { FormsModule } from '@angular/forms';
import { EnrutaState } from './core/enruta-state.service';
import { ScreenBoundaryComponent } from './core/screen-boundary.component';
import { LoginScreenComponent } from './screens/login-screen.component';
import { VerifyScreenComponent } from './screens/verify-screen.component';
import { RecoverScreenComponent } from './screens/recover-screen.component';
import { RegisterScreenComponent } from './screens/register-screen.component';
import { PlanScreenComponent } from './screens/plan-screen.component';
import { SubmittedScreenComponent } from './screens/submitted-screen.component';
import { PermissionScreenComponent } from './screens/permission-screen.component';
import { ExpiredScreenComponent } from './screens/expired-screen.component';
import { DashboardScreenComponent } from './screens/dashboard-screen.component';
import { RoutesScreenComponent } from './screens/routes-screen.component';
import { CartaPorteScreenComponent } from './screens/cartaporte-screen.component';
import { PlannerScreenComponent } from './screens/planner-screen.component';
import { ApprovalsScreenComponent } from './screens/approvals-screen.component';
import { ReportsScreenComponent } from './screens/reports-screen.component';
import { SettlementsScreenComponent } from './screens/settlements-screen.component';
import { AuditScreenComponent } from './screens/audit-screen.component';
import { ConfigurationScreenComponent } from './screens/configuration-screen.component';
import { ParametersScreenComponent } from './screens/parameters-screen.component';
import { FormsScreenComponent } from './screens/forms-screen.component';
import { PublishScreenComponent } from './screens/publish-screen.component';
import { BrandScreenComponent } from './screens/brand-screen.component';
import { ImportScreenComponent } from './screens/import-screen.component';
import { ProductsScreenComponent } from './screens/products-screen.component';
import { ClientsScreenComponent } from './screens/clients-screen.component';
import { PricesScreenComponent } from './screens/prices-screen.component';
import { UsersScreenComponent } from './screens/users-screen.component';
import { DevicesScreenComponent } from './screens/devices-screen.component';
import { ProfileScreenComponent } from './screens/profile-screen.component';
import { NotificationsScreenComponent } from './screens/notifications-screen.component';
import { ContextScreenComponent } from './screens/context-screen.component';

@Component({
  selector: 'app-root',
  standalone: true,
  // Transitorio (Fase 2.A): Angular 22 usa OnPush por defecto y estas pantallas leen campos simples de EnrutaState.
  // Se migran a signals + OnPush pantalla por pantalla; mientras tanto se actualizan en cada turno de la zona.
  changeDetection: ChangeDetectionStrategy.Default,
  imports: [FormsModule, ScreenBoundaryComponent, ValidateFormDirective, RouterOutlet],
  templateUrl: './app.component.html',
  styleUrl: './app.component.css',
})
export class AppComponent {
  readonly state = inject(EnrutaState);
  private readonly router = inject(Router);
  /** Ruta activa de recuperación de contraseña ('forgot-password' | 'reset-password') o ''. */
  routedAuth = '';

  constructor() {
    this.router.events.pipe(filter((e): e is NavigationEnd => e instanceof NavigationEnd)).subscribe((e) => {
      const path = e.urlAfterRedirects.split(/[?#]/)[0].replace(/^\/+|\/+$/g, '');
      this.routedAuth = path === 'forgot-password' || path === 'reset-password' ? path : path === 'dev/correo' ? 'dev-mailbox' : '';
      if (path === 'login' && !this.state.authenticated) this.state.authView = 'login';
    });
  }
  readonly screens = {
    login: LoginScreenComponent,
    verify: VerifyScreenComponent,
    recover: RecoverScreenComponent,
    register: RegisterScreenComponent,
    plan: PlanScreenComponent,
    submitted: SubmittedScreenComponent,
    permission: PermissionScreenComponent,
    expired: ExpiredScreenComponent,
    dashboard: DashboardScreenComponent,
    routes: RoutesScreenComponent,
    cartaporte: CartaPorteScreenComponent,
    planner: PlannerScreenComponent,
    approvals: ApprovalsScreenComponent,
    reports: ReportsScreenComponent,
    settlements: SettlementsScreenComponent,
    audit: AuditScreenComponent,
    configuration: ConfigurationScreenComponent,
    parameters: ParametersScreenComponent,
    forms: FormsScreenComponent,
    publish: PublishScreenComponent,
    brand: BrandScreenComponent,
    import: ImportScreenComponent,
    products: ProductsScreenComponent,
    clients: ClientsScreenComponent,
    prices: PricesScreenComponent,
    users: UsersScreenComponent,
    devices: DevicesScreenComponent,
    profile: ProfileScreenComponent,
    notifications: NotificationsScreenComponent,
    context: ContextScreenComponent,
  };
}
