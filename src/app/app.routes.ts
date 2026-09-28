import { Routes } from '@angular/router';
import { DashboardComponent } from './dashboard/dashboard.component';
import { PromptsListComponent } from './prompts/prompts-list.component';
import { ServiceRequestComponent } from './service-request/service-request.component';
import { ShellComponent } from './shell/shell.component';
import { HomeRedirectComponent } from './shell/home-redirect.component';
import { LoginComponent } from './auth/login.component';
import { ChangePasswordComponent } from './auth/change-password.component';
import { AccessDeniedComponent } from './auth/access-denied.component';
import { UsersComponent } from './users/users.component';
import { UserFormComponent } from './users/user-form.component';
import { PromptFormComponent } from './prompts/prompt-form.component';
import { BusinessModelComponent } from './business-model/business-model.component';
import { permissionGuard } from './auth/permission.guard';
import { PERMISSIONS } from './services/permissions.service';

export const routes: Routes = [
  { path: 'login', component: LoginComponent },
  {
    path: '',
    component: ShellComponent,
    canActivate: [
      permissionGuard(
        PERMISSIONS.dashboardRead,
        PERMISSIONS.serviceRequestsRead,
        PERMISSIONS.promptsRead,
        PERMISSIONS.usersManage,
        PERMISSIONS.businessModelRead,
      ),
    ],
    children: [
      { path: '', pathMatch: 'full', component: HomeRedirectComponent },
      {
        path: 'dashboard',
        component: DashboardComponent,
        canActivate: [permissionGuard(PERMISSIONS.dashboardRead)],
      },
      {
        path: 'service-request',
        component: ServiceRequestComponent,
        canActivate: [permissionGuard(PERMISSIONS.serviceRequestsRead)],
      },
      {
        path: 'prompts',
        component: PromptsListComponent,
        canActivate: [permissionGuard(PERMISSIONS.promptsRead)],
      },
      {
        path: 'prompts/nuevo',
        component: PromptFormComponent,
        canActivate: [permissionGuard(PERMISSIONS.promptsWrite)],
      },
      {
        path: 'prompts/:id',
        component: PromptFormComponent,
        canActivate: [permissionGuard(PERMISSIONS.promptsWrite)],
      },
      {
        path: 'usuarios',
        component: UsersComponent,
        canActivate: [permissionGuard(PERMISSIONS.usersManage)],
      },
      {
        path: 'usuarios/nuevo',
        component: UserFormComponent,
        canActivate: [permissionGuard(PERMISSIONS.usersManage)],
      },
      {
        path: 'usuarios/:id',
        component: UserFormComponent,
        canActivate: [permissionGuard(PERMISSIONS.usersManage)],
      },
      {
        path: 'business-model',
        component: BusinessModelComponent,
        canActivate: [permissionGuard(PERMISSIONS.businessModelRead)],
      },
      { path: 'cambiar-contrasena', component: ChangePasswordComponent },
      { path: 'sin-acceso', component: AccessDeniedComponent },
    ],
  },
  { path: '**', redirectTo: '', pathMatch: 'full' },
];
