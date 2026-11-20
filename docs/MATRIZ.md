# Matriz de pantallas y funcionalidades — EnRuta

Esta matriz dirige la implementación. La columna **Estado inicial** refleja lo que se
encontró en el código (commit `9570048`); **Estado final** se completa al terminar.

| Ruta | Acción principal | Estado inicial (auditoría) | Criterio de aceptación |
|---|---|---|---|
| /splash | Inicializar | Barra de progreso con `Timer` ficticio; no abre BD | Progreso por tareas reales (BD, migraciones, seed, sesión, archivos); error con reintento; restaura destino |
| /welcome | Onboarding | Carrusel; no guarda que se completó | Guarda bandera; explica conductor y negocio |
| /login | Acceder | Entra con cualquier dato; PIN en estado; “Entrar como negocio” sin autenticar | Valida empresa+usuario+PIN (hash) contra SQLite; límite de intentos; ruta por rol; guardas |
| /register, /register/pin | Registrar | Valida longitud; no guarda nada; PIN sin confirmación | Invitación válida, duplicados, PIN confirmado y con hash, registro persistido |
| /verify | Verificar | Acepta cualquier código de 6 dígitos | Código local con hash, expiración, intentos, reenvío; aviso “no se envía SMS” |
| /recover | Recuperar PIN | Redirige a /verify sin cuenta | Identifica cuenta, código, nuevo PIN confirmado |
| /pending | Consultar aprobación | “Actualizar” aprueba | Lee estado persistido; aprobación solo desde herramientas locales |
| /permissions | Permisos | Interruptores sin efecto | Estado real (concedido/denegado/permanente), solicitar, abrir ajustes |
| /load | Confirmar carga | Estado en memoria vacío; “confirmar todo” | Contado vs esperado, escáner, motivos, km, inventario inicial una vez |
| /incidencia-carga | Reportar | Reutilizaba pantalla del cliente | Incidencia ligada a jornada/producto con fotos reales y folio |
| /departure | Iniciar ruta | Muestra “CFDI Carta Porte” sin timbrado | Valida carga, km y hora; seguimiento; comprobante operativo local (no CFDI) |
| /ruta | Ver paradas | Lista en memoria vacía | Paradas desde BD, filtros, KPIs reales, siguiente parada coherente, restaura jornada |
| /mapa | Navegar/llegada | Token incrustado; línea recta como ruta; ETA | Token externo, estados de error/offline, llegada con ubicación honesta, sin ETA inventado |
| /cliente | Atender parada | Depende de “parada actual” global | Abre por `stop`/`customer` ID; saldo, docs, visitas, acciones |
| /preventa | Crear pedido | Solo encola JSON | Pedido y partidas persistidos, crédito validado, consultable |
| /entrega | Capturar entrega | Memoria; devoluciones por motivo | Cantidades, disponibilidad, motivos, borrador, devoluciones por SKU/condición |
| /evidencia | Evidencia | Fotos = contador; GPS en `build`; precisión ∞ | Fotos/firma en archivos, ubicación honesta una vez, transacción atómica |
| /no-entrega | No entrega | Foto booleana | Motivo, foto real, reprogramación por regla, sin tocar inventario |
| /cobro | Registrar cobro | Selección por índice; no actualiza saldos | Docs por ID, aplicación, cambio, referencias, idempotente, comprobante |
| /auditoria | Auditoría | Foto booleana; solo encola | Productos, cantidades, fotos reales, consultable |
| /escaner | Leer código | Sin control de duplicados/permiso | Catálogo local, manual, desconocido, permiso, libera cámara |
| /inventario | Existencias | `clamp` oculta negativos | Cargado/entregado/devuelto/dañado/disponible por movimientos |
| /entregada | Resultado | Snack “Comprobante generado” | Registro persistido + PDF real |
| /corte | Cerrar jornada | Solo faltante; venta = importe original | Ventas reales, cobros por método, sobrante/faltante, inventario, pendientes |
| /cerrada, /historial | Consultar | Historial en memoria limitado a 7 | Persistido, filtros por fecha, detalle, nueva jornada limpia |
| /sync | Estado | Transporte devuelve `true` siempre | Red ≠ servidor; sin backend nada se marca enviado |
| /negocio/entregas | Seguimiento | Sin datos | Pedidos/entregas del cliente autenticado, detalle, comprobantes |
| /negocio/pedir | Pedir | Lista sin carrito | Búsqueda, filtros, carrito persistido, crédito, folio, cancelación |
| /negocio/cuenta | Cuenta | Saldo en memoria | Perfil editable, saldo, documentos, pagos, cambio de PIN, salir |
| /negocio/incidencia | Reportar | Foto booleana; sin vínculo | Ligada a pedido/entrega, fotos, folio, seguimiento |
