/**
 * Carta Porte (CFDI 4.0 + Complemento Carta Porte 3.1, autotransporte federal).
 * Modelo de captura, validaciones previas al timbrado, generador de XML y de la representación impresa (PDF).
 *
 * IMPORTANTE: el XML se genera SIN TIMBRAR (sin Sello, Certificado ni TimbreFiscalDigital). El timbrado
 * requiere el CSD del emisor y un Proveedor Autorizado de Certificación (PAC).
 */

export type TipoCfdi = 'I' | 'T';

export interface CpEmisor { rfc: string; nombre: string; regimen: string; }
export interface CpReceptor { rfc: string; nombre: string; cp: string; regimen: string; uso: string; }
export interface CpUbicacion {
  tipo: 'Origen' | 'Intermedio' | 'Destino';
  nombre: string; rfc: string; fechaHora: string; distancia: number | null;
  calle: string; numExt: string; colonia: string; municipio: string; estado: string; cp: string;
}
export interface CpMercancia {
  bienes: string; descripcion: string; cantidad: number | null; claveUnidad: string; pesoKg: number | null; valor: number | null; moneda: string;
  materialPeligroso: boolean; cveMaterialPeligroso: string;
  fraccion: string; tipoMateria: string; tipoDocumento: string; pedimento: string;
}
export interface CpRemolque { subtipo: string; placa: string; }
export interface CpAutotransporte {
  config: string; permTipo: string; permNum: string; placa: string; anio: number | null; pesoBrutoVehicular: number | null;
  aseguradora: string; poliza: string; remolques: CpRemolque[];
}
export interface CpFigura { tipo: string; rfc: string; nombre: string; licencia: string; }
export interface CpComercioExterior { entradaSalida: 'Entrada' | 'Salida'; pais: string; via: string; regimen: string; }

export interface CartaPorteData {
  tipo: TipoCfdi; serie: string; folio: string; lugarExpedicion: string;
  emisor: CpEmisor; receptor: CpReceptor;
  concepto: { descripcion: string; importe: number | null }; retencionIva: boolean;
  transpInternac: boolean; comercio: CpComercioExterior;
  ubicaciones: CpUbicacion[]; mercancias: CpMercancia[]; auto: CpAutotransporte; figuras: CpFigura[];
}

export interface CartaPorteRecord {
  id: number; folio: string; tipo: TipoCfdi; fecha: string; resumen: string; idCcp: string; xml: string; data: CartaPorteData;
  fiscalId?: string; fiscalStatus?: 'EnCola' | 'Procesando' | 'Timbrado' | 'Simulado' | 'Error';
  fiscalAttempts?: number; fiscalUuid?: string | null; fiscalError?: string | null;
}

type Opt = { value: string; label: string };
export const CP_CATALOGS = {
  regimen: [
    { value: '601', label: '601 · General de Ley Personas Morales' }, { value: '603', label: '603 · Personas Morales con Fines no Lucrativos' },
    { value: '612', label: '612 · Personas Físicas con Actividades Empresariales y Profesionales' }, { value: '621', label: '621 · Incorporación Fiscal' },
    { value: '626', label: '626 · Régimen Simplificado de Confianza' },
  ] as Opt[],
  uso: [{ value: 'G03', label: 'G03 · Gastos en general' }, { value: 'S01', label: 'S01 · Sin efectos fiscales' }] as Opt[],
  config: [
    { value: 'VL', label: 'VL · Vehículo ligero de carga (hasta 4.4 t)' }, { value: 'C2', label: 'C2 · Camión unitario (2 llantas en el eje trasero)' },
    { value: 'C3', label: 'C3 · Camión unitario (3 ejes)' }, { value: 'C2R2', label: 'C2R2 · Camión remolque' }, { value: 'C3R2', label: 'C3R2 · Camión remolque' },
    { value: 'C2R3', label: 'C2R3 · Camión remolque' }, { value: 'C3R3', label: 'C3R3 · Camión remolque' },
    { value: 'T2S1', label: 'T2S1 · Tractocamión semirremolque' }, { value: 'T2S2', label: 'T2S2 · Tractocamión semirremolque' }, { value: 'T2S3', label: 'T2S3 · Tractocamión semirremolque' },
    { value: 'T3S1', label: 'T3S1 · Tractocamión semirremolque' }, { value: 'T3S2', label: 'T3S2 · Tractocamión semirremolque' }, { value: 'T3S3', label: 'T3S3 · Tractocamión semirremolque' },
  ] as Opt[],
  permiso: [
    { value: 'TPAF01', label: 'TPAF01 · Autotransporte Federal de carga general' }, { value: 'TPAF02', label: 'TPAF02 · Transporte privado de carga' },
    { value: 'TPAF03', label: 'TPAF03 · Autotransporte Federal de carga especializada de fondos y valores' },
    { value: 'TPAF04', label: 'TPAF04 · Autotransporte Federal de carga especializada de materiales y residuos peligrosos' },
    { value: 'TPXX00', label: 'TPXX00 · Permiso no contemplado en el catálogo' },
  ] as Opt[],
  figura: [{ value: '01', label: '01 · Operador' }, { value: '02', label: '02 · Propietario' }, { value: '03', label: '03 · Arrendador' }, { value: '04', label: '04 · Notificado' }] as Opt[],
  unidad: [{ value: 'H87', label: 'H87 · Pieza' }, { value: 'KGM', label: 'KGM · Kilogramo' }, { value: 'XBX', label: 'XBX · Caja' }, { value: 'XPK', label: 'XPK · Paquete' }, { value: 'LTR', label: 'LTR · Litro' }, { value: 'XPA', label: 'XPA · Tarima' }] as Opt[],
  materia: [{ value: '01', label: '01 · Materia prima' }, { value: '02', label: '02 · Materia procesada' }, { value: '03', label: '03 · Materia terminada (producto terminado)' }, { value: '04', label: '04 · Materia para su reparación' }, { value: '05', label: '05 · Materia para su reposición' }] as Opt[],
  documento: [{ value: '01', label: '01 · Pedimento' }, { value: '02', label: '02 · Autorización de importación temporal' }, { value: '03', label: '03 · Autorización de importación temporal de embarcaciones' }, { value: '04', label: '04 · Autorización de importación temporal de mercancías' }, { value: '05', label: '05 · Aviso de exportación temporal' }, { value: '06', label: '06 · Aviso de importación temporal' }] as Opt[],
  regimenAduanero: [{ value: 'IMD', label: 'IMD · Definitiva de importación' }, { value: 'EXD', label: 'EXD · Definitiva de exportación' }, { value: 'ITR', label: 'ITR · Temporal de importación para retornar' }, { value: 'ETR', label: 'ETR · Temporal de exportación para retornar' }, { value: 'DFI', label: 'DFI · Depósito fiscal' }, { value: 'TRA', label: 'TRA · Tránsito' }] as Opt[],
  estados: ['AGU', 'BCN', 'BCS', 'CAM', 'CHP', 'CHH', 'COA', 'COL', 'CMX', 'DUR', 'GUA', 'GRO', 'HID', 'JAL', 'MEX', 'MIC', 'MOR', 'NAY', 'NLE', 'OAX', 'PUE', 'QUE', 'ROO', 'SLP', 'SIN', 'SON', 'TAB', 'TAM', 'TLA', 'VER', 'YUC', 'ZAC'],
};

export const emptyUbicacion = (tipo: CpUbicacion['tipo']): CpUbicacion => ({ tipo, nombre: '', rfc: '', fechaHora: '', distancia: tipo === 'Origen' ? null : 0, calle: '', numExt: '', colonia: '', municipio: '', estado: 'CMX', cp: '' });
export const emptyMercancia = (): CpMercancia => ({ bienes: '', descripcion: '', cantidad: 1, claveUnidad: 'H87', pesoKg: null, valor: null, moneda: 'MXN', materialPeligroso: false, cveMaterialPeligroso: '', fraccion: '', tipoMateria: '03', tipoDocumento: '01', pedimento: '' });
export const emptyFigura = (): CpFigura => ({ tipo: '01', rfc: '', nombre: '', licencia: '' });
export const emptyCartaPorte = (): CartaPorteData => ({
  tipo: 'T', serie: 'CP', folio: '1', lugarExpedicion: '',
  emisor: { rfc: '', nombre: '', regimen: '601' }, receptor: { rfc: '', nombre: '', cp: '', regimen: '601', uso: 'G03' },
  concepto: { descripcion: 'Servicio de transporte de carga por carretera', importe: null }, retencionIva: false,
  transpInternac: false, comercio: { entradaSalida: 'Salida', pais: 'USA', via: '01', regimen: 'EXD' },
  ubicaciones: [emptyUbicacion('Origen'), emptyUbicacion('Destino')], mercancias: [emptyMercancia()],
  auto: { config: 'C2', permTipo: 'TPAF01', permNum: '', placa: '', anio: null, pesoBrutoVehicular: null, aseguradora: '', poliza: '', remolques: [] },
  figuras: [emptyFigura()],
});

const RFC_RE = /^[A-ZÑ&]{3,4}\d{6}[A-Z0-9]{3}$/;
const XAXX = ['XAXX010101000', 'XEXX010101000'];
const round2 = (n: number): number => Math.round((n + Number.EPSILON) * 100) / 100;

export function totalDistancia(d: CartaPorteData): number { return round2(d.ubicaciones.filter((u) => u.tipo !== 'Origen').reduce((s, u) => s + (u.distancia ?? 0), 0)); }
export function pesoTotal(d: CartaPorteData): number { return round2(d.mercancias.reduce((s, m) => s + (m.pesoKg ?? 0), 0)); }

/** Importes del CFDI de ingreso (traslado: todo en cero). */
export function importes(d: CartaPorteData): { subtotal: number; iva: number; retencion: number; total: number } {
  if (d.tipo === 'T') return { subtotal: 0, iva: 0, retencion: 0, total: 0 };
  const subtotal = round2(d.concepto.importe ?? 0); const iva = round2(subtotal * 0.16); const retencion = d.retencionIva ? round2(subtotal * 0.04) : 0;
  return { subtotal, iva, retencion, total: round2(subtotal + iva - retencion) };
}

/** Requisitos del SAT que deben cumplirse antes de generar el complemento. Devuelve la lista de errores. */
export function validateCartaPorte(d: CartaPorteData): string[] {
  const e: string[] = []; const cp = (v: string) => /^\d{5}$/.test(v.trim());
  const rfc = (v: string) => RFC_RE.test(v.trim().toUpperCase());
  if (!rfc(d.emisor.rfc)) e.push('Emisor: RFC no válido (12 o 13 caracteres).');
  if (!d.emisor.nombre.trim()) e.push('Emisor: captura el nombre o razón social.');
  if (!cp(d.lugarExpedicion)) e.push('Lugar de expedición: código postal de 5 dígitos.');
  if (!/^\d{1,9}$/.test(d.folio.trim())) e.push('Folio: solo dígitos (máximo 9).');
  if (d.tipo === 'I') {
    if (!rfc(d.receptor.rfc)) e.push('Receptor: RFC no válido.');
    if (!d.receptor.nombre.trim()) e.push('Receptor: captura el nombre o razón social.');
    if (!cp(d.receptor.cp)) e.push('Receptor: código postal del domicilio fiscal (5 dígitos).');
    if (!d.concepto.descripcion.trim()) e.push('Concepto: descripción del servicio.');
    if (!(d.concepto.importe && d.concepto.importe > 0)) e.push('Concepto: el importe del servicio debe ser mayor a 0 en un CFDI de ingreso.');
  }
  // Ubicaciones
  const origen = d.ubicaciones.filter((u) => u.tipo === 'Origen'); const destinos = d.ubicaciones.filter((u) => u.tipo !== 'Origen');
  if (origen.length !== 1) e.push('Ubicaciones: debe existir exactamente un origen.');
  if (!destinos.length) e.push('Ubicaciones: agrega al menos un destino.');
  d.ubicaciones.forEach((u, i) => {
    const n = `${u.tipo === 'Origen' ? 'Origen' : u.tipo === 'Intermedio' ? `Punto intermedio ${i}` : `Destino ${i}`}`;
    if (!u.nombre.trim()) e.push(`${n}: nombre del remitente/destinatario.`);
    if (!rfc(u.rfc) && !XAXX.includes(u.rfc.trim().toUpperCase())) e.push(`${n}: RFC del remitente/destinatario no válido.`);
    if (!u.fechaHora) e.push(`${n}: fecha y hora de ${u.tipo === 'Origen' ? 'salida' : 'llegada'}.`);
    if (!cp(u.cp)) e.push(`${n}: código postal de 5 dígitos.`);
    if (!u.estado) e.push(`${n}: estado.`);
    if (u.tipo !== 'Origen' && !(u.distancia && u.distancia > 0)) e.push(`${n}: distancia recorrida en km (mayor a 0).`);
  });
  const fechas = d.ubicaciones.map((u) => (u.fechaHora ? new Date(u.fechaHora).getTime() : NaN));
  for (let i = 1; i < fechas.length; i += 1) if (Number.isFinite(fechas[i]) && Number.isFinite(fechas[i - 1]) && fechas[i] <= fechas[i - 1]) { e.push('Ubicaciones: la fecha de llegada debe ser posterior a la de la ubicación anterior.'); break; }
  // Mercancías
  if (!d.mercancias.length) e.push('Mercancías: agrega al menos un bien o mercancía.');
  d.mercancias.forEach((m, i) => {
    const n = `Mercancía ${i + 1}`;
    if (!/^\d{8}$/.test(m.bienes.trim())) e.push(`${n}: clave de producto o servicio (8 dígitos, catálogo c_ClaveProdServCP).`);
    if (!m.descripcion.trim()) e.push(`${n}: descripción.`);
    if (!(m.cantidad && m.cantidad > 0)) e.push(`${n}: cantidad mayor a 0.`);
    if (!(m.pesoKg && m.pesoKg > 0)) e.push(`${n}: peso en kg mayor a 0.`);
    if (!(m.valor !== null && m.valor >= 0)) e.push(`${n}: valor de la mercancía.`);
    if (m.materialPeligroso && !/^[A-Z0-9]{4}$/.test(m.cveMaterialPeligroso.trim().toUpperCase())) e.push(`${n}: clave del material peligroso (4 caracteres, catálogo c_MaterialPeligroso).`);
    if (d.transpInternac) {
      if (!/^\d{8}$/.test(m.fraccion.trim())) e.push(`${n}: fracción arancelaria (8 dígitos) — obligatoria en comercio exterior.`);
      if (!m.tipoMateria) e.push(`${n}: estado de la materia o producto.`);
      if (!m.tipoDocumento) e.push(`${n}: tipo de documento aduanero.`);
      if (m.tipoDocumento === '01' && !/^\d{2}\s?\d{2}\s?\d{4}\s?\d{7}$/.test(m.pedimento.trim())) e.push(`${n}: número de pedimento (15 dígitos, formato 21 47 3807 8003832).`);
    }
  });
  // Autotransporte
  const a = d.auto;
  if (!a.config) e.push('Autotransporte: configuración vehicular.');
  if (!a.permTipo) e.push('Autotransporte: tipo de permiso SICT.');
  if (!a.permNum.trim()) e.push('Autotransporte: número de permiso SICT vigente.');
  if (!/^[A-Z0-9]{5,7}$/.test(a.placa.trim().toUpperCase())) e.push('Autotransporte: placa del vehículo (5 a 7 caracteres alfanuméricos, sin guiones).');
  if (!(a.anio && a.anio >= 1980 && a.anio <= new Date().getFullYear() + 1)) e.push('Autotransporte: año del modelo del vehículo.');
  if (!(a.pesoBrutoVehicular && a.pesoBrutoVehicular > 0)) e.push('Autotransporte: peso bruto vehicular en toneladas.');
  if (!a.aseguradora.trim()) e.push('Seguro: nombre de la aseguradora de responsabilidad civil.');
  if (!a.poliza.trim()) e.push('Seguro: número de póliza de responsabilidad civil.');
  a.remolques.forEach((r, i) => { if (!r.subtipo.trim() || !/^[A-Z0-9]{5,7}$/.test(r.placa.trim().toUpperCase())) e.push(`Remolque ${i + 1}: subtipo y placa válidos.`); });
  // Figuras
  if (!d.figuras.some((f) => f.tipo === '01')) e.push('Figura de transporte: captura al menos un operador (tipo 01).');
  d.figuras.forEach((f, i) => {
    const n = `Figura ${i + 1}`;
    if (!rfc(f.rfc)) e.push(`${n}: RFC no válido.`);
    if (!f.nombre.trim()) e.push(`${n}: nombre.`);
    if (f.tipo === '01' && !/^[A-Za-z0-9\-]{7,16}$/.test(f.licencia.trim())) e.push(`${n}: número de licencia del operador (7 a 16 caracteres).`);
  });
  if (d.transpInternac) {
    if (!/^[A-Z]{3}$/.test(d.comercio.pais.trim().toUpperCase()) || d.comercio.pais.trim().toUpperCase() === 'MEX') e.push('Comercio exterior: país de origen o destino (clave de 3 letras distinta de MEX).');
    if (!d.comercio.regimen) e.push('Comercio exterior: régimen aduanero.');
  }
  return e;
}

// ---------------------------------------------------------------- XML
const esc = (v: string | number): string => String(v).replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;').replace(/\s+/g, ' ').trim();
const attrs = (o: Record<string, string | number | undefined | null>): string => Object.entries(o).filter(([, v]) => v !== undefined && v !== null && v !== '').map(([k, v]) => ` ${k}="${esc(v as string | number)}"`).join('');
const money = (n: number): string => n.toFixed(2);
const pad = (n: number, w = 2): string => String(n).padStart(w, '0');
export const cfdiDate = (dt: Date): string => `${dt.getFullYear()}-${pad(dt.getMonth() + 1)}-${pad(dt.getDate())}T${pad(dt.getHours())}:${pad(dt.getMinutes())}:${pad(dt.getSeconds())}`;
const dtLocal = (v: string): string => (v.length === 16 ? `${v}:00` : v);

/** IdCCP: UUID de 36 caracteres cuyos tres primeros caracteres son “CCC” (regla del SAT). */
export function newIdCcp(): string {
  const hex = (n: number): string => Array.from({ length: n }, () => Math.floor(Math.random() * 16).toString(16)).join('');
  const base = typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : `${hex(8)}-${hex(4)}-4${hex(3)}-a${hex(3)}-${hex(12)}`;
  return ('CCC' + base.slice(3)).toUpperCase();
}

export function buildCartaPorteXml(d: CartaPorteData, idCcp: string, now: Date = new Date()): string {
  const t = importes(d); const isI = d.tipo === 'I';
  const emisorRfc = d.emisor.rfc.trim().toUpperCase();
  const receptor = isI ? d.receptor : { rfc: emisorRfc, nombre: d.emisor.nombre, cp: d.lugarExpedicion, regimen: d.emisor.regimen, uso: 'S01' };
  const origenes = d.ubicaciones.filter((u) => u.tipo === 'Origen');
  const ubic = d.ubicaciones.map((u) => {
    const isOrigen = u.tipo === 'Origen'; const idx = isOrigen ? origenes.indexOf(u) + 1 : d.ubicaciones.filter((x) => x.tipo !== 'Origen').indexOf(u) + 1;
    return `<cartaporte31:Ubicacion${attrs({ TipoUbicacion: isOrigen ? 'Origen' : 'Destino', IDUbicacion: `${isOrigen ? 'OR' : 'DE'}${pad(idx, 6)}`, RFCRemitenteDestinatario: u.rfc.trim().toUpperCase(), NombreRemitenteDestinatario: u.nombre, FechaHoraSalidaLlegada: dtLocal(u.fechaHora), DistanciaRecorrida: isOrigen ? undefined : money(u.distancia ?? 0) })}>`
      + `<cartaporte31:Domicilio${attrs({ Calle: u.calle, NumeroExterior: u.numExt, Colonia: u.colonia, Municipio: u.municipio, Estado: u.estado, Pais: 'MEX', CodigoPostal: u.cp.trim() })}/></cartaporte31:Ubicacion>`;
  }).join('');
  const merc = d.mercancias.map((m) => `<cartaporte31:Mercancia${attrs({
    BienesTransp: m.bienes.trim(), Descripcion: m.descripcion, Cantidad: (m.cantidad ?? 0).toFixed(6), ClaveUnidad: m.claveUnidad, PesoEnKg: (m.pesoKg ?? 0).toFixed(3), ValorMercancia: money(m.valor ?? 0), Moneda: m.moneda || 'MXN',
    MaterialPeligroso: m.materialPeligroso ? 'Sí' : 'No', CveMaterialPeligroso: m.materialPeligroso ? m.cveMaterialPeligroso.trim().toUpperCase() : undefined,
    FraccionArancelaria: d.transpInternac ? m.fraccion.trim() : undefined, TipoMateria: d.transpInternac ? m.tipoMateria : undefined,
  })}>${d.transpInternac ? `<cartaporte31:DocumentacionAduanera${attrs({ TipoDocumento: m.tipoDocumento, NumPedimento: m.tipoDocumento === '01' ? m.pedimento.replace(/\s/g, '').replace(/^(\d{2})(\d{2})(\d{4})(\d{7})$/, '$1  $2  $3  $4') : undefined })}/>` : ''}</cartaporte31:Mercancia>`).join('');
  const a = d.auto;
  const auto = `<cartaporte31:Autotransporte${attrs({ PermSCT: a.permTipo, NumPermisoSCT: a.permNum })}>`
    + `<cartaporte31:IdentificacionVehicular${attrs({ ConfigVehicular: a.config, PesoBrutoVehicular: (a.pesoBrutoVehicular ?? 0).toFixed(2), PlacaVM: a.placa.trim().toUpperCase(), AnioModeloVM: a.anio ?? '' })}/>`
    + `<cartaporte31:Seguros${attrs({ AseguraRespCivil: a.aseguradora, PolizaRespCivil: a.poliza })}/>`
    + (a.remolques.length ? `<cartaporte31:Remolques>${a.remolques.map((r) => `<cartaporte31:Remolque${attrs({ SubTipoRem: r.subtipo.trim().toUpperCase(), Placa: r.placa.trim().toUpperCase() })}/>`).join('')}</cartaporte31:Remolques>` : '')
    + `</cartaporte31:Autotransporte>`;
  const figuras = `<cartaporte31:FiguraTransporte>${d.figuras.map((f) => `<cartaporte31:TiposFigura${attrs({ TipoFigura: f.tipo, RFCFigura: f.rfc.trim().toUpperCase(), NumLicencia: f.tipo === '01' ? f.licencia.trim() : undefined, NombreFigura: f.nombre })}/>`).join('')}</cartaporte31:FiguraTransporte>`;
  const ccpAttrs = attrs({
    Version: '3.1', IdCCP: idCcp, TranspInternac: d.transpInternac ? 'Sí' : 'No', EntradaSalidaMerc: d.transpInternac ? d.comercio.entradaSalida : undefined,
    PaisOrigenDestino: d.transpInternac ? d.comercio.pais.trim().toUpperCase() : undefined, ViaEntradaSalida: d.transpInternac ? d.comercio.via : undefined, TotalDistRec: totalDistancia(d).toFixed(2),
  });
  const aduana = d.transpInternac ? `<cartaporte31:RegimenesAduaneros><cartaporte31:RegimenAduaneroCCP${attrs({ RegimenAduanero: d.comercio.regimen })}/></cartaporte31:RegimenesAduaneros>` : '';
  const ccp = `<cartaporte31:CartaPorte${ccpAttrs}>${aduana}<cartaporte31:Ubicaciones>${ubic}</cartaporte31:Ubicaciones>`
    + `<cartaporte31:Mercancias${attrs({ PesoBrutoTotal: pesoTotal(d).toFixed(3), UnidadPeso: 'KGM', NumTotalMercancias: d.mercancias.length })}>${merc}${auto}</cartaporte31:Mercancias>${figuras}</cartaporte31:CartaPorte>`;

  const concepto = isI
    ? `<cfdi:Concepto${attrs({ ClaveProdServ: '78101800', Cantidad: '1', ClaveUnidad: 'E48', Unidad: 'Servicio', Descripcion: d.concepto.descripcion, ValorUnitario: money(t.subtotal), Importe: money(t.subtotal), ObjetoImp: '02' })}><cfdi:Impuestos><cfdi:Traslados><cfdi:Traslado${attrs({ Base: money(t.subtotal), Impuesto: '002', TipoFactor: 'Tasa', TasaOCuota: '0.160000', Importe: money(t.iva) })}/></cfdi:Traslados>`
      + (d.retencionIva ? `<cfdi:Retenciones><cfdi:Retencion${attrs({ Base: money(t.subtotal), Impuesto: '002', TipoFactor: 'Tasa', TasaOCuota: '0.040000', Importe: money(t.retencion) })}/></cfdi:Retenciones>` : '') + `</cfdi:Impuestos></cfdi:Concepto>`
    : `<cfdi:Concepto${attrs({ ClaveProdServ: '78101800', Cantidad: '1', ClaveUnidad: 'H87', Unidad: 'Pieza', Descripcion: 'Traslado de mercancías', ValorUnitario: '0', Importe: '0', ObjetoImp: '01' })}/>`;
  const impuestos = isI ? `<cfdi:Impuestos${attrs({ TotalImpuestosRetenidos: d.retencionIva ? money(t.retencion) : undefined, TotalImpuestosTrasladados: money(t.iva) })}>`
    + (d.retencionIva ? `<cfdi:Retenciones><cfdi:Retencion${attrs({ Impuesto: '002', Importe: money(t.retencion) })}/></cfdi:Retenciones>` : '')
    + `<cfdi:Traslados><cfdi:Traslado${attrs({ Base: money(t.subtotal), Impuesto: '002', TipoFactor: 'Tasa', TasaOCuota: '0.160000', Importe: money(t.iva) })}/></cfdi:Traslados></cfdi:Impuestos>` : '';

  return `<?xml version="1.0" encoding="UTF-8"?>\n<!-- CFDI SIN TIMBRAR: falta sellar con el CSD del emisor y timbrar con un PAC (Sello, Certificado, NoCertificado y TimbreFiscalDigital). -->\n`
    + `<cfdi:Comprobante xmlns:cfdi="http://www.sat.gob.mx/cfd/4" xmlns:cartaporte31="http://www.sat.gob.mx/CartaPorte31" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xsi:schemaLocation="http://www.sat.gob.mx/cfd/4 http://www.sat.gob.mx/sitio_internet/cfd/4/cfdv40.xsd http://www.sat.gob.mx/CartaPorte31 http://www.sat.gob.mx/sitio_internet/cfd/CartaPorte/CartaPorte31.xsd"`
    + attrs({ Version: '4.0', Serie: d.serie.trim().toUpperCase(), Folio: d.folio.trim(), Fecha: cfdiDate(now), FormaPago: isI ? '99' : undefined, SubTotal: isI ? money(t.subtotal) : '0', Moneda: isI ? 'MXN' : 'XXX', Total: isI ? money(t.total) : '0', TipoDeComprobante: d.tipo, Exportacion: '01', MetodoPago: isI ? 'PUE' : undefined, LugarExpedicion: d.lugarExpedicion.trim() })
    + `>\n<cfdi:Emisor${attrs({ Rfc: emisorRfc, Nombre: d.emisor.nombre.toUpperCase(), RegimenFiscal: d.emisor.regimen })}/>`
    + `\n<cfdi:Receptor${attrs({ Rfc: receptor.rfc.trim().toUpperCase(), Nombre: receptor.nombre.toUpperCase(), DomicilioFiscalReceptor: receptor.cp.trim(), RegimenFiscalReceptor: receptor.regimen, UsoCFDI: receptor.uso })}/>`
    + `\n<cfdi:Conceptos>${concepto}</cfdi:Conceptos>${impuestos ? '\n' + impuestos : ''}\n<cfdi:Complemento>${ccp}</cfdi:Complemento>\n</cfdi:Comprobante>\n`;
}

// ---------------------------------------------------------------- PDF (representación impresa)
const toLatin1 = (s: string): string => Array.from(s).map((c) => (c.charCodeAt(0) < 256 ? c : c === '“' || c === '”' ? '"' : c === '–' || c === '—' ? '-' : '?')).join('');
const pdfEsc = (s: string): string => toLatin1(s).replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)');

function wrap(text: string, max: number): string[] {
  const out: string[] = []; let line = '';
  for (const w of text.split(/\s+/)) { if ((line + ' ' + w).trim().length > max) { if (line) out.push(line); line = w; } else line = (line + ' ' + w).trim(); }
  if (line) out.push(line); return out.length ? out : [''];
}

export function buildCartaPortePdf(d: CartaPorteData, idCcp: string, folioTxt: string, fecha: Date = new Date()): Uint8Array {
  const pages: string[] = []; let cur = ''; let y = 0;
  const W = 595; const H = 842; const L = 40; const MAXC = 100;
  const newPage = (): void => {
    if (cur) pages.push(cur);
    cur = `0.09 0.41 0.67 rg ${L} ${H - 70} ${W - 2 * L} 34 re f BT /F2 15 Tf 1 1 1 rg ${L + 10} ${H - 58} Td (${pdfEsc('CFDI con Complemento Carta Porte 3.1')}) Tj ET\n`
      + `BT /F1 8 Tf 0.35 0.4 0.45 rg ${L} ${H - 84} Td (${pdfEsc('Representación impresa preliminar · SIN TIMBRAR (no tiene validez fiscal hasta sellar y timbrar con un PAC)')}) Tj ET\n`;
    y = H - 102;
  };
  const text = (s: string, size = 9, bold = false, indent = 0, color = '0.09 0.16 0.25'): void => {
    for (const ln of wrap(s, Math.floor((MAXC - indent / 5) * (9 / size)))) {
      if (y < 50) newPage();
      cur += `BT /${bold ? 'F2' : 'F1'} ${size} Tf ${color} rg ${L + indent} ${y} Td (${pdfEsc(ln)}) Tj ET\n`; y -= size + 4;
    }
  };
  const section = (title: string): void => { y -= 4; if (y < 80) newPage(); cur += `0.94 0.96 0.99 rg ${L} ${y - 4} ${W - 2 * L} 16 re f\n`; text(title.toUpperCase(), 9, true, 4, '0.06 0.15 0.25'); y -= 2; };
  const kv = (k: string, v: string): void => text(`${k}: ${v || '—'}`, 9, false, 6);
  const t = importes(d);
  newPage();
  text(`${d.tipo === 'I' ? 'Ingreso' : 'Traslado'} · Serie ${d.serie.toUpperCase()} Folio ${folioTxt}`, 11, true);
  kv('Fecha de expedición', cfdiDate(fecha)); kv('IdCCP', idCcp); kv('Lugar de expedición (C.P.)', d.lugarExpedicion);
  kv('Tipo de comprobante', d.tipo === 'I' ? 'I · Ingreso' : 'T · Traslado'); kv('Transporte internacional', d.transpInternac ? 'Sí' : 'No');
  section('Emisor'); kv('RFC', d.emisor.rfc.toUpperCase()); kv('Nombre', d.emisor.nombre); kv('Régimen fiscal', d.emisor.regimen);
  section('Receptor');
  if (d.tipo === 'I') { kv('RFC', d.receptor.rfc.toUpperCase()); kv('Nombre', d.receptor.nombre); kv('Domicilio fiscal (C.P.)', d.receptor.cp); kv('Régimen fiscal', d.receptor.regimen); kv('Uso del CFDI', d.receptor.uso); }
  else { kv('RFC', d.emisor.rfc.toUpperCase()); kv('Nombre', d.emisor.nombre); kv('Uso del CFDI', 'S01 · Sin efectos fiscales'); }
  section('Concepto');
  if (d.tipo === 'I') { kv('Descripción', d.concepto.descripcion); kv('Subtotal', `$${t.subtotal.toFixed(2)}`); kv('IVA trasladado 16%', `$${t.iva.toFixed(2)}`); if (d.retencionIva) kv('IVA retenido 4%', `$${t.retencion.toFixed(2)}`); kv('Total', `$${t.total.toFixed(2)} MXN`); }
  else { kv('Descripción', 'Traslado de mercancías'); kv('Valor', '$0 (traslado) · Moneda XXX'); }
  section(`Ubicaciones · distancia total ${totalDistancia(d).toFixed(2)} km`);
  d.ubicaciones.forEach((u, i) => {
    text(`${u.tipo === 'Origen' ? 'Origen' : 'Destino'} ${i === 0 ? '' : i}  ·  ${u.nombre} (${u.rfc.toUpperCase()})`, 9, true, 6);
    text(`${u.calle} ${u.numExt}, ${u.colonia}, ${u.municipio}, ${u.estado}, C.P. ${u.cp}, MEX`, 9, false, 14);
    text(`${u.tipo === 'Origen' ? 'Salida' : 'Llegada'}: ${u.fechaHora.replace('T', ' ')}${u.tipo === 'Origen' ? '' : `  ·  Distancia: ${(u.distancia ?? 0).toFixed(2)} km`}`, 9, false, 14);
  });
  section(`Mercancías · ${d.mercancias.length} · peso bruto total ${pesoTotal(d).toFixed(3)} KGM`);
  d.mercancias.forEach((m, i) => {
    text(`${i + 1}. ${m.descripcion}`, 9, true, 6);
    text(`Clave ${m.bienes} · Cantidad ${m.cantidad} ${m.claveUnidad} · Peso ${m.pesoKg} kg · Valor $${(m.valor ?? 0).toFixed(2)} ${m.moneda}${m.materialPeligroso ? ` · Material peligroso ${m.cveMaterialPeligroso.toUpperCase()}` : ''}`, 9, false, 14);
    if (d.transpInternac) text(`Fracción arancelaria ${m.fraccion} · Materia ${m.tipoMateria} · Documento ${m.tipoDocumento}${m.pedimento ? ' ' + m.pedimento : ''}`, 9, false, 14);
  });
  if (d.transpInternac) { section('Comercio exterior'); kv('Operación', d.comercio.entradaSalida); kv('País origen/destino', d.comercio.pais.toUpperCase()); kv('Vía', `${d.comercio.via} · Autotransporte`); kv('Régimen aduanero', d.comercio.regimen); }
  section('Autotransporte');
  kv('Configuración vehicular', d.auto.config); kv('Permiso SICT', `${d.auto.permTipo} · ${d.auto.permNum}`); kv('Placa', d.auto.placa.toUpperCase()); kv('Año modelo', String(d.auto.anio ?? '')); kv('Peso bruto vehicular', `${d.auto.pesoBrutoVehicular ?? ''} t`);
  kv('Aseguradora (resp. civil)', d.auto.aseguradora); kv('Póliza', d.auto.poliza);
  d.auto.remolques.forEach((r, i) => kv(`Remolque ${i + 1}`, `${r.subtipo.toUpperCase()} · ${r.placa.toUpperCase()}`));
  section('Figuras de transporte');
  d.figuras.forEach((f) => text(`${f.tipo === '01' ? 'Operador' : f.tipo === '02' ? 'Propietario' : f.tipo === '03' ? 'Arrendador' : 'Notificado'} · ${f.nombre} · RFC ${f.rfc.toUpperCase()}${f.tipo === '01' ? ` · Licencia ${f.licencia}` : ''}`, 9, false, 6));
  y -= 8; text('Este documento debe viajar con la mercancía (impreso o digital) para acreditar su legal tenencia y estar disponible para verificaciones de la autoridad en puntos de control.', 8, false, 0, '0.35 0.4 0.45');
  pages.push(cur);

  // --- ensamblado PDF ---
  const objs: string[] = []; const add = (s: string): number => { objs.push(s); return objs.length; };
  add('<< /Type /Catalog /Pages 2 0 R >>'); add('PLACEHOLDER'); // 2 = Pages
  const f1 = add('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>');
  const f2 = add('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>');
  const kids: number[] = [];
  pages.forEach((content, i) => {
    const total = `BT /F1 8 Tf 0.35 0.4 0.45 rg ${W - 120} 24 Td (${pdfEsc(`Página ${i + 1} de ${pages.length}`)}) Tj ET\n`;
    const body = toLatin1(content + total);
    const c = add(`<< /Length ${body.length} >>\nstream\n${body}\nendstream`);
    kids.push(add(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${W} ${H}] /Resources << /Font << /F1 ${f1} 0 R /F2 ${f2} 0 R >> >> /Contents ${c} 0 R >>`));
  });
  objs[1] = `<< /Type /Pages /Count ${kids.length} /Kids [${kids.map((k) => `${k} 0 R`).join(' ')}] >>`;
  let pdf = '%PDF-1.4\n'; const offsets: number[] = [];
  objs.forEach((o, i) => { offsets.push(pdf.length); pdf += `${i + 1} 0 obj\n${o}\nendobj\n`; });
  const xref = pdf.length;
  pdf += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n${offsets.map((o) => `${String(o).padStart(10, '0')} 00000 n \n`).join('')}trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
  const bytes = new Uint8Array(pdf.length); for (let i = 0; i < pdf.length; i += 1) bytes[i] = pdf.charCodeAt(i) & 255;
  return bytes;
}
