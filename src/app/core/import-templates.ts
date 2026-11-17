import { zipSync } from 'fflate';

/**
 * Generador de plantillas CSV y XLSX de EnRuta.
 * - XLSX: encabezados con colores corporativos, negritas, bordes, anchos autoajustados, fila de encabezado
 *   congelada, validaciones de datos en celdas clave y una segunda hoja "Instrucciones y formato".
 * - CSV: UTF-8 con BOM (﻿) para que Excel respete acentos y la eñe.
 */
export type TemplateKind = 'clientes' | 'productos' | 'precios' | 'rutas';
export type TemplateFormat = 'csv' | 'xlsx';

type ColType = 'text' | 'number' | 'money' | 'coord';

interface Validation {
  type: 'list' | 'decimal' | 'custom';
  items?: string[];            // list
  min?: number; max?: number;  // decimal
  formula?: string;            // custom: usa {c} como referencia a la primera celda de la columna
  title: string; message: string;
}

interface TemplateColumn {
  header: string;
  required: boolean;
  type: ColType;
  format: string;     // descripción del formato esperado
  examples: string[]; // un ejemplo por fila de ejemplo
  validation?: Validation;
}

interface TemplateSpec {
  sheet: string;
  title: string;
  summary: string;
  columns: TemplateColumn[];
  notes: string[];
}

export const TEMPLATE_LABELS: Record<TemplateKind, string> = { clientes: 'Clientes', productos: 'Catálogo de productos', precios: 'Precios y promociones', rutas: 'Rutas' };

const ESTADO: Validation = { type: 'list', items: ['Activo', 'Inactivo'], title: 'Estado', message: 'Elige Activo o Inactivo.' };

const SPECS: Record<TemplateKind, TemplateSpec> = {
  clientes: {
    sheet: 'Clientes',
    title: 'Plantilla de clientes',
    summary: 'Una fila por negocio o punto de venta. Se importa la primera hoja del libro.',
    columns: [
      { header: 'Nombre', required: true, type: 'text', format: 'Texto. Nombre del negocio o cliente (obligatorio).', examples: ['Abarrotes La Esquina', 'Tienda Don Pepe', 'Miscelánea Lupita'] },
      { header: 'Dirección', required: false, type: 'text', format: 'Texto. Calle, número, colonia y ciudad.', examples: ['Av. Insurgentes Sur 1000, CDMX', 'Calle Hidalgo 45, Coyoacán, CDMX', 'Av. Universidad 320, CDMX'] },
      { header: 'Teléfono', required: false, type: 'text', format: 'De 7 a 15 dígitos; puede incluir +, espacios o guiones.', examples: ['5512345678', '55 8765 4321', '+52 55 1122 3344'] },
      { header: 'Correo electrónico', required: false, type: 'text', format: 'Correo válido, con @ y dominio.', examples: ['contacto@laesquina.mx', 'donpepe@correo.mx', ''],
        validation: { type: 'custom', formula: 'ISNUMBER(FIND("@",{c}))', title: 'Correo', message: 'Escribe un correo válido, por ejemplo nombre@dominio.mx.' } },
      { header: 'Latitud', required: false, type: 'coord', format: 'Número decimal entre -90 y 90 (usa punto decimal).', examples: ['19.3730', '19.3467', '19.3320'],
        validation: { type: 'decimal', min: -90, max: 90, title: 'Latitud', message: 'Debe ser un número entre -90 y 90.' } },
      { header: 'Longitud', required: false, type: 'coord', format: 'Número decimal entre -180 y 180. Si capturas latitud, captura también longitud.', examples: ['-99.1790', '-99.1620', '-99.1710'],
        validation: { type: 'decimal', min: -180, max: 180, title: 'Longitud', message: 'Debe ser un número entre -180 y 180.' } },
      { header: 'Estado', required: false, type: 'text', format: 'Activo o Inactivo. Si se deja vacío se asume Activo.', examples: ['Activo', 'Activo', 'Inactivo'], validation: ESTADO },
    ],
    notes: ['Los registros con el mismo nombre y dirección se consideran duplicados.', 'Sin latitud y longitud el cliente quedará pendiente de ubicar en el mapa.'],
  },
  productos: {
    sheet: 'Catálogo',
    title: 'Plantilla de catálogo de productos',
    summary: 'Una fila por producto. Se importa la primera hoja del libro.',
    columns: [
      { header: 'Nombre', required: true, type: 'text', format: 'Texto. Nombre comercial del producto (obligatorio).', examples: ['Agua purificada 1 L', 'Refresco cola 600 ml', 'Papas fritas 45 g'] },
      { header: 'Clave', required: false, type: 'text', format: 'Texto sin espacios (SKU). Identifica al producto y evita duplicados.', examples: ['AGU-001', 'REF-014', 'BOT-203'] },
      { header: 'Categoría', required: false, type: 'text', format: 'Texto. Familia o categoría.', examples: ['Bebidas', 'Bebidas', 'Botanas'] },
      { header: 'Precio', required: false, type: 'money', format: 'Número mayor o igual a 0, con punto decimal. Sin símbolo de moneda.', examples: ['12.50', '18.00', '15.75'],
        validation: { type: 'decimal', min: 0, max: 99999999, title: 'Precio', message: 'Escribe un número mayor o igual a 0, sin símbolo de moneda.' } },
      { header: 'Descripción', required: false, type: 'text', format: 'Texto libre: presentación, unidad, piezas por caja.', examples: ['Caja con 12 piezas', 'Paquete con 6 piezas', 'Caja con 24 bolsas'] },
      { header: 'Estado', required: false, type: 'text', format: 'Activo o Inactivo. Si se deja vacío se asume Activo.', examples: ['Activo', 'Activo', 'Inactivo'], validation: ESTADO },
    ],
    notes: ['Si capturas la clave, se usa para detectar productos que ya existen.'],
  },
  precios: {
    sheet: 'Precios',
    title: 'Plantilla de precios y promociones',
    summary: 'Una fila por precio, promoción o descuento aplicable a un producto.',
    columns: [
      { header: 'Lista', required: true, type: 'text', format: 'Texto. Nombre de la lista, promoción o descuento (obligatorio).', examples: ['Mayoreo', 'Promo verano', 'Descuento pronto pago'] },
      { header: 'Tipo', required: true, type: 'text', format: 'Lista, Promoción o Descuento.', examples: ['Lista', 'Promoción', 'Descuento'],
        validation: { type: 'list', items: ['Lista', 'Promoción', 'Descuento'], title: 'Tipo', message: 'Elige Lista, Promoción o Descuento.' } },
      { header: 'Clave producto', required: true, type: 'text', format: 'Clave (SKU) del producto del catálogo.', examples: ['AGU-001', 'REF-014', 'BOT-203'] },
      { header: 'Precio', required: false, type: 'money', format: 'Número mayor o igual a 0. Obligatorio para el tipo Lista.', examples: ['11.00', '', ''],
        validation: { type: 'decimal', min: 0, max: 99999999, title: 'Precio', message: 'Escribe un número mayor o igual a 0.' } },
      { header: 'Descuento %', required: false, type: 'number', format: 'Número entre 0 y 100. Para Promoción o Descuento.', examples: ['', '10', '5'],
        validation: { type: 'decimal', min: 0, max: 100, title: 'Descuento %', message: 'Escribe un porcentaje entre 0 y 100.' } },
      { header: 'Vigencia desde', required: false, type: 'text', format: 'Fecha AAAA-MM-DD.', examples: ['2026-01-01', '2026-06-01', '2026-01-01'] },
      { header: 'Vigencia hasta', required: false, type: 'text', format: 'Fecha AAAA-MM-DD. Debe ser posterior a “Vigencia desde”.', examples: ['2026-12-31', '2026-08-31', '2026-12-31'] },
      { header: 'Estado', required: false, type: 'text', format: 'Activo o Inactivo. Si se deja vacío se asume Activo.', examples: ['Activo', 'Activo', 'Inactivo'], validation: ESTADO },
    ],
    notes: ['Escribe las fechas con formato AAAA-MM-DD para evitar confusiones de idioma regional.'],
  },
  rutas: {
    sheet: 'Rutas',
    title: 'Plantilla de rutas',
    summary: 'Una fila por parada. Las filas con el mismo nombre de ruta forman una sola ruta.',
    columns: [
      { header: 'Ruta', required: true, type: 'text', format: 'Texto. Nombre de la ruta (obligatorio).', examples: ['Ruta Norte', 'Ruta Norte', 'Ruta Sur'] },
      { header: 'Operador', required: false, type: 'text', format: 'Texto. Nombre del repartidor asignado.', examples: ['Juan Pérez', 'Juan Pérez', 'María López'] },
      { header: 'Día', required: false, type: 'text', format: 'Día de la semana.', examples: ['Lunes', 'Lunes', 'Martes'],
        validation: { type: 'list', items: ['Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado', 'Domingo'], title: 'Día', message: 'Elige un día de la semana.' } },
      { header: 'Orden de parada', required: true, type: 'number', format: 'Número entero mayor a 0. Secuencia de visita dentro de la ruta.', examples: ['1', '2', '1'],
        validation: { type: 'decimal', min: 1, max: 9999, title: 'Orden de parada', message: 'Escribe un número entero mayor a 0.' } },
      { header: 'Cliente', required: true, type: 'text', format: 'Nombre del cliente ya registrado en EnRuta.', examples: ['Abarrotes La Esquina', 'Tienda Don Pepe', 'Miscelánea Lupita'] },
      { header: 'Estado', required: false, type: 'text', format: 'Activo o Inactivo. Si se deja vacío se asume Activo.', examples: ['Activo', 'Activo', 'Activo'], validation: ESTADO },
    ],
    notes: ['Los clientes deben existir antes de asignarlos a una ruta.'],
  },
};

const BLUE = 'FF1769AA';
const BLUE_SOFT = 'FF5B8DB8';
const BLUE_DARK = 'FF10263F';
const BLUE_PALE = 'FFEFF6FD';
const BORDER = 'FFB8C7D9';
const DATA_ROWS = 500; // filas con formato y validación listas para capturar

const esc = (v: string): string => v
  // eslint-disable-next-line no-control-regex
  .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '')
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

const colLetter = (i: number): string => { let n = i + 1; let s = ''; while (n > 0) { const m = (n - 1) % 26; s = String.fromCharCode(65 + m) + s; n = Math.floor((n - 1) / 26); } return s; };

const str = (ref: string, style: number, v: string): string => (v === '' ? `<c r="${ref}" s="${style}"/>` : `<c r="${ref}" s="${style}" t="inlineStr"><is><t xml:space="preserve">${esc(v)}</t></is></c>`);

export function templateFilename(kind: TemplateKind, format: TemplateFormat): string { return `plantilla-${kind}.${format}`; }

/** Encabezados de la plantilla (útil para pruebas y para validar importaciones). */
export function templateHeaders(kind: TemplateKind): string[] { return SPECS[kind].columns.map((c) => c.header); }

function buildCsv(kind: TemplateKind): Blob {
  const spec = SPECS[kind];
  const rows: string[][] = [spec.columns.map((c) => c.header)];
  for (let r = 0; r < 2; r += 1) rows.push(spec.columns.map((c) => c.examples[r] ?? ''));
  const csv = rows.map((row) => row.map((cell) => `"${cell.replace(/"/g, '""')}"`).join(',')).join('\r\n') + '\r\n';
  return new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' });
}

const STYLES = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
<numFmts count="1"><numFmt numFmtId="164" formatCode="0.0000"/></numFmts>
<fonts count="6">
<font><sz val="11"/><name val="Calibri"/><family val="2"/></font>
<font><b/><sz val="11"/><color rgb="FFFFFFFF"/><name val="Calibri"/><family val="2"/></font>
<font><b/><sz val="16"/><color rgb="${BLUE_DARK}"/><name val="Calibri"/><family val="2"/></font>
<font><i/><sz val="10"/><color rgb="FF5A6B7F"/><name val="Calibri"/><family val="2"/></font>
<font><b/><sz val="11"/><color rgb="${BLUE_DARK}"/><name val="Calibri"/><family val="2"/></font>
<font><sz val="11"/><color rgb="FF172A40"/><name val="Calibri"/><family val="2"/></font>
</fonts>
<fills count="5">
<fill><patternFill patternType="none"/></fill>
<fill><patternFill patternType="gray125"/></fill>
<fill><patternFill patternType="solid"><fgColor rgb="${BLUE}"/><bgColor indexed="64"/></patternFill></fill>
<fill><patternFill patternType="solid"><fgColor rgb="${BLUE_SOFT}"/><bgColor indexed="64"/></patternFill></fill>
<fill><patternFill patternType="solid"><fgColor rgb="${BLUE_PALE}"/><bgColor indexed="64"/></patternFill></fill>
</fills>
<borders count="2">
<border><left/><right/><top/><bottom/><diagonal/></border>
<border><left style="thin"><color rgb="${BORDER}"/></left><right style="thin"><color rgb="${BORDER}"/></right><top style="thin"><color rgb="${BORDER}"/></top><bottom style="thin"><color rgb="${BORDER}"/></bottom><diagonal/></border>
</borders>
<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>
<cellXfs count="12">
<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>
<xf numFmtId="0" fontId="1" fillId="2" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center" wrapText="1"/></xf>
<xf numFmtId="0" fontId="1" fillId="3" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center" wrapText="1"/></xf>
<xf numFmtId="49" fontId="5" fillId="0" borderId="1" xfId="0" applyNumberFormat="1" applyFont="1" applyBorder="1" applyAlignment="1"><alignment vertical="center"/></xf>
<xf numFmtId="4" fontId="5" fillId="0" borderId="1" xfId="0" applyNumberFormat="1" applyFont="1" applyBorder="1" applyAlignment="1"><alignment vertical="center"/></xf>
<xf numFmtId="164" fontId="5" fillId="0" borderId="1" xfId="0" applyNumberFormat="1" applyFont="1" applyBorder="1" applyAlignment="1"><alignment vertical="center"/></xf>
<xf numFmtId="0" fontId="2" fillId="0" borderId="0" xfId="0" applyFont="1" applyAlignment="1"><alignment vertical="center"/></xf>
<xf numFmtId="0" fontId="3" fillId="0" borderId="0" xfId="0" applyFont="1" applyAlignment="1"><alignment vertical="top" wrapText="1"/></xf>
<xf numFmtId="0" fontId="5" fillId="0" borderId="1" xfId="0" applyFont="1" applyBorder="1" applyAlignment="1"><alignment vertical="top" wrapText="1"/></xf>
<xf numFmtId="0" fontId="4" fillId="4" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment vertical="top" wrapText="1"/></xf>
<xf numFmtId="0" fontId="4" fillId="0" borderId="0" xfId="0" applyFont="1" applyAlignment="1"><alignment vertical="center"/></xf>
<xf numFmtId="0" fontId="5" fillId="0" borderId="1" xfId="0" applyFont="1" applyBorder="1" applyAlignment="1"><alignment vertical="center"/></xf>
</cellXfs>
<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>
</styleSheet>`;

const bodyStyle = (t: ColType): number => (t === 'money' ? 4 : t === 'coord' ? 5 : t === 'number' ? 11 : 3);

function dataSheet(spec: TemplateSpec): string {
  const cols = spec.columns;
  const widths = cols.map((c) => Math.min(48, Math.max(14, c.header.length + 6, ...c.examples.map((e) => e.length + 4))));
  const header = `<row r="1" ht="30" customHeight="1">${cols.map((c, i) => str(`${colLetter(i)}1`, c.required ? 1 : 2, c.header + (c.required ? ' *' : ''))).join('')}</row>`;
  let body = '';
  for (let r = 2; r <= DATA_ROWS + 1; r += 1) {
    body += `<row r="${r}">${cols.map((c, i) => `<c r="${colLetter(i)}${r}" s="${bodyStyle(c.type)}"/>`).join('')}</row>`;
  }
  const last = DATA_ROWS + 1;
  const validations = cols.map((c, i) => {
    const v = c.validation; if (!v) return '';
    const L = colLetter(i); const range = `${L}2:${L}${last}`;
    const common = `allowBlank="1" showInputMessage="1" showErrorMessage="1" errorTitle="${esc(v.title)}" error="${esc(v.message)}" promptTitle="${esc(v.title)}" prompt="${esc(v.message)}" sqref="${range}"`;
    if (v.type === 'list') return `<dataValidation type="list" errorStyle="stop" ${common}><formula1>"${esc((v.items ?? []).join(','))}"</formula1></dataValidation>`;
    if (v.type === 'decimal') return `<dataValidation type="decimal" operator="between" errorStyle="stop" ${common}><formula1>${v.min}</formula1><formula2>${v.max}</formula2></dataValidation>`;
    return `<dataValidation type="custom" errorStyle="stop" ${common}><formula1>${esc((v.formula ?? '').replace(/\{c\}/g, `${L}2`))}</formula1></dataValidation>`;
  }).filter(Boolean);
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">`
    + `<dimension ref="A1:${colLetter(cols.length - 1)}${last}"/>`
    + `<sheetViews><sheetView workbookViewId="0" tabSelected="1"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/><selection pane="bottomLeft" activeCell="A2" sqref="A2"/></sheetView></sheetViews>`
    + `<sheetFormatPr defaultRowHeight="18"/>`
    + `<cols>${widths.map((w, i) => `<col min="${i + 1}" max="${i + 1}" width="${w}" customWidth="1"/>`).join('')}</cols>`
    + `<sheetData>${header}${body}</sheetData>`
    + (validations.length ? `<dataValidations count="${validations.length}">${validations.join('')}</dataValidations>` : '')
    + `</worksheet>`;
}

function instructionsSheet(spec: TemplateSpec): string {
  const widths = [24, 14, 58, 30];
  const lines = (text: string, width: number): number => Math.max(1, Math.ceil(text.length / (width * 1.05)));
  const rows: string[] = []; const merges: string[] = []; let r = 1;
  const row = (cells: string, ht?: number) => { rows.push(`<row r="${r}"${ht ? ` ht="${ht}" customHeight="1"` : ''}>${cells}</row>`); r += 1; };
  const merged = (text: string, style: number, ht: number) => { merges.push(`A${r}:D${r}`); row(str(`A${r}`, style, text) + ['B', 'C', 'D'].map((l) => `<c r="${l}${r}" s="${style}"/>`).join(''), ht); };

  merged(`EnRuta · ${spec.title}`, 6, 30);
  merged(spec.summary, 7, 32);
  row('');
  row(str(`A${r}`, 10, '1. Columnas'));
  row(['Columna', 'Obligatoria', 'Formato esperado', 'Ejemplo'].map((h, i) => str(`${colLetter(i)}${r}`, 1, h)).join(''), 24);
  for (const c of spec.columns) {
    const fmt = c.format; const ex = c.examples[0] ?? '';
    const ht = 18 * Math.max(lines(fmt, widths[2]), lines(c.header, widths[0]), lines(ex, widths[3]));
    row([str(`A${r}`, 9, c.header), str(`B${r}`, 8, c.required ? 'Sí' : 'No'), str(`C${r}`, 8, fmt), str(`D${r}`, 8, ex)].join(''), ht);
  }
  row('');
  row(str(`A${r}`, 10, '2. Ejemplo de filas correctas'));
  row(spec.columns.map((c, i) => str(`${colLetter(i)}${r}`, c.required ? 1 : 2, c.header)).join(''), 24);
  for (let k = 0; k < 3; k += 1) row(spec.columns.map((c, i) => str(`${colLetter(i)}${r}`, 8, c.examples[k] ?? '')).join(''), 20);
  row('');
  row(str(`A${r}`, 10, '3. Recomendaciones'));
  const tips = [
    'Captura tus datos en la hoja “' + spec.sheet + '” a partir de la fila 2; la fila de encabezados está congelada.',
    'Los encabezados con * son obligatorios. No cambies el nombre de las columnas ni su orden.',
    'Las celdas con lista desplegable o validación solo aceptan los valores permitidos.',
    ...spec.notes,
    'Formatos aceptados: .xlsx o .csv (UTF-8). Máximo 15 MB y 50,000 registros por archivo.',
    'Elimina las filas de ejemplo antes de importar si las copiaste a la hoja de captura.',
  ];
  tips.forEach((t, i) => { merges.push(`A${r}:D${r}`); row(str(`A${r}`, 8, `${i + 1}. ${t}`) + ['B', 'C', 'D'].map((l) => `<c r="${l}${r}" s="8"/>`).join(''), 18 * lines(t, 118)); });

  const maxCols = Math.max(4, spec.columns.length);
  const allWidths = Array.from({ length: maxCols }, (_, i) => (i < 4 ? widths[i] : 20));
  // El ejemplo ocupa todas las columnas de la plantilla; amplía columnas extra para que no se corte
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">`
    + `<sheetViews><sheetView workbookViewId="0" showGridLines="0"/></sheetViews><sheetFormatPr defaultRowHeight="18"/>`
    + `<cols>${allWidths.map((w, i) => `<col min="${i + 1}" max="${i + 1}" width="${w}" customWidth="1"/>`).join('')}</cols>`
    + `<sheetData>${rows.join('')}</sheetData><mergeCells count="${merges.length}">${merges.map((m) => `<mergeCell ref="${m}"/>`).join('')}</mergeCells></worksheet>`;
}

function buildXlsx(kind: TemplateKind): Blob {
  const spec = SPECS[kind]; const enc = new TextEncoder();
  const zip = zipSync({
    '[Content_Types].xml': enc.encode('<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/worksheets/sheet2.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/></Types>'),
    '_rels/.rels': enc.encode('<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>'),
    'xl/workbook.xml': enc.encode(`<?xml version="1.0" encoding="UTF-8"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><bookViews><workbookView activeTab="0"/></bookViews><sheets><sheet name="${esc(spec.sheet)}" sheetId="1" r:id="rId1"/><sheet name="Instrucciones y formato" sheetId="2" r:id="rId2"/></sheets></workbook>`),
    'xl/_rels/workbook.xml.rels': enc.encode('<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet2.xml"/><Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>'),
    'xl/styles.xml': enc.encode(STYLES),
    'xl/worksheets/sheet1.xml': enc.encode(dataSheet(spec)),
    'xl/worksheets/sheet2.xml': enc.encode(instructionsSheet(spec)),
  });
  return new Blob([zip as BlobPart], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
}

export function buildTemplate(kind: TemplateKind, format: TemplateFormat): Blob { return format === 'xlsx' ? buildXlsx(kind) : buildCsv(kind); }

/** Genera y descarga la plantilla en el navegador. */
export function downloadTemplate(kind: TemplateKind, format: TemplateFormat): void {
  if (typeof document === 'undefined') return;
  const url = URL.createObjectURL(buildTemplate(kind, format));
  const link = document.createElement('a'); link.href = url; link.download = templateFilename(kind, format);
  document.body.appendChild(link); link.click(); link.remove(); URL.revokeObjectURL(url);
}
