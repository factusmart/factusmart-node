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

## 1.0.x — 2026-10

- Primera versión publicada: cuenta, series, comprobantes, anulaciones, guías y RUCs;
  `calcularComprobante`, reintentos con `Idempotency-Key` y errores tipados.
