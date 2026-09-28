/**
 * set-pdf-title.mjs — setea /Title en la metadata de un PDF sin invalidar una
 * firma C2PA ("Content Credentials") existente.
 *
 * Por qué no funciona `window.open(url, 'nombre')`: el 2º parámetro de window.open
 * es el *window name*, no el título visible de la pestaña. En un PDF abierto en
 * pestaña nueva, el título lo decide el navegador leyendo la metadata /Title del
 * documento. Si no está, muestra "untitled" o el nombre del archivo.
 *
 * Por qué es seguro: se hace un *incremental update* (ISO 32000-1 §7.5.6), que solo
 * AGREGA bytes al final — un objeto /Info nuevo + su sección xref + un trailer con
 * /Prev. Ningún offset existente se mueve, así que el rango de bytes que el
 * manifiesto C2PA hashea (que siempre termina antes de su propia revisión) queda
 * intacto. Los bytes originales se conservan como prefijo exacto.
 *
 * Es reversible: si el PDF se vuelve a exportar, se reejecuta el script.
 *
 * Uso:
 *   node scripts/set-pdf-title.mjs <archivo.pdf> [titulo] [--out <salida.pdf>]
 *
 * Ejemplo:
 *   node scripts/set-pdf-title.mjs public/TUCOOP_Gestion_de_Valor.pdf "Modelos de Negocios"
 */
import { readFileSync, writeFileSync, copyFileSync, existsSync } from 'node:fs';

const MARKER = '/* set-pdf-title */';

const args = process.argv.slice(2);
const positional = args.filter((a) => !a.startsWith('--'));
const outIdx = args.indexOf('--out');
const outPath = outIdx !== -1 ? args[outIdx + 1] : undefined;

const filePath = positional[0];
const title = positional[1];

if (!filePath || !title) {
  console.error('Uso: node scripts/set-pdf-title.mjs <archivo.pdf> <titulo> [--out <salida.pdf>]');
  process.exit(1);
}
if (!existsSync(filePath)) {
  console.error(`No existe: ${filePath}`);
  process.exit(1);
}

// --- Helpers de parsing -----------------------------------------------------

/** Escapa un literal PDF: \ ( ) deben ir precedidos de backslash. */
function pdfString(value) {
  return `(${value.replace(/([\\()])/g, '\\$1')})`;
}

/**
 * Extrae las entradas de un dict de trailer. El orden de las alternativas importa:
 * una referencia "6 0 R" debe evaluarse ANTES que un número suelto, si no /Info y
 * /Root se leen como "6" y "5" y el trailer queda malformado. También hace falta
 * cubrir los arrays "[...]" para /ID, que es como se declara.
 *
 * Ojo: un PDF con manifiesto C2PA lleva el PDF original EMBEBIDO dentro del blob
 * del manifiesto, con sus propios "trailer"/"startxref". Por eso el llamador debe
 * recortar la región correcta (la de la última revisión) y no parsear el archivo
 * entero.
 */
const DICT_ENTRY_RE =
  /\/([A-Za-z0-9#]+)\s*(<<[\s\S]*?>>|\[[^\]]*\]|\(\s*(?:\\.|[^\\()])*\)|<[0-9A-Fa-f\s]+>|\d+\s+\d+\s+R|\/[^\s/[\]()<>]+|[-\d.]+)/g;

function trailerEntries(dictBody) {
  const entries = new Map();
  for (const m of dictBody.matchAll(DICT_ENTRY_RE)) entries.set(m[1], m[2]);
  return entries;
}

/**
 * Devuelve el último dict balanceado <<...>> que termina en `end` (exclusivo).
 * Necesario porque el PDF embebido en un manifiesto C2PA trae su propio trailer:
 * un regex perezoso tipo /trailer\s*<<([\s\S]*?)>>$/ arranca en el trailer del
 * PDF embebido y se come hasta el ">>" del trailer real, fusionando ambos dicts.
 * El último ">>" antes de `end` sí es siempre el del trailer real.
 */
function lastDictBefore(t, end) {
  const closeIdx = t.lastIndexOf('>>', end);
  if (closeIdx === -1) return null;
  let depth = 0;
  for (let i = closeIdx + 1; i >= 0; i--) {
    if (t.startsWith('>>', i)) depth++;
    else if (t.startsWith('<<', i)) {
      depth--;
      if (depth === 0) return t.slice(i, closeIdx + 2);
    }
  }
  return null;
}

/** Devuelve el primer dict balanceado <<...>> que empieza a partir de `from`. */
function dictAfter(t, from) {
  const open = t.indexOf('<<', from);
  if (open === -1) return null;
  let depth = 0;
  for (let i = open; i < t.length; i++) {
    if (t.startsWith('<<', i)) depth++;
    else if (t.startsWith('>>', i)) {
      depth--;
      if (depth === 0) return t.slice(open, i + 2);
    }
  }
  return null;
}

/** Lee el dict de trailer de la revisión cuya tabla xref arranca en `xrefOffset`. */
function trailerDictAt(t, xrefOffset) {
  // Tras la tabla xref viene el trailer. Se toma la PRIMERA keyword "trailer" de la
  // ventana: el PDF embebido en un manifiesto C2PA puede traer los suyos más abajo.
  const win = t.slice(xrefOffset, xrefOffset + 65536);
  const kw = win.indexOf('trailer');
  return kw === -1 ? dictAfter(win, 0) : dictAfter(win, kw + 'trailer'.length);
}

/**
 * Recorre la cadena de revisiones (ISO 32000-1 §7.5.8) y mergea las entradas.
 *
 * Imprescindible acá: la revisión de firma C2PA escribe un trailer NUEVO que no
 * repite /Info (solo /Size, /Root, /Prev, /ID). Las entradas ausentes se HEREDAN
 * del trailer anterior vía /Prev, así que leer solo el último dict perdería la
 * metadata (/Title, /Author, ...). La revisión actual manda: gana la primera vez
 * que aparece una clave al caminar hacia atrás.
 */
function collectTrailerChain(t, startXref) {
  const merged = new Map();
  let x = startXref;
  for (let hops = 0; x !== undefined && hops < 32; hops++) {
    const dict = trailerDictAt(t, x);
    if (!dict) break;
    for (const [k, v] of trailerEntries(dict)) if (!merged.has(k)) merged.set(k, v);
    const prev = /\/Prev\s+(\d+)/.exec(dict);
    x = prev ? Number(prev[1]) : undefined;
  }
  return merged;
}

const original = readFileSync(filePath);
const text = original.toString('latin1');

// Guard de idempotencia (primer paso): el marcador se busca en TODO el buffer, no
// solo en el /Info, porque el dict que este script agrega queda al final del
// archivo, fuera de la ventana de la revisión original.
if (text.includes(MARKER)) {
  console.error('El PDF ya fue procesado por este script. Abortando para no duplicar revisiones.');
  process.exit(1);
}

// --- 1. Localizar el último startxref y su trailer -------------------------

// Keyword "startxref" de la ÚLTIMA revisión (lastIndexOf, no matchAll: el manifiesto
// C2PA embebido contiene una copia del PDF original con sus propias keywords).
const keywordIdx = text.lastIndexOf('startxref');
if (keywordIdx === -1) throw new Error('No se encontró startxref: PDF inválido');
const prevStartxref = Number(/startxref\s+(\d+)/.exec(text.slice(keywordIdx))[1]);

// El valor de startxref apunta al offset de la palabra "xref", NO al de la keyword
// "startxref". Se resuelve el trailer de esa revisión y se heredan las entradas
// que no aparecen en ella siguiendo la cadena /Prev.
const trailer = collectTrailerChain(text, prevStartxref);
if (trailer.size === 0) throw new Error('No se pudo leer el trailer del PDF');

// La PRIMERA revisión es el PDF original, y va antes del manifiesto embebido, así
// que su límite sirve para no matchear objetos de la copia incrustada.
const firstKeywordIdx = text.indexOf('startxref');
const firstRevisionEnd = Number(/startxref\s+(\d+)/.exec(text.slice(firstKeywordIdx))[1]);

if (trailer.has('XRef')) {
  throw new Error(
    'El PDF usa un xref stream (PDF 1.5+). Esta herramienta solo soporta tablas xref clásicas.',
  );
}

const rootRef = trailer.get('Root');
if (!rootRef) throw new Error('El trailer no tiene /Root');
const idEntry = trailer.get('ID');

// --- 2. Leer el /Info actual para conservar el resto de la metadata --------

const infoRef = trailer.get('Info');
let carried = '';
let prevInfoNum = null;
if (infoRef) {
  const infoNum = /^(\d+)\s+\d+\s+R$/.exec(infoRef)?.[1];
  if (infoNum) {
    // Se busca solo dentro de la revisión original: la copia del PDF incrustada en
    // el manifiesto C2PA vuelve a definir "N 0 obj" con el mismo número.
    const re = new RegExp(`(?:^|[^0-9])${infoNum} 0 obj\\s*([\\s\\S]*?)endobj`);
    const infoObj = re.exec(text.slice(0, firstRevisionEnd));
    if (infoObj) {
      carried = infoObj[1].trim();
      prevInfoNum = infoNum;
    }
  }
}
if (!carried) {
  console.warn('Aviso: no se encontró el /Info previo; se creará uno solo con /Title.');
}

// Reescribimos el dictInfo: mismo cuerpo, /Title nuevo y una marca de auditoría.
const infoBody = carried
  .replace(/\s*\/Title\s*(\([^)]*\)|<[0-9A-Fa-f\s]+>)/g, '')
  .replace(/^\s*<<\s*/, '')
  .replace(/\s*>>\s*$/, '')
  .trim();
const newInfoDict = `<< ${MARKER} /Title ${pdfString(title)}${infoBody ? ` ${infoBody}` : ''} >>`;

// --- 3. Número de objeto libre y offsets ----------------------------------

// /Size del ÚLTIMO trailer es el número máximo de objetos + 1 de esa revisión, así
// que el siguiente libre es /Size. Se acotan los objetos top-level a la revisión
// original para no contar los de la copia embebida del manifiesto.
const declaredSize = Number(trailer.get('Size') ?? 0);
const maxObjSeen = Math.max(
  0,
  ...[...text.slice(0, firstRevisionEnd).matchAll(/(?:^|[\r\n\s])(\d+) 0 obj/g)].map((m) =>
    Number(m[1]),
  ),
);
const newObjNum = Math.max(declaredSize, maxObjSeen + 1);

const header = '\n% --- incremental update: /Title corregido ---\n';
const objOffset = original.length + header.length;
const objChunk = `${newObjNum} 0 obj\n${newInfoDict}\nendobj\n`;

const xrefOffset = objOffset + Buffer.byteLength(objChunk, 'latin1');
const xrefChunk = `xref\n${newObjNum} 1\n${String(objOffset).padStart(10, '0')} 00000 n \n`;

const trailerEntriesNew = [
  `/Size ${newObjNum + 1}`,
  `/Root ${rootRef}`,
  `/Info ${newObjNum} 0 R`,
  ...(idEntry ? [`/ID ${idEntry}`] : []),
  `/Prev ${prevStartxref}`,
];
const trailerChunk = `trailer\n<< ${trailerEntriesNew.join(' ')} >>\nstartxref\n${xrefOffset}\n%%EOF\n`;

const patch = Buffer.from(header + objChunk + xrefChunk + trailerChunk, 'latin1');
const output = Buffer.concat([original, patch]);

if (outPath) {
  writeFileSync(outPath, output);
  console.log(`Escrito: ${outPath} (+${patch.length} bytes, original intacto como prefijo)`);
} else {
  writeFileSync(filePath, output);
  console.log(`Actualizado: ${filePath} (+${patch.length} bytes, original intacto como prefijo)`);
}

console.log(`Título aplicado: ${title}`);
console.log(`Objeto /Info: ${infoRef ?? '(sin /Info previo)'} -> ${newObjNum} 0 R`);
console.log(`Revisión previa enlazada con /Prev ${prevStartxref}`);
