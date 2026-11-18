'use strict';
// Catálogo de permisos (DT-20). Los códigos son estables: se citan en rutas, pruebas y en el front.
const CATALOG = [
  ['Catálogo', 'catalog.read', 'Ver productos'], ['Catálogo', 'catalog.write', 'Crear y editar productos'],
  ['Clientes', 'clients.read', 'Ver clientes'], ['Clientes', 'clients.write', 'Crear y editar clientes'],
  ['Precios', 'prices.read', 'Ver precios de otros canales'], ['Precios', 'prices.write', 'Administrar listas de precios y promociones'],
  ['Datos', 'import.run', 'Importar datos'],
  ['Rutas', 'routes.read', 'Ver rutas'], ['Rutas', 'routes.write', 'Crear y editar rutas'], ['Rutas', 'routes.submit', 'Enviar rutas a aprobación'],
  ['Rutas', 'routes.approve', 'Aprobar y publicar rutas'], ['Rutas', 'routes.start_outside_window', 'Iniciar ruta fuera del horario de embarque'], ['Rutas', 'routes.cancel', 'Cancelar rutas'],
  ['Operación', 'deliveries.execute', 'Entregar y capturar evidencia'], ['Operación', 'payments.collect', 'Cobrar en ruta'],
  ['Operación', 'discounts.apply', 'Aplicar descuentos'], ['Operación', 'discounts.over_limit', 'Exceder el tope de descuento'], ['Operación', 'credit.authorize', 'Autorizar crédito'],
  ['Inventario', 'inventory.read', 'Ver inventario, cargas, pedidos y activos'], ['Inventario', 'inventory.manage', 'Ajustar stock, cargar rutas y administrar activos en comodato'], ['Inventario', 'orders.manage', 'Capturar y cancelar pedidos de preventa'],
  ['Liquidaciones', 'settlements.read', 'Ver liquidaciones'], ['Liquidaciones', 'settlements.manage', 'Registrar liquidaciones y depósitos'], ['Liquidaciones', 'settlements.authorize', 'Autorizar diferencias'],
  ['Monitoreo', 'tracking.read', 'Ver torre de control y evidencias'], ['Monitoreo', 'simulator.run', 'Ejecutar el simulador de recorrido'],
  ['Análisis', 'reports.read', 'Ver indicadores'], ['Análisis', 'audit.read', 'Ver bitácora de auditoría'],
  ['Administración', 'users.read', 'Ver usuarios'], ['Administración', 'users.manage', 'Administrar usuarios'], ['Administración', 'roles.manage', 'Administrar roles y permisos'],
  ['Administración', 'centers.manage', 'Administrar centros y zonas'], ['Administración', 'centers.all', 'Acceder a todos los centros'],
  ['Administración', 'config.manage', 'Editar configuración'], ['Administración', 'config.publish', 'Publicar configuración'],
  ['Administración', 'devices.manage', 'Administrar dispositivos'], ['Administración', 'fiscal.manage', 'Emitir Carta Porte'],
].map(([group, code, label]) => ({ group, code, label }));

const ALL = CATALOG.map((p) => p.code);
const FIELD = ['deliveries.execute', 'payments.collect', 'discounts.apply', 'routes.read', 'clients.read', 'catalog.read', 'prices.read'];

// Roles de sistema (DT-21): editables, no eliminables.
const SYSTEM_ROLES = [
  { name: 'Administrador', description: 'Acceso total a la empresa.', maxDiscountBp: 10000, permissions: ALL },
  { name: 'Supervisor', description: 'Opera rutas, aprobaciones y liquidaciones de sus centros.', maxDiscountBp: 1500,
    permissions: ALL.filter((c) => !['users.manage', 'roles.manage', 'config.manage', 'config.publish', 'fiscal.manage', 'centers.manage', 'centers.all'].includes(c)) },
  { name: 'Repartidor', description: 'Entrega, cobra y captura evidencia en ruta.', maxDiscountBp: 500, permissions: FIELD },
  { name: 'Preventista', description: 'Toma pedidos de preventa y visita clientes.', maxDiscountBp: 500, permissions: [...FIELD, 'clients.write', 'orders.manage'] },
];

module.exports = { CATALOG, ALL, SYSTEM_ROLES };
