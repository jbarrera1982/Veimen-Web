import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { provideRouter, Router } from '@angular/router';
import { of } from 'rxjs';
import { ShellComponent } from './shell.component';
import { AuthService } from '../services/auth.service';
import { PERMISSIONS, PermissionsService } from '../services/permissions.service';

const ALL_PERMISSIONS = [
  PERMISSIONS.dashboardRead,
  PERMISSIONS.tokensRead,
  PERMISSIONS.usageRead,
  PERMISSIONS.serviceRequestsRead,
  PERMISSIONS.promptsRead,
  PERMISSIONS.promptsWrite,
  PERMISSIONS.usersManage,
  PERMISSIONS.businessModelRead,
];

describe('ShellComponent', () => {
  let fixture: any;
  let component: ShellComponent;

  function seedPermissions(codes: readonly string[]): void {
    const permissions = TestBed.inject(PermissionsService);
    permissions.permissions.set(codes);
    permissions.loaded.set(true);
  }

  beforeEach(async () => {
    localStorage.clear();

    await TestBed.configureTestingModule({
      imports: [ShellComponent],
      providers: [provideRouter([]), provideHttpClient()],
    }).compileComponents();

    seedPermissions(ALL_PERMISSIONS);

    fixture = TestBed.createComponent(ShellComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create the component', () => {
    expect(component).toBeTruthy();
  });

  it('should render the navigation links', () => {
    const links = fixture.nativeElement.querySelectorAll('.sidebar-nav .nav-link');
    expect(links.length).toBe(8);
    expect(links[0].textContent.trim()).toBe('Dashboard');
    expect(links[1].textContent.trim()).toBe('Consumo de tokens');
    expect(links[2].textContent.trim()).toBe('Consumo');
    expect(links[3].textContent.trim()).toBe('Costos');
    expect(links[4].textContent.trim()).toBe('Requerimientos');
    expect(links[5].textContent.trim()).toBe('Prompts');
    expect(links[6].textContent.trim()).toBe('Usuarios');
    expect(links[7].textContent.trim()).toBe('Modelo de negocios');
  });

  it('should link the business model entry to its own route', () => {
    const links = fixture.nativeElement.querySelectorAll('.sidebar-nav .nav-link');
    const link = links[7];

    expect(link.getAttribute('href')).toBe('/business-model');
    expect(link.hasAttribute('target')).toBe(false);
  });

  it('should link the Consumo and Costos entries to the usage routes', () => {
    const links = fixture.nativeElement.querySelectorAll('.sidebar-nav .nav-link');
    expect(links[2].getAttribute('href')).toBe('/consumo');
    expect(links[3].getAttribute('href')).toBe('/costos');
  });

  it('should hide the Consumo and Costos links without the usage.read permission', () => {
    const permissions = TestBed.inject(PermissionsService);
    permissions.permissions.set([PERMISSIONS.promptsRead]);
    fixture.detectChanges();

    const texts = Array.from<Element>(
      fixture.nativeElement.querySelectorAll('.sidebar-nav .nav-link'),
    ).map((link) => link.textContent?.trim());
    expect(texts).toEqual(['Prompts']);
  });

  it('should hide the token usage link without the tokens.read permission', () => {
    const permissions = TestBed.inject(PermissionsService);
    permissions.permissions.set([PERMISSIONS.promptsRead]);
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

    expect(fixture.nativeElement.querySelectorAll('.sidebar-nav .nav-link').length).toBe(0);
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
