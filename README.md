# EnRuta

App Flutter de gestión de rutas, reparto, entregas, cobranza e inventario con dos
experiencias que comparten la misma base local:

- **Conductor/repartidor** (azul marino + ámbar): carga, salida, ruta, mapa,
  entregas con evidencia, no entregas, devoluciones, cobros, preventa,
  auditorías, inventario de la unidad, corte e historial.
- **Negocio/cliente** (esmeralda): catálogo con carrito persistente, pedidos con
  folio y seguimiento, entregas y comprobantes, saldo y pagos, reportes de
  problemas.

Funciona **sin servidor**: SQLite es la base operativa y la fuente de verdad. La
sincronización remota está preparada (cola persistente + contrato HTTP), pero
**no hay servidor conectado** y nada se marca como enviado.

> **Importante:** SQLite vive dentro de cada teléfono. Los datos **no** se
> comparten automáticamente con otros teléfonos ni con el panel Angular. El flujo
> compartido cliente → pedido → conductor → entrega se prueba **en una misma
> instalación**, cambiando de cuenta. No existe seguimiento remoto entre
> dispositivos mientras no se implemente un transporte.

Documentación: [arquitectura y guía de integración](docs/ARQUITECTURA.md) ·
[matriz de pantallas](docs/MATRIZ.md).

## Requisitos

- Flutter **3.50.1** (stable) / Dart 3.14 — verificado con esa versión.
- Android: SDK 36 (compile/target), mínimo API 24, JDK 17+.
- iOS: macOS con Xcode, iOS 15.0 o superior.

## Ejecutar

```bash
flutter pub get
```

```bash
cp config/env.example.json config/env.json
```

Edita `config/env.json` (opcional):

| Clave | Uso |
|---|---|
| `MAPBOX_ACCESS_TOKEN` | Token público `pk.*` de Mapbox. Vacío ⇒ el mapa indica “no configurado” y la app sigue operando desde la lista. |
| `ENRUTA_API_BASE_URL` | URL de la futura API de sincronización. Vacío ⇒ servidor “no configurado”. |
| `ENRUTA_DEV_TOOLS` | `true` muestra cuentas demo y herramientas locales también en release. En debug siempre están activas. |

```bash
flutter run --dart-define-from-file=config/env.json
```

Pruebas y análisis:

```bash
flutter analyze
```

```bash
flutter test
```

Compilaciones:

```bash
flutter build apk --release --dart-define-from-file=config/env.json
```

```bash
flutter build ios --release --dart-define-from-file=config/env.json
```

> El token de Mapbox que estaba incrustado en `lib/core/config.dart` se eliminó
> del código, pero sigue en el historial de git: **revócalo o rótalo** en la
> cuenta de Mapbox y restringe el nuevo token por URL/app.

## Cuentas y datos de demostración

Al primer arranque se inserta (una sola vez) la empresa ficticia
**Distribuidora Demo del Golfo** (código `DEMO`). Los registros demo llevan
`is_demo = 1` y las cuentas se marcan “Cuenta de demostración” en la app.

| Rol | Usuario | PIN | Negocio |
|---|---|---|---|
| Conductor | `chofer` | `2580` | — |
| Negocio (crédito $15,000) | `esperanza` | `1357` | Abarrotes La Esperanza |
| Negocio (crédito $8,000) | `elsol` | `2468` | Minisúper El Sol |

Invitaciones para registrar cuentas nuevas (quedan *pendientes* hasta aprobarlas):
`CHOFER-DEMO` (conductor, 10 usos), `NEGOCIO-VACA` (Cremería La Vaca, 1 uso),
`NEGOCIO-PEPE` (Tienda Don Pepe, contado, 1 uso).

Datos: 8 productos con EAN-13 válidos (prefijo 750), 4 clientes en Xalapa con
coordenadas, vehículos U-07 y U-12, facturas previas (algunas vencidas), jornada
de hoy `R-01` con 3 paradas/pedidos asignados y 1 pedido del negocio sin asignar.

**Herramientas de desarrollo** (`/dev`, desde el acceso o “Mi cuenta”):
aprobar/rechazar solicitudes de acceso, aprobar/rechazar cortes, cambiar el
estado de incidencias, ver el buzón local de SMS/correos simulados y
**restablecer los datos demo** (pide escribir `RESTABLECER`).

## Recorrido sugerido (A–G) en una sola instalación

1. **A.** Entra como `esperanza` → *Pedir* → agrega productos → *Ver carrito* →
   *Confirmar pedido* → consulta el pedido y su seguimiento.
2. **B.** Cierra sesión, entra como `chofer` → *Mi cuenta → Planeación local* →
   asigna el pedido a la ruta R-01 → *Confirmar carga* (cuenta cada producto,
   motivo en diferencias, km ≥ 48,210) → *Iniciar ruta*.
3. **C.** Atiende una parada → *Entregar pedido* (ajusta cantidades, registra una
   devolución) → evidencia (1–3 fotos, firma, nombre) → *Confirmar entrega*.
   Revisa *Inventario* y el saldo del cliente.
4. **D.** *Cobrar* → elige documentos → efectivo con cambio o transferencia con
   referencia → comprobante PDF. El *Corte* refleja el cobro.
5. **E.** Entra como `esperanza` → *Mis pedidos → Anteriores* → detalle y
   comprobante de la entrega.
6. **F.** Cierra la app por completo y vuelve a abrirla: jornada, borradores,
   carrito y resultados permanecen.
7. **G.** Como `chofer` → *Corte* (efectivo contado, conteo final, km,
   justificación o cierre excepcional) → *Cerrar jornada* → *Historial*. Aprueba
   el corte en `/dev`.

## Pruebas automatizadas

`flutter test` ejecuta 46 pruebas (ver resultados en el resumen de entrega):

| Archivo | Cobertura |
|---|---|
| `test/journeys_test.dart` | Recorridos A–G sobre SQLite real, idempotencia, no entrega, existencias, crédito, cancelación, seed único y restablecimiento |
| `test/auth_test.dart` | Login válido/inválido, bloqueo, PIN con hash, registro, verificación (incorrecto/expirado/intentos), aprobación/rechazo, recuperación, cambio de PIN |
| `test/migration_sync_test.dart` | Migración v1→v2 sin pérdida; cola sin falso éxito, dependencias, reintentos con espera y rechazos |
| `test/rules_test.dart` | Centavos, aplicación de pagos y cambio, reglas de carga/entrega/evidencia/corte, ubicación sin infinito, EAN-13 |
| `test/widget_flows_test.dart` | UI real: bienvenida, login inválido, permisos, separación de roles, mapa sin token, recorrido A en pantalla, cámara denegada, reintento de arranque, 320×568 con texto 200 % |
| `test/screens_with_data_test.dart` | Todas las pantallas operativas con datos reales (normal y 320×568 + 200 %), visibilidad entre roles y PDF |

## Servicios externos no conectados

- Backend de sincronización (API + PostgreSQL) y Firebase: solo contrato y cola.
- Autenticación remota, envío real de SMS/correo (códigos van al buzón local).
- Timbrado CFDI / Carta Porte (PAC): la hoja de salida y los comprobantes son
  documentos operativos locales, no fiscales.
- Procesamiento bancario o terminal de tarjeta: los cobros solo se registran.
- Almacenamiento remoto de fotos/firmas.
- Mapbox requiere token propio; no hay cálculo de tiempos estimados (ETA).
- Seguimiento del conductor en segundo plano y notificaciones push.

## Pendiente de validar en dispositivos

Ver la sección final del resumen de entrega y `docs/MATRIZ.md`: cámara real,
GPS real, escáner, WebView de Mapbox, compartir/imprimir PDF, permisos en
Android 13–15 e iOS 17–18, teclado y áreas seguras, y compilación iOS en Xcode.
