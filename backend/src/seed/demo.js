'use strict';
// Datos DEMO. Solo los usa `npm run seed:reset` y las pruebas. Todo es ficticio.
const bcrypt = require('bcryptjs');
const { uuid, iso } = require('../utils/ids');
const { createSystemRoles } = require('../services/bootstrap');

const DEMO_PASSWORD = 'Demo12345678';

async function seedDemo(store, { bcryptCost = 12, now = new Date() } = {}) {
  const t = iso(now); const hash = await bcrypt.hash(DEMO_PASSWORD, bcryptCost);
  const summary = { password: DEMO_PASSWORD, companies: [] };

  await store.tx(async (r) => {
    async function company({ rfc, legalName, centers, users, clients, products }) {
      const c = await r.companies.create({ id: uuid(), rfc, legalName, industry: 'Distribución de consumo', country: 'México', timezone: 'America/Mexico_City', fiscalStatus: 'SIMULATED', createdAt: t });
      const roles = await createSystemRoles(r, c.id, t);
      const byName = {};
      for (const def of centers) {
        const center = await r.centers.create({ id: uuid(), companyId: c.id, name: def.name, code: def.code, createdAt: t }); byName[def.name] = { center, zones: {} };
        for (const z of def.zones) byName[def.name].zones[z] = await r.zones.create({ id: uuid(), companyId: c.id, centerId: center.id, name: z, createdAt: t });
      }
      for (const u of users) {
        const user = await r.users.create({ id: uuid(), companyId: c.id, email: u.email, name: u.name, phone: u.phone || null, passwordHash: hash, roleId: roles[u.role].id, defaultCenterId: byName[u.centers[0]].center.id, createdAt: t });
        await r.users.setCenters(user.id, u.centers.map((n) => byName[n].center.id));
      }
      for (const cl of clients) {
        const entry = byName[cl.center];
        await r.clients.create({ id: uuid(), companyId: c.id, centerId: entry.center.id, zoneId: entry.zones[cl.zone]?.id ?? null, code: cl.code, name: cl.name, address: cl.address, lat: cl.lat, lng: cl.lng, phone: cl.phone || null });
      }
      for (const p of products) await r.products.create({ id: uuid(), companyId: c.id, ...p });
      await r.audit.append({ companyId: c.id, actorName: 'Seed', action: 'seed.demo', detail: { users: users.length, clients: clients.length }, createdAt: t });
      summary.companies.push({ id: c.id, name: legalName, users: users.map((u) => `${u.email} (${u.role})`) });
    }

    await company({
      rfc: 'EDE210101AB1', legalName: 'EnRuta Demo SA de CV',
      centers: [{ name: 'Matriz', code: 'MTZ', zones: ['Centro', 'Poniente'] }, { name: 'Norte', code: 'NOR', zones: ['Industrial'] }, { name: 'Sur', code: 'SUR', zones: ['Costa'] }],
      users: [
        { email: 'demo@enruta.mx', name: 'Administrador de prueba', role: 'Administrador', centers: ['Matriz', 'Norte', 'Sur'], phone: '5551234567' },
        { email: 'supervisor@enruta.mx', name: 'Sara Supervisora', role: 'Supervisor', centers: ['Matriz', 'Norte'] },
        { email: 'repartidor@enruta.mx', name: 'Rafael Repartidor', role: 'Repartidor', centers: ['Matriz'] },
        { email: 'repartidor2@enruta.mx', name: 'Rosa Repartidora', role: 'Repartidor', centers: ['Norte'] },
        { email: 'preventista@enruta.mx', name: 'Pablo Preventista', role: 'Preventista', centers: ['Matriz'] },
      ],
      clients: [
        { center: 'Matriz', zone: 'Centro', code: 'C-001', name: 'Abarrotes La Esquina', address: 'Calle Enríquez 12, Xalapa', lat: 19.5438, lng: -96.9102 },
        { center: 'Matriz', zone: 'Centro', code: 'C-002', name: 'Tienda Doña Lupe', address: 'Av. Lázaro Cárdenas 80, Xalapa', lat: 19.5321, lng: -96.9145 },
        { center: 'Matriz', zone: 'Poniente', code: 'C-003', name: 'Minisúper El Roble', address: 'Blvd. Arco Sur 200, Xalapa', lat: 19.5203, lng: -96.9301 },
        { center: 'Norte', zone: 'Industrial', code: 'C-101', name: 'Cremería Norteña', address: 'Carr. Xalapa-Perote km 5', lat: 19.5811, lng: -96.9004 },
        { center: 'Norte', zone: 'Industrial', code: 'C-102', name: 'Autoservicio Las Palmas', address: 'Calle Industria 45', lat: 19.5902, lng: -96.8951 },
        { center: 'Sur', zone: 'Costa', code: 'C-201', name: 'Mariscos El Faro', address: 'Malecón 3, Veracruz', lat: 19.1903, lng: -96.1342 },
      ],
      products: [
        { sku: 'AGU-600', name: 'Agua purificada 600 ml', category: 'Bebidas', unit: 'pieza' }, { sku: 'REF-2L', name: 'Refresco cola 2 L', category: 'Bebidas', unit: 'pieza' },
        { sku: 'GAL-12', name: 'Galletas surtidas (12 pzas)', category: 'Botanas', unit: 'caja' }, { sku: 'ARR-1K', name: 'Arroz 1 kg', category: 'Abarrotes', unit: 'bolsa' }, { sku: 'ACE-900', name: 'Aceite vegetal 900 ml', category: 'Abarrotes', unit: 'botella' },
      ],
    });
    await company({
      rfc: 'DNO200315CD2', legalName: 'Distribuidora Norte SA de CV',
      centers: [{ name: 'Matriz', code: 'MTZ', zones: ['Centro'] }, { name: 'Monterrey', code: 'MTY', zones: ['Sur'] }],
      users: [
        { email: 'admin@norte.mx', name: 'Admin Norte', role: 'Administrador', centers: ['Matriz', 'Monterrey'] },
        { email: 'repartidor@norte.mx', name: 'Rodrigo Norte', role: 'Repartidor', centers: ['Matriz'] },
      ],
      clients: [
        { center: 'Matriz', zone: 'Centro', code: 'N-001', name: 'Súper Regio', address: 'Av. Constitución 100, Monterrey', lat: 25.6714, lng: -100.309 },
        { center: 'Monterrey', zone: 'Sur', code: 'N-002', name: 'Tienda San Pedro', address: 'Calzada del Valle 5, San Pedro', lat: 25.6503, lng: -100.3897 },
      ],
      products: [{ sku: 'AGU-600', name: 'Agua purificada 600 ml', category: 'Bebidas', unit: 'pieza' }, { sku: 'CAR-1K', name: 'Carne seca 1 kg', category: 'Abarrotes', unit: 'bolsa' }],
    });
  });
  return summary;
}
module.exports = { seedDemo, DEMO_PASSWORD };
