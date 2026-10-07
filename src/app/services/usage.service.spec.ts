import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { UsageService, type CompletionUsage, type CostEntry } from './usage.service';
import { environment } from '../../environments/environment';

const COMPLETIONS_URL = `${environment.apiBaseUrl}/api/usage/completions`;
const COSTS_URL = `${environment.apiBaseUrl}/api/usage/costs`;

// Epoch (segundos) de 2026-09-01T00:00:00Z y 2026-09-02T00:00:00Z.
const SEP_01 = 1788220800;
const SEP_02 = 1788307200;

describe('UsageService', () => {
  let service: UsageService;
  let httpTesting: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });
    service = TestBed.inject(UsageService);
    httpTesting = TestBed.inject(HttpTestingController);
  });

  afterEach(() => {
    httpTesting.verify();
  });

  describe('getCompletionsUsage', () => {
    it('should flatten the page/bucket envelope into one row per result', () => {
      let result: CompletionUsage[] | undefined;
      service.getCompletionsUsage({ startDate: '2026-09-01' }).subscribe((r) => (result = r));

      httpTesting
        .expectOne((r) => r.url === COMPLETIONS_URL)
        .flush({
          object: 'page',
          has_more: false,
          next_page: null,
          data: [
            {
              object: 'bucket',
              start_time: SEP_01,
              end_time: SEP_02,
              results: [
                { input_tokens: 100, output_tokens: 20, num_model_requests: 2, model: 'gpt-5' },
                { input_tokens: 50, output_tokens: 5, num_model_requests: 1, model: 'gpt-4o' },
              ],
            },
            {
              object: 'bucket',
              start_time: SEP_02,
              end_time: SEP_02 + 86400,
              results: [
                { input_tokens: 10, output_tokens: 1, num_model_requests: 1, model: 'gpt-5' },
              ],
            },
          ],
        });

      expect(result).toEqual([
        {
          date: '2026-09-01',
          model: 'gpt-5',
          inputTokens: 100,
          cachedInputTokens: 0,
          audioInputTokens: 0,
          outputTokens: 20,
          audioOutputTokens: 0,
          totalTokens: 120,
          requests: 2,
        },
        {
          date: '2026-09-01',
          model: 'gpt-4o',
          inputTokens: 50,
          cachedInputTokens: 0,
          audioInputTokens: 0,
          outputTokens: 5,
          audioOutputTokens: 0,
          totalTokens: 55,
          requests: 1,
        },
        {
          date: '2026-09-02',
          model: 'gpt-5',
          inputTokens: 10,
          cachedInputTokens: 0,
          audioInputTokens: 0,
          outputTokens: 1,
          audioOutputTokens: 0,
          totalTokens: 11,
          requests: 1,
        },
      ]);
    });

    // El día se resuelve en UTC: con los getters locales, un navegador en UTC-3
    // mostraría el bucket como el día anterior.
    it('should resolve the bucket day in UTC', () => {
      let result: CompletionUsage[] | undefined;
      service.getCompletionsUsage({ startDate: '2026-09-01' }).subscribe((r) => (result = r));

      httpTesting
        .expectOne((r) => r.url === COMPLETIONS_URL)
        .flush({
          data: [{ start_time: SEP_01, results: [{ input_tokens: 1, output_tokens: 1 }] }],
        });

      expect(result?.[0].date).toBe('2026-09-01');
    });

    // input_tokens ya incluye los tokens cacheados y de audio según OpenAI,
    // así que sumarlos aparte inflaría el total.
    it('should compute totalTokens as input + output without double counting cached/audio', () => {
      let result: CompletionUsage[] | undefined;
      service.getCompletionsUsage({ startDate: '2026-09-01' }).subscribe((r) => (result = r));

      httpTesting
        .expectOne((r) => r.url === COMPLETIONS_URL)
        .flush({
          data: [
            {
              start_time: SEP_01,
              results: [
                {
                  input_tokens: 1000,
                  input_cached_tokens: 800,
                  input_audio_tokens: 50,
                  output_tokens: 200,
                  output_audio_tokens: 25,
                  num_model_requests: 3,
                },
              ],
            },
          ],
        });

      expect(result?.[0]).toEqual(
        expect.objectContaining({
          inputTokens: 1000,
          cachedInputTokens: 800,
          audioInputTokens: 50,
          outputTokens: 200,
          audioOutputTokens: 25,
          totalTokens: 1200,
          requests: 3,
        }),
      );
    });

    it('should default missing counts to zero and a missing model to an empty string', () => {
      let result: CompletionUsage[] | undefined;
      service.getCompletionsUsage({ startDate: '2026-09-01' }).subscribe((r) => (result = r));

      httpTesting
        .expectOne((r) => r.url === COMPLETIONS_URL)
        .flush({
          data: [
            {
              start_time: SEP_01,
              results: [
                {
                  input_tokens: null,
                  output_tokens: null,
                  num_model_requests: null,
                  model: '  gpt-5  ',
                },
                { model: null },
              ],
            },
          ],
        });

      expect(result?.[0]).toEqual(expect.objectContaining({ model: 'gpt-5', totalTokens: 0 }));
      expect(result?.[1]).toEqual(
        expect.objectContaining({
          model: '',
          inputTokens: 0,
          outputTokens: 0,
          totalTokens: 0,
          requests: 0,
        }),
      );
    });

    it('should drop the dimensions the dashboard does not use', () => {
      let result: CompletionUsage[] | undefined;
      service.getCompletionsUsage({ startDate: '2026-09-01' }).subscribe((r) => (result = r));

      httpTesting
        .expectOne((r) => r.url === COMPLETIONS_URL)
        .flush({
          data: [
            {
              start_time: SEP_01,
              results: [
                {
                  object: 'organization.usage.completions.result',
                  input_tokens: 1,
                  output_tokens: 1,
                  project_id: 'proj_1',
                  user_id: 'user_1',
                  api_key_id: 'key_1',
                  batch: false,
                },
              ],
            },
          ],
        });

      expect(result?.[0]).not.toHaveProperty('project_id');
      expect(result?.[0]).not.toHaveProperty('user_id');
      expect(result?.[0]).not.toHaveProperty('api_key_id');
      expect(result?.[0]).not.toHaveProperty('batch');
    });

    it('should return an empty array when the page or data is null', () => {
      let result: CompletionUsage[] | undefined;
      service.getCompletionsUsage({ startDate: '2026-09-01' }).subscribe((r) => (result = r));

      httpTesting.expectOne((r) => r.url === COMPLETIONS_URL).flush({ object: 'page', data: null });

      expect(result).toEqual([]);
    });
  });

  describe('getCosts', () => {
    it('should flatten the envelope and read amount.value / amount.currency', () => {
      let result: CostEntry[] | undefined;
      service
        .getCosts({ startDate: '2026-09-01', endDate: '2026-09-30' })
        .subscribe((r) => (result = r));

      httpTesting
        .expectOne((r) => r.url === COSTS_URL)
        .flush({
          object: 'page',
          has_more: false,
          data: [
            {
              object: 'bucket',
              start_time: SEP_01,
              end_time: SEP_02,
              results: [
                {
                  object: 'organization.costs.result',
                  amount: { value: 12.34, currency: 'usd' },
                  line_item: ' gpt-5 ',
                  project_id: 'proj_1',
                  api_key_id: 'key_1',
                  quantity: 1000,
                  quantity_unit: 'tokens',
                },
                { amount: null, line_item: null, quantity: null, quantity_unit: null },
              ],
            },
          ],
        });

      expect(result).toEqual([
        {
          date: '2026-09-01',
          lineItem: 'gpt-5',
          amount: 12.34,
          currency: 'usd',
          quantity: 1000,
          quantityUnit: 'tokens',
        },
        {
          date: '2026-09-01',
          lineItem: '',
          amount: 0,
          currency: '',
          quantity: 0,
          quantityUnit: '',
        },
      ]);
    });

    it('should return an empty array when the API responds with null', () => {
      let result: CostEntry[] | undefined;
      service.getCosts({ startDate: '2026-09-01' }).subscribe((r) => (result = r));

      httpTesting.expectOne((r) => r.url === COSTS_URL).flush(null);

      expect(result).toEqual([]);
    });
  });

  describe('query params', () => {
    it('should always send start_date in YYYYMMDD format', () => {
      service.getCompletionsUsage({ startDate: '2026-09-01' }).subscribe(() => {});

      const req = httpTesting.expectOne((r) => r.url === COMPLETIONS_URL);
      expect(req.request.method).toBe('GET');
      expect(req.request.params.get('start_date')).toBe('20260901');
      expect(req.request.params.has('end_date')).toBe(false);
    });

    it('should send end_date in YYYYMMDD format when given', () => {
      service.getCosts({ startDate: '2026-09-01', endDate: '2026-09-30' }).subscribe(() => {});

      const req = httpTesting.expectOne((r) => r.url === COSTS_URL);
      expect(req.request.params.get('start_date')).toBe('20260901');
      expect(req.request.params.get('end_date')).toBe('20260930');
    });
  });
});
