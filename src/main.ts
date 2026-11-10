import { bootstrapApplication } from '@angular/platform-browser';
import { polyfillCountryFlagEmojis } from 'country-flag-emoji-polyfill';
import { appConfig } from './app/app.config';
import { App } from './app/app';

// Windows (Chromium incluido) no trae glifos de banderas: "🇮🇹" se ve como dos recuadros
// con las letras IT. El polyfill registra la fuente local Twemoji Country Flags (copiada a
// /fonts desde node_modules por angular.json) solo en los sistemas que no pintan banderas.
polyfillCountryFlagEmojis('Twemoji Country Flags', 'fonts/TwemojiCountryFlags.woff2');

bootstrapApplication(App, appConfig).catch((err) => console.error(err));
