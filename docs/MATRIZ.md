# Matriz de pantallas y funcionalidades — EnRuta

**Estado inicial**: lo encontrado en el código original (commit `9570048`).
**Estado final**: lo implementado. ✅ implementado y cubierto por pruebas
automatizadas · 🟢 implementado (verificación manual/dispositivo pendiente) ·
📱 depende de hardware/plugin real: validar en dispositivo.

| Ruta | Estado inicial | Estado final | Criterio de aceptación / prueba |
|---|---|---|---|
| /splash | `Timer` ficticio | ✅ Progreso por 5 tareas reales (BD+migraciones, evidencias, seed, sesión, limpieza/cola); error con *Reintentar*; destino según sesión/onboarding | `widget_flows_test`: arranque y reintento |
| /welcome | No guardaba | ✅ 3 páginas (conductor, negocio, datos locales); bandera persistida; desplazable en pantallas pequeñas | `widget_flows_test` |
| /login | Entraba con cualquier dato; portal sin autenticar | ✅ Empresa+usuario+PIN contra SQLite (PBKDF2), 5 intentos → bloqueo 5 min, ruta por rol, guardas en router, cierre de sesión. Biometría retirada (no estaba implementada) | `auth_test`, `widget_flows_test` |
| /register, /register/pin | Sin persistencia | ✅ Invitación (usos/expiración), validación junto al campo, duplicados, PIN con confirmación y reglas, cuenta “sin verificar” | `auth_test` |
| /verify | Aceptaba cualquier código | ✅ Código aleatorio con hash, 10 min, 5 intentos, reenvío a 30 s; aviso “no se envían SMS” | `auth_test` |
| /recover | Sin flujo | ✅ Identificar → código → nuevo PIN confirmado | `auth_test` |
| /pending | “Actualizar” aprobaba | ✅ Lee estado persistido; aprobación solo en `/dev` | `auth_test` |
| /permissions | Interruptores falsos | ✅ Estado real (concedido/no/permanente/restringido), *Permitir*, *Abrir ajustes*, consecuencias; se continúa sin permisos 📱 | `widget_flows_test` (servicio simulado) |
| /load | Memoria; “confirmar todo” | ✅ Esperado vs contado, “Conté N” por línea, escáner, motivo obligatorio, km ≥ odómetro, avance persistido, inventario inicial una vez | `journeys_test` |
| /incidencia-carga | Reutilizaba pantalla del cliente | ✅ Ligada a jornada, línea y producto; fotos reales; folio INC | `screens_with_data_test` |
| /departure | “CFDI” sin timbrar | ✅ Valida carga/km; hora y folio SAL local; pedidos “En camino”; hoja PDF marcada como no fiscal; seguimiento en primer plano | `journeys_test` |
| /ruta | Lista vacía en memoria | ✅ Estado de jornada restaurado, KPIs reales, siguiente parada, filtros pendientes/atendidas/todas | `screens_with_data_test` |
| /mapa | Token incrustado; línea recta; ETA | ✅ Token externo; sin token/red: aviso y operación por lista; marcadores con coordenadas guardadas; trazado vial solo con Mapbox Directions (sin línea recta); sin ETA; llegada con ubicación honesta 📱 | `widget_flows_test` (sin token) |
| /cliente | “Parada actual” global | ✅ Por `stop`/`customer`; saldo, crédito disponible, documentos, visitas, auditorías y acciones | `screens_with_data_test` |
| /preventa | Solo encolaba | ✅ Pedido y partidas persistidos, crédito validado, consulta en `/pedido/:id`, sin tocar inventario | `journeys_test` (crédito) |
| /entrega | Memoria; devoluciones por motivo | ✅ Cantidades reales, existencia por producto, motivos, parcial, borrador persistente, devoluciones por SKU/cantidad/motivo/condición | `journeys_test`, `rules_test` |
| /evidencia | Fotos contador; GPS en `build`; ∞ | ✅ 1–3 fotos reales con vista previa/eliminar, firma PNG, receptor, ubicación una vez (actual/última/no disponible), transacción atómica 📱 | `journeys_test`, `rules_test` |
| /no-entrega | Foto booleana | ✅ Motivo, notas, foto real, reprogramación solo con motivos permitidos, inventario intacto | `journeys_test` |
| /cobro | Selección por índice | ✅ Documentos por ID, aplicación por vencimiento, efectivo con cambio, transferencia/tarjeta con referencia, idempotente, PDF | `journeys_test`, `rules_test` |
| /auditoria | Foto booleana | ✅ Productos/cantidades/agotados, visibilidad, frentes, notas, fotos; consulta `?id=` | `screens_with_data_test` |
| /escaner | Sin control | 🟢 Catálogo local (EAN-13/8, UPC-A, Code128), manual, código desconocido, permiso denegado, antirrebote, libera cámara 📱 | búsqueda por código en `rules_test` |
| /inventario | `clamp` ocultaba negativos | ✅ Cargado/entregado/devuelto/dañado/disponible y movimientos; negativos visibles como inconsistencia | `journeys_test` |
| /entregada | Snack “Comprobante” | ✅ Registro persistido, saldos, cobros aplicados, evidencias, PDF real, siguiente parada calculada | `screens_with_data_test` |
| /corte | Solo faltante | ✅ Venta entregada, cobros por método, sobrante/faltante vs tolerancia, conciliación de inventario, km, paradas pendientes o cierre excepcional, borrador persistente, una sola vez | `journeys_test`, `rules_test` |
| /cerrada | Datos en memoria | ✅ Estado real (enviado/aprobado/rechazado), sincronización independiente, PDF | `journeys_test` |
| /historial | Limitado a 7 | ✅ Todas las jornadas, filtro por fechas, detalle con paradas, cobros, incidencias y PDFs | `journeys_test` |
| /sync | Transporte devolvía `true` | ✅ Red / datos locales / servidor por separado, pendientes y errores, sin falso éxito | `migration_sync_test` |
| /planeacion | No existía | ✅ Crear jornada, asignar/retirar pedidos con regla explícita | `journeys_test` |
| /negocio/entregas | Sin datos | ✅ Pedidos en curso/anteriores del negocio autenticado, evolución de estado | `screens_with_data_test` |
| /negocio/pedir + /negocio/carrito | Lista sin carrito | ✅ Búsqueda, categorías, carrito en SQLite, domicilio, notas, crédito, folio, cancelación | `widget_flows_test` (recorrido A) |
| /negocio/cuenta | Saldo en memoria | ✅ Perfil y contacto editables, saldo/crédito, documentos, pagos, cambio de PIN, salir | `screens_with_data_test` |
| /negocio/incidencia | Foto booleana | ✅ Ligada a pedido/entrega propios (validado en repositorio), tipo, descripción, fotos (cámara/galería), folio y seguimiento | `screens_with_data_test` |
| /pedido/:id, /comprobante/:tipo/:id | No existían | ✅ Detalle compartido con control de acceso por negocio; PDF de entrega, cobro, pedido, salida y corte 📱 (vista previa/compartir) | `screens_with_data_test` |
| /dev | No existía | ✅ Aprobaciones, cortes, incidencias, buzón local, restablecer con confirmación | `journeys_test` (reset) |

## Problemas reportados y su resolución

| Problema | Resolución |
|---|---|
| Login sin cuenta | Validación contra SQLite con hash y bloqueo |
| Portal sin autenticar | Guardas del router por rol + verificación de propiedad |
| PIN en sesión | La sesión solo guarda el ID; PIN nunca se persiste ni se registra |
| Código cualquiera | Código aleatorio con hash, expiración e intentos |
| “Actualizar” aprobaba | Estado persistido; aprobación explícita en `/dev` |
| Permisos falsos | `permission_handler` + ajustes del sistema |
| Dominio en memoria | Repositorios SQLite como fuente de verdad |
| Transporte con éxito ficticio | `NoBackendTransport` nunca confirma |
| Fotos como contadores | Archivos reales referenciados desde SQLite |
| Comprobantes de mentira | PDF generados con los registros |
| Catálogo sin carrito | Carrito persistente y pedido con folio |
| Devoluciones por motivo | Devoluciones por SKU, cantidad, motivo y condición |
| Venta con importe original | Venta = cantidades entregadas × precio |
| Cobros sin saldos | Aplicaciones por documento y saldos en la transacción |
| “Parada actual” global | Rutas con ID explícito |
| Cierre incompleto | Reglas de tolerancia, inventario, pendientes y km; único por jornada |
| Token de Mapbox incrustado | `--dart-define` (`config/env.example.json`) |
| Falta `ios/` | Proyecto iOS generado y configurado |
| Controladores sin liberar | `dispose` en controladores, temporizadores y cámara |
| Doble pulsación | `PrimaryButton` bloquea mientras trabaja + claves idempotentes |
| Ubicación antigua / ∞ / en `build` | `LocationFix` con tipo y antigüedad, sin ∞, obtenida una vez |
