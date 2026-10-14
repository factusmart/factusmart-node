# Cambios

## 1.1.0 — 2026-10-14

- Los errores traen `codigo` (ej. `NO_AUTENTICADO`, `DATOS_INVALIDOS`), `reintentable` y `campos`
  (errores por campo). Con servidores anteriores que no los mandan: `codigo` y `reintentable` son
  `null` y `campos` es `{}`. Nuevo export `CODIGOS_DE_ERROR` y tipo `CodigoDeError`.
- Reintentos: en las operaciones ya reintentables (GET, `comprobantes.emitir`, `rucs.crear`) también
  se reintenta cuando el API responde `reintentable: true`. Las operaciones que nunca se reintentan
  siguen igual.
- Nuevo `verificarFirmaWebhook(cuerpoCrudo, firma, secreto)` (también `FactuSmart.verificarFirmaWebhook`)
  para validar el header `X-FactuSmart-Firma` de los webhooks.
- `comprobantes.descargar()` de un comprobante inexistente: el API ahora responde 404 en JSON y el SDK
  lanza `NoEncontrado` con su `message` y `codigo: 'NO_ENCONTRADO'`.
- Nuevo `comprobantes.calcular(items, { porcentaje_igv }?)` (`POST /calcular`): FactuSmart calcula
  `items` y `totales`. Admite `precio_unitario` con IGV y la tasa 10.5 % (Ley 31556). No emite ni
  cobra; se reintenta como un GET. `FactuSmart.calcularComprobante` (local, sin red) se mantiene.
- Nuevo recurso `catalogos`: `listar()` (`GET /catalogos`) y `consultar(nombre, { q, ruc }?)`
  (`GET /catalogos/{nombre}`, por nombre o número SUNAT).
- `reintentable: false` en el cuerpo del error manda: no se reintenta aunque el HTTP sea
  429/409/5xx. El 429 `LIMITE_PRUEBAS_DIARIO` (tope de 200 operaciones/día en RUCs demo) lanza
  `LimiteDePeticiones` tras una sola petición.
- Anulaciones de boletas (resumen diario): tipos de `anulaciones.crear` con `tipo` (`baja` |
  `resumen`), `identificador`, `credito_cobrado`, `modo_demo` y `pruebas_restantes_hoy`; y de
  `anulaciones.estado` con `tipo` y `documentos[]`.
- Tipos de emisión y guías con `credito_cobrado`, `modo_demo` y `pruebas_restantes_hoy` (en RUCs
  demo no se cobra crédito).
- `CODIGOS_DE_ERROR` suma `LIMITE_PRUEBAS_DIARIO`, `ANULACION_MIXTA` y `LLAVE_DE_PRUEBA_EN_PRODUCCION`.

## 1.0.x — 2026-10

- Primera versión publicada: cuenta, series, comprobantes, anulaciones, guías y RUCs;
  `calcularComprobante`, reintentos con `Idempotency-Key` y errores tipados.
