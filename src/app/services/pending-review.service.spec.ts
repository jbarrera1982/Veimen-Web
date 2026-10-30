import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { PENDING_REVIEW_POLL_MS, PendingReviewService } from './pending-review.service';
import { PERMISSIONS, PermissionsService } from './permissions.service';
import { ClientContextService } from './client-context.service';
import { Client } from './clients.service';
import { environment } from '../../environments/environment';

const REQUESTS_URL = `${environment.apiBaseUrl}/api/ServiceRequests`;

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

function page(totalCount: number) {
  return { items: [], totalCount, page: 1, pageSize: 1, totalPages: totalCount };
}

describe('PendingReviewService', () => {
  let service: PendingReviewService;
  let httpTesting: HttpTestingController;
  let permissions: PermissionsService;
  let clientContext: ClientContextService;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });
    service = TestBed.inject(PendingReviewService);
    httpTesting = TestBed.inject(HttpTestingController);
    permissions = TestBed.inject(PermissionsService);
    clientContext = TestBed.inject(ClientContextService);
    permissions.permissions.set([PERMISSIONS.serviceRequestsRead]);
    permissions.loaded.set(true);
  });

  afterEach(() => {
    service.stop();
    httpTesting.verify();
    vi.useRealTimers();
  });

  it('should count pending-review requests without date filters', () => {
    service.refresh();

    const req = httpTesting.expectOne((r) => r.url === REQUESTS_URL);
    expect(req.request.params.getAll('status')).toEqual(['Pending review']);
    expect(req.request.params.has('start_date')).toBe(false);
    expect(req.request.params.has('end_date')).toBe(false);
    req.flush(page(5));

    expect(service.count()).toBe(5);
  });

  it('should filter the count by the selected client', () => {
    clientContext.clients.set([client({ clientId: 7 })]);
    clientContext.selectClient(7);

    service.refresh();

    const req = httpTesting.expectOne((r) => r.url === REQUESTS_URL);
    expect(req.request.params.get('client_id')).toBe('7');
    req.flush(page(2));

    expect(service.count()).toBe(2);
  });

  it('should not call the API without the service-requests.read permission', () => {
    permissions.permissions.set([]);

    service.refresh();

    expect(service.count()).toBe(0);
  });

  it('should keep the last value when the count request fails', () => {
    service.refresh();
    httpTesting.expectOne((r) => r.url === REQUESTS_URL).flush(page(3));

    service.refresh();
    httpTesting
      .expectOne((r) => r.url === REQUESTS_URL)
      .flush('boom', { status: 500, statusText: 'Server Error' });

    expect(service.count()).toBe(3);
  });

  it('should poll the count on start and stop on stop()', () => {
    vi.useFakeTimers();

    service.start();
    httpTesting.expectOne((r) => r.url === REQUESTS_URL).flush(page(1));
    expect(service.count()).toBe(1);

    vi.advanceTimersByTime(PENDING_REVIEW_POLL_MS);
    httpTesting.expectOne((r) => r.url === REQUESTS_URL).flush(page(4));
    expect(service.count()).toBe(4);

    service.stop();
    vi.advanceTimersByTime(PENDING_REVIEW_POLL_MS * 3);
    expect(service.count()).toBe(4);
  });

  it('should start polling only once', () => {
    vi.useFakeTimers();

    service.start();
    service.start();
    httpTesting.expectOne((r) => r.url === REQUESTS_URL).flush(page(0));

    vi.advanceTimersByTime(PENDING_REVIEW_POLL_MS);
    httpTesting.expectOne((r) => r.url === REQUESTS_URL).flush(page(0));
  });

  it('should consume the filter request only once', () => {
    expect(service.consumeFilterRequest()).toBe(false);

    service.requestFilter();

    expect(service.filterRequested()).toBe(true);
    expect(service.consumeFilterRequest()).toBe(true);
    expect(service.filterRequested()).toBe(false);
    expect(service.consumeFilterRequest()).toBe(false);
  });
});
