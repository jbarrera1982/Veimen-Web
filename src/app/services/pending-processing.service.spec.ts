import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { PENDING_PROCESSING_POLL_MS, PendingProcessingService } from './pending-processing.service';
import { PERMISSIONS, PermissionsService } from './permissions.service';
import { ClientContextService } from './client-context.service';
import { Client } from './clients.service';
import { environment } from '../../environments/environment';

const PENDING_URL = `${environment.apiBaseUrl}/api/mail/pending-count`;

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

describe('PendingProcessingService', () => {
  let service: PendingProcessingService;
  let httpTesting: HttpTestingController;
  let permissions: PermissionsService;
  let clientContext: ClientContextService;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });
    service = TestBed.inject(PendingProcessingService);
    httpTesting = TestBed.inject(HttpTestingController);
    permissions = TestBed.inject(PermissionsService);
    clientContext = TestBed.inject(ClientContextService);
    permissions.permissions.set([PERMISSIONS.mailScan]);
    permissions.loaded.set(true);
  });

  afterEach(() => {
    service.stop();
    httpTesting.verify();
    vi.useRealTimers();
  });

  it('should poll every 30 minutes', () => {
    expect(PENDING_PROCESSING_POLL_MS).toBe(30 * 60_000);
  });

  it('should count pending mails without a client filter by default', () => {
    service.refresh();

    const req = httpTesting.expectOne((r) => r.url === PENDING_URL);
    expect(req.request.method).toBe('GET');
    expect(req.request.params.has('client_id')).toBe(false);
    req.flush({ count: 5 });

    expect(service.count()).toBe(5);
  });

  it('should filter the count by the selected client', () => {
    clientContext.clients.set([client({ clientId: 7 })]);
    clientContext.selectClient(7);

    service.refresh();

    const req = httpTesting.expectOne((r) => r.url === PENDING_URL);
    expect(req.request.params.get('client_id')).toBe('7');
    req.flush({ count: 2 });

    expect(service.count()).toBe(2);
  });

  it('should not call the API without the mail.scan permission', () => {
    permissions.permissions.set([]);

    service.refresh();

    expect(service.count()).toBe(0);
  });

  it('should keep the last value when the count request fails', () => {
    service.refresh();
    httpTesting.expectOne((r) => r.url === PENDING_URL).flush({ count: 3 });

    service.refresh();
    httpTesting
      .expectOne((r) => r.url === PENDING_URL)
      .flush('boom', { status: 500, statusText: 'Server Error' });

    expect(service.count()).toBe(3);
  });

  it('should poll the count on start and stop on stop()', () => {
    vi.useFakeTimers();

    service.start();
    httpTesting.expectOne((r) => r.url === PENDING_URL).flush({ count: 1 });
    expect(service.count()).toBe(1);

    vi.advanceTimersByTime(PENDING_PROCESSING_POLL_MS);
    httpTesting.expectOne((r) => r.url === PENDING_URL).flush({ count: 4 });
    expect(service.count()).toBe(4);

    service.stop();
    vi.advanceTimersByTime(PENDING_PROCESSING_POLL_MS * 3);
    expect(service.count()).toBe(4);
  });

  it('should start polling only once', () => {
    vi.useFakeTimers();

    service.start();
    service.start();
    httpTesting.expectOne((r) => r.url === PENDING_URL).flush({ count: 0 });

    vi.advanceTimersByTime(PENDING_PROCESSING_POLL_MS);
    httpTesting.expectOne((r) => r.url === PENDING_URL).flush({ count: 0 });
  });
});
