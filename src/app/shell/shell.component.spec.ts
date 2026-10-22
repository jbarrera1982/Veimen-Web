import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { provideRouter, Router } from '@angular/router';
import { of } from 'rxjs';
import { ShellComponent } from './shell.component';
import { environment } from '../../environments/environment';
import { AuthService, UserDto } from '../services/auth.service';
import { Client } from '../services/clients.service';
import { ClientContextService } from '../services/client-context.service';
import { PERMISSIONS, PermissionsService } from '../services/permissions.service';

const CLIENTS_URL = `${environment.apiBaseUrl}/api/clients`;

const USER: UserDto = {
  userId: 1,
  username: 'jcb',
  email: 'jcb@veimen.net',
  fullName: 'Juan Carlos',
  active: true,
  clientId: null,
  lastLoginAt: null,
};

function client(partial: Partial<Client> = {}): Client {
  return {
    clientId: 1,
    name: 'Cliente Demo',
    inboundEmail: '',
    outboundEmail: '',
    analystEmail: '',
    projectId: 'proj-demo',
    active: true,
    ...partial,
  };
}

const ALL_PERMISSIONS = [
  PERMISSIONS.dashboardRead,
  PERMISSIONS.menuTokens,
  PERMISSIONS.usageRead,
  PERMISSIONS.serviceRequestsRead,
  PERMISSIONS.clientsRead,
  PERMISSIONS.clientsWrite,
  PERMISSIONS.promptsRead,
  PERMISSIONS.promptsWrite,
  PERMISSIONS.usersManage,
  PERMISSIONS.businessModelRead,
];

describe('ShellComponent', () => {
  let fixture: any;
  let component: ShellComponent;
  let httpTesting: HttpTestingController;

  function seedPermissions(codes: readonly string[]): void {
    const permissions = TestBed.inject(PermissionsService);
    permissions.permissions.set(codes);
    permissions.loaded.set(true);
  }

  beforeEach(async () => {
    localStorage.clear();

    await TestBed.configureTestingModule({
      imports: [ShellComponent],
      providers: [provideRouter([]), provideHttpClient(), provideHttpClientTesting()],
    }).compileComponents();

    httpTesting = TestBed.inject(HttpTestingController);
    seedPermissions(ALL_PERMISSIONS);
    TestBed.inject(AuthService).currentUser.set({ ...USER });

    fixture = TestBed.createComponent(ShellComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();

    // El shell carga los clientes en ngOnInit para poblar el filtro global.
    httpTesting.expectOne(CLIENTS_URL).flush([]);
  });

  afterEach(() => {
    httpTesting.verify();
  });

  it('should create the component', () => {
    expect(component).toBeTruthy();
  });

  it('should render the client selector with the active clients for an unassociated user', () => {
    const clientContext = TestBed.inject(ClientContextService);
    clientContext.clients.set([
      client({ clientId: 1, name: 'Acme' }),
      client({ clientId: 2, name: 'Beta', active: false }),
      client({ clientId: 3, name: 'Zeta' }),
    ]);
    fixture.detectChanges();

    const select = fixture.nativeElement.querySelector('.client-select');
    expect(select).toBeTruthy();
    expect(fixture.nativeElement.querySelector('.client-filter-static')).toBeNull();

    // Solo clientes activos, ordenados por nombre, con "Todos" primero.
    const options = Array.from<HTMLOptionElement>(select.querySelectorAll('option')).map((o) =>
      o.textContent?.trim(),
    );
    expect(options).toEqual(['Todos', 'Acme', 'Zeta']);
  });

  it('should update the global selection when the menu selector changes', () => {
    const clientContext = TestBed.inject(ClientContextService);
    clientContext.clients.set([
      client({ clientId: 1, name: 'Acme' }),
      client({ clientId: 2, name: 'Beta' }),
    ]);
    fixture.detectChanges();

    const select = fixture.nativeElement.querySelector('.client-select') as HTMLSelectElement;
    select.value = '2';
    select.dispatchEvent(new Event('change'));
    fixture.detectChanges();

    expect(clientContext.selectedClient()?.clientId).toBe(2);

    select.value = '';
    select.dispatchEvent(new Event('change'));
    fixture.detectChanges();

    expect(clientContext.selectedClient()).toBeNull();
  });

  it('should show the associated client name (no selector) when the user has a clientId', () => {
    const auth = TestBed.inject(AuthService);
    const clientContext = TestBed.inject(ClientContextService);
    auth.currentUser.set({ ...USER, clientId: 5 });

    clientContext.load();
    httpTesting.expectOne(CLIENTS_URL).flush([
      {
        clientId: 5,
        name: 'Acme Corp',
        inboundEmail: '',
        outboundEmail: '',
        analystEmail: '',
        projectId: 'proj-acme',
        active: true,
      },
    ]);
    fixture.detectChanges();

    expect(fixture.nativeElement.querySelector('.client-select')).toBeNull();
    expect(fixture.nativeElement.querySelector('.client-filter-static').textContent.trim()).toBe(
      'Acme Corp',
    );
    expect(clientContext.selectedClient()?.clientId).toBe(5);
  });

  it('should render the navigation links grouped by category', () => {
    const links = fixture.nativeElement.querySelectorAll('.sidebar-nav .nav-link');
    expect(links.length).toBe(8);
    expect(links[0].textContent.trim()).toBe('Dashboard');
    expect(links[1].textContent.trim()).toBe('Uso IA');
    expect(links[2].textContent.trim()).toBe('Consumo de tokens');
    expect(links[3].textContent.trim()).toBe('Requerimientos');
    expect(links[4].textContent.trim()).toBe('Clientes');
    expect(links[5].textContent.trim()).toBe('Usuarios');
    expect(links[6].textContent.trim()).toBe('Prompts');
    expect(links[7].textContent.trim()).toBe('Modelo de negocios');

    const titles = Array.from<Element>(
      fixture.nativeElement.querySelectorAll('.sidebar-nav .nav-group-title'),
    ).map((title) => title.textContent?.trim());
    expect(titles).toEqual(['Monitorear', 'Administrar']);
  });

  it('should link the business model entry to its own route', () => {
    const links = fixture.nativeElement.querySelectorAll('.sidebar-nav .nav-link');
    const link = links[7];

    expect(link.getAttribute('href')).toBe('/business-model');
    expect(link.hasAttribute('target')).toBe(false);
  });

  it('should link the Clientes entry to its route', () => {
    const links = fixture.nativeElement.querySelectorAll('.sidebar-nav .nav-link');
    expect(links[4].getAttribute('href')).toBe('/clientes');
  });

  it('should link the Uso OpenAI entry to the unified usage route', () => {
    const links = fixture.nativeElement.querySelectorAll('.sidebar-nav .nav-link');
    expect(links[1].getAttribute('href')).toBe('/uso-openai');
  });

  it('should hide the Uso OpenAI link without the usage.read permission', () => {
    const permissions = TestBed.inject(PermissionsService);
    permissions.permissions.set([PERMISSIONS.promptsRead]);
    fixture.detectChanges();

    const texts = Array.from<Element>(
      fixture.nativeElement.querySelectorAll('.sidebar-nav .nav-link'),
    ).map((link) => link.textContent?.trim());
    expect(texts).toEqual(['Prompts']);
  });

  it('should hide the token usage link without the menu.tokens permission', () => {
    const permissions = TestBed.inject(PermissionsService);
    // Tiene tokens.read (acceso a la ruta) pero no menu.tokens: no debe verse el enlace.
    permissions.permissions.set([PERMISSIONS.tokensRead, PERMISSIONS.promptsRead]);
    fixture.detectChanges();

    const texts = Array.from<Element>(
      fixture.nativeElement.querySelectorAll('.sidebar-nav .nav-link'),
    ).map((link) => link.textContent?.trim());
    expect(texts).not.toContain('Consumo de tokens');
  });

  it('should hide the business model link without the businessModel.read permission', () => {
    const permissions = TestBed.inject(PermissionsService);
    permissions.permissions.set([PERMISSIONS.promptsRead]);
    fixture.detectChanges();

    const texts = Array.from<Element>(
      fixture.nativeElement.querySelectorAll('.sidebar-nav .nav-link'),
    ).map((link) => link.textContent?.trim());
    expect(texts).not.toContain('Modelo de negocios');
  });

  it('should hide the navigation links the user has no permission for', () => {
    const permissions = TestBed.inject(PermissionsService);
    permissions.permissions.set([PERMISSIONS.promptsRead]);
    fixture.detectChanges();

    const links = fixture.nativeElement.querySelectorAll('.sidebar-nav .nav-link');
    expect(links.length).toBe(1);
    expect(links[0].textContent.trim()).toBe('Prompts');

    permissions.permissions.set([]);
    fixture.detectChanges();

    const remaining = fixture.nativeElement.querySelectorAll('.sidebar-nav .nav-link');
    expect(remaining.length).toBe(0);
  });

  it('should hide the Clientes link without the clients.read permission', () => {
    const permissions = TestBed.inject(PermissionsService);
    permissions.permissions.set([PERMISSIONS.promptsRead]);
    fixture.detectChanges();

    const texts = Array.from<Element>(
      fixture.nativeElement.querySelectorAll('.sidebar-nav .nav-link'),
    ).map((link) => link.textContent?.trim());
    expect(texts).not.toContain('Clientes');
  });

  it('should hide the Administrar category when the user has no manage permission', () => {
    const permissions = TestBed.inject(PermissionsService);
    permissions.permissions.set([PERMISSIONS.dashboardRead]);
    fixture.detectChanges();

    const titles = Array.from<Element>(
      fixture.nativeElement.querySelectorAll('.sidebar-nav .nav-group-title'),
    ).map((title) => title.textContent?.trim());
    expect(titles).toEqual(['Monitorear']);
  });

  it('should hide the Monitorear category and its links without any monitoring permission', () => {
    const permissions = TestBed.inject(PermissionsService);
    permissions.permissions.set([PERMISSIONS.promptsRead]);
    fixture.detectChanges();

    const titles = Array.from<Element>(
      fixture.nativeElement.querySelectorAll('.sidebar-nav .nav-group-title'),
    ).map((title) => title.textContent?.trim());
    expect(titles).toEqual(['Administrar']);
  });

  it('should start with the menu closed', () => {
    expect(component.isMenuOpen()).toBe(false);
    expect(fixture.nativeElement.querySelector('.app-shell').classList.contains('menu-open')).toBe(
      false,
    );
  });

  it('should open and close the menu with the toggle button (manual close)', () => {
    const toggle = fixture.nativeElement.querySelector('.menu-toggle');
    expect(toggle.getAttribute('aria-expanded')).toBe('false');

    toggle.click();
    fixture.detectChanges();

    expect(component.isMenuOpen()).toBe(true);
    expect(toggle.getAttribute('aria-expanded')).toBe('true');
    expect(fixture.nativeElement.querySelector('.app-shell').classList.contains('menu-open')).toBe(
      true,
    );

    toggle.click();
    fixture.detectChanges();

    expect(component.isMenuOpen()).toBe(false);
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
  });

  it('should render a backdrop that does not close the menu on click', () => {
    const backdrop = fixture.nativeElement.querySelector('.backdrop');
    expect(backdrop).toBeTruthy();

    const toggle = fixture.nativeElement.querySelector('.menu-toggle');
    toggle.click();
    fixture.detectChanges();

    backdrop.click();
    fixture.detectChanges();

    expect(component.isMenuOpen()).toBe(true);
  });

  it('should log out and navigate to login', () => {
    const auth = TestBed.inject(AuthService);
    const logoutSpy = vi.spyOn(auth, 'logout').mockReturnValue(of(undefined));
    const router = TestBed.inject(Router);
    const navigateSpy = vi.spyOn(router, 'navigate').mockResolvedValue(true);

    const logoutBtn = fixture.nativeElement.querySelector('.logout');
    logoutBtn.click();

    expect(logoutSpy).toHaveBeenCalledTimes(1);
    expect(navigateSpy).toHaveBeenCalledWith(['/login']);
  });
});
