import { computed, inject, Injectable } from '@angular/core';
import { AuthService } from '../services/auth.service';
import { ES, EN, TranslationKey } from './translations';

export type AppLanguage = 'es' | 'en';
export type TranslationParams = Record<string, string | number>;

/**
 * Normaliza el idioma que llega del backend (`Español`/`Inglés`), de un claim o de
 * cualquier variante ISO (`es`, `es-CO`, `Spanish`, `en-US`, `English`…).
 * Cualquier valor desconocido o vacío cae a español, el idioma por defecto.
 */
export function normalizeLanguage(value: string | null | undefined): AppLanguage {
  const normalized = (value ?? '')
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');

  if (!normalized) return 'es';
  if (normalized.startsWith('en') || normalized === 'ingles' || normalized === 'english') {
    return 'en';
  }
  return 'es';
}

const DICTIONARIES: Record<AppLanguage, Record<TranslationKey, string>> = {
  es: ES,
  en: EN,
};

const STATUS_KEYS: Record<string, TranslationKey> = {
  received: 'status.received',
  recibido: 'status.received',
  rejected: 'status.rejected',
  rechazado: 'status.rejected',
  closed: 'status.closed',
  cerrado: 'status.closed',
  'awaiting otp': 'status.awaitingOtp',
  'esperando otp': 'status.awaitingOtp',
  'pending review': 'status.pendingReview',
  'pendiente por revision': 'status.pendingReview',
  cancelled: 'status.cancelled',
  canceled: 'status.cancelled',
  cancelado: 'status.cancelled',
};

function toLocaleDate(value: string): Date | null {
  // Acepta 'YYYY-MM-DD', 'YYYY-MM-DD HH:mm:ss' y 'YYYY-MM-DDTHH:mm:ss'.
  const match = /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2})(?::(\d{2}))?)?/.exec(value.trim());
  if (!match) return null;
  const [, year, month, day, hour = '0', minute = '0', second = '0'] = match;
  return new Date(
    Number(year),
    Number(month) - 1,
    Number(day),
    Number(hour),
    Number(minute),
    Number(second),
  );
}

/**
 * Servicio de traducción propio (sin dependencias externas).
 *
 * El idioma se deriva del claim `language` del usuario autenticado. Al ser un signal
 * computado, cualquier plantilla que llame a `t()` durante su evaluación se actualiza
 * cuando cambia el idioma (los componentes usan ChangeDetectionStrategy.OnPush).
 */
@Injectable({ providedIn: 'root' })
export class TranslationService {
  private readonly auth = inject(AuthService);

  readonly language = computed<AppLanguage>(() => normalizeLanguage(this.auth.language()));
  readonly locale = computed(() => (this.language() === 'en' ? 'en-US' : 'es-CO'));
  readonly isEnglish = computed(() => this.language() === 'en');

  /** Traduce una clave e interpola los parámetros `{nombre}`. */
  readonly t = (key: TranslationKey, params?: TranslationParams): string => {
    const dictionary = DICTIONARIES[this.language()] ?? ES;
    let text: string = dictionary[key] ?? ES[key] ?? key;
    if (params) {
      for (const [name, value] of Object.entries(params)) {
        text = text.replaceAll(`{${name}}`, String(value));
      }
    }
    return text;
  };

  /**
   * Traduce una etiqueta de estado. Acepta tanto el estado del backend en inglés
   * (`pending review`) como el valor canónico español que usa el frontend
   * (`Pendiente por revisión`). Un valor desconocido se devuelve tal cual.
   */
  readonly statusLabel = (value: string | null | undefined): string => {
    if (!value) return '';
    const normalized = value
      .trim()
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '');
    const key = STATUS_KEYS[normalized];
    return key ? this.t(key) : value;
  };

  formatNumber(value: number, options?: Intl.NumberFormatOptions): string {
    return new Intl.NumberFormat(this.locale(), options).format(value);
  }

  formatPercent(value: number, maximumFractionDigits = 1): string {
    return `${new Intl.NumberFormat(this.locale(), { maximumFractionDigits }).format(value)}%`;
  }

  /** Formatea una fecha `YYYY-MM-DD` (o ISO) según el idioma actual. */
  formatDate(value: string): string {
    const date = toLocaleDate(value);
    if (!date) return value;
    return new Intl.DateTimeFormat(this.locale(), {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
    }).format(date);
  }

  /** Formatea una fecha `YYYY-MM-DD` como día/mes (ejes de gráficos). */
  formatMonthDay(value: string): string {
    const date = toLocaleDate(value);
    if (!date) return value;
    return new Intl.DateTimeFormat(this.locale(), { day: '2-digit', month: '2-digit' }).format(
      date,
    );
  }

  formatTime(date: Date | null): string {
    if (!date) return '';
    return new Intl.DateTimeFormat(this.locale(), {
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false,
    }).format(date);
  }

  /** Formatea `YYYY-MM-DD HH:mm:ss` (o ISO) como fecha y hora. */
  formatDateTime(value: string): string {
    const date = toLocaleDate(value);
    if (!date) return value;
    return new Intl.DateTimeFormat(this.locale(), {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false,
    }).format(date);
  }
}
