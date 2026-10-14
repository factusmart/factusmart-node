# factusmart — SDK de Node.js / TypeScript

SDK oficial del API de facturación electrónica de **FactuSmart** (SUNAT, Perú): emite facturas,
boletas, notas de crédito/débito y guías de remisión (GRE 2.0), anula facturas y boletas, calcula el
IGV y los totales, consulta los catálogos SUNAT, y descarga el PDF, el XML firmado y el CDR.

- Node.js 18 o superior. **Cero dependencias**: usa `fetch` nativo y `crypto.randomUUID`.
- ESM y CommonJS, con tipos TypeScript incluidos.
- Documentación del API: <https://factusmart.pe/api-facturacion-electronica/docs>

## Instalar

```bash
npm install factusmart
```

## Ejemplo en 10 líneas

```js
import FactuSmart from 'factusmart'   // o: const { FactuSmart } = require('factusmart')

const fs = new FactuSmart({ apiKey: 'TU_API_KEY', baseUrl: 'https://TU_URL_BASE/api/v1/issuer', ruc: '20123456789' })

const { items, totales } = FactuSmart.calcularComprobante([
  { descripcion: 'Servicio de consultoría', cantidad: 1, valor_unitario: 100, afectacion: '10' },
])

const r = await fs.comprobantes.emitir({
  codigo_tipo_documento: '01',
  datos_del_cliente_o_receptor: { codigo_tipo_documento_identidad: '6', numero_documento: '20555555555' },
  items, totales,
})

console.log(r.aceptado_por_sunat, r.serie_numero)
```

`baseUrl` **no es igual para todas las cuentas**: cada cuenta vive en un servidor distinto. Cópiala
de tu panel de integrador (pestaña Configuración, "URL base de la API").

## La regla de oro: HTTP 200 no significa "aceptado por SUNAT"

Un comprobante puede generarse bien y aun así no ser aceptado (SUNAT caída, rechazo, observación).
Eso **no lanza error**: el SDK devuelve la respuesta tal cual y **tú** debes revisar:

```js
if (!r.aceptado_por_sunat) {
  console.log(r.estado, r.sunat, r.accion_requerida)   // ej. "01" → reintenta con fs.comprobantes.reenviar(r.external_id)
}
```

Revisa también `r.entorno` (`"prueba"` o `"produccion"`) y `r.tiene_validez_fiscal`: cada RUC nace en
modo prueba (SUNAT beta, sin validez fiscal).

## Opciones del constructor

| Opción | Obligatoria | Default | Nota |
|---|---|---|---|
| `apiKey` | sí | — | Va en el header `X-API-Key`. |
| `baseUrl` | sí | — | URL base de tu servidor (sin barra final; si la pones, se quita). |
| `ruc` | no | — | RUC emisor por defecto. Se cambia por llamada con `{ ruc }`. |
| `timeout` | no | `60` | Segundos por petición (SUNAT a veces tarda). |
| `maxReintentos` | no | `3` | Ver "Reintentos e idempotencia". |
| `verificarSsl` | no | `true` | `false` **solo** para pruebas locales con certificado propio (ver abajo). |
| `fetch` | no | `globalThis.fetch` | Para inyectar tu propio `fetch` (proxies, pruebas). |

Si falta `apiKey` o `baseUrl`, el constructor lanza `FactuSmartError` con un mensaje claro.

## Métodos

Los **datos** se envían y se reciben tal cual los define el API (claves en español con guion bajo).
`opciones` acepta `ruc` (sobreescribe el del constructor) y, en `emitir`, `idempotencyKey`.

| Método | Endpoint | Devuelve |
|---|---|---|
| `fs.ping(opciones?)` | `GET /ping` | objeto |
| `fs.cuenta.saldo()` | `GET /account` | objeto (`creditos_disponibles`, plan, RUCs) |
| `fs.series.listar(opciones?)` | `GET /series` | objeto |
| `fs.comprobantes.emitir(datos, opciones?)` | `POST /documents` | objeto |
| `fs.comprobantes.listar(filtros?, opciones?)` | `GET /documents` | objeto (`comprobantes`, `siguiente_cursor`) |
| `fs.comprobantes.consultar(externalId, opciones?)` | `GET /documents/{id}` | objeto |
| `fs.comprobantes.descargar(externalId, 'pdf' \| 'xml' \| 'cdr', { formato, ruc }?)` | `GET /documents/{id}/{tipo}` | **`Buffer`** |
| `fs.comprobantes.reenviar(externalId, opciones?)` | `POST /documents/{id}/reenviar` | objeto |
| `fs.comprobantes.consultarSunat(externalId, opciones?)` | `POST /documents/{id}/consultar-sunat` | objeto |
| `fs.comprobantes.historial(externalId, opciones?)` | `GET /documents/{id}/historial` | objeto |
| `fs.comprobantes.calcular(items, { porcentaje_igv }?)` | `POST /calcular` | objeto (`items`, `totales`) |
| `fs.anulaciones.crear(datos, opciones?)` | `POST /anulaciones` | objeto (`tipo`, `identificador`, `ticket`) |
| `fs.anulaciones.estado(ticket, opciones?)` | `GET /anulaciones/{ticket}/status` | objeto (`tipo`, `estado`, `documentos`) |
| `fs.catalogos.listar(opciones?)` | `GET /catalogos` | objeto (`catalogos`, `nota`) |
| `fs.catalogos.consultar(nombre, { q, ruc }?)` | `GET /catalogos/{nombre}` | objeto (`catalogo`, `total`, `datos`) |
| `fs.catalogos.buscarProductoSunat(q, { limite, nivel, ruc }?)` | `GET /catalogos/productos-sunat` | objeto (`total`, `hay_mas`, `datos`) |
| `fs.establecimientos.listar(opciones?)` | `GET /establecimientos` | objeto (`establecimientos`) |
| `fs.establecimientos.crear(datos, opciones?)` | `POST /establecimientos` | objeto (`message`, `establecimiento`) |
| `fs.guias.emitir(datos, opciones?)` | `POST /guias` | objeto (revisa `enviado`) |
| `fs.guias.estado(externalId, opciones?)` | `GET /guias/{id}/status` | objeto |
| `fs.rucs.listar()` | `GET /rucs` | objeto |
| `fs.rucs.crear({ ruc, empresa, correo, clave })` | `POST /rucs` | objeto (`ya_existia`) |
| `fs.rucs.activar(ruc, activo)` | `PATCH /rucs/{ruc}/activation` | objeto |

Ayudante: `FactuSmart.calcularComprobante(items)` (también `import { calcularComprobante } from 'factusmart'`).

### Lo que el SDK completa por ti

- **RUC:** en GET va como `?ruc=`; en POST va en el cuerpo como `ruc` (si ya lo pusiste en tus datos, se respeta el tuyo). Los endpoints `/rucs*` nunca lo reciben.
- **`numero_documento`:** si no lo mandas, va `"#"` (FactuSmart asigna el correlativo). Si lo mandas, se respeta (numeración propia).
- **`fecha_de_emision` / `hora_de_emision`:** si no las mandas, se usan la fecha y hora **de Perú (America/Lima)**, no las de tu servidor.
- **`codigo_tipo_moneda`:** `"PEN"` si no viene. **`codigo_tipo_operacion`:** `"0101"` si no viene, solo en facturas y boletas (01/03); en notas no aplica.

### Descargar archivos

```js
import { writeFileSync } from 'node:fs'
writeFileSync('comprobante.pdf', await fs.comprobantes.descargar(r.external_id, 'pdf'))
```

El CDR solo existe cuando SUNAT respondió; si no existe, se lanza `NoEncontrado`.

**PDF en ticket u otro tamaño:** pasa `formato` (solo con `'pdf'`).

```js
writeFileSync('ticket.pdf', await fs.comprobantes.descargar(r.external_id, 'pdf', { formato: 'ticket' }))
```

| `formato` | Tamaño |
|---|---|
| *(sin formato)* o `a4` | A4 |
| `a5` | A5 apaisado |
| `ticket` o `ticket80` | Ticket de 80 mm |
| `ticket58` | Ticket de 58 mm |
| `ticket50` | Ticket de 50 mm |

Es el mismo PDF que imprime el sistema web en ese tamaño. No cambia el PDF que recibe tu cliente
(ese sigue siendo el A4). `formato` con `'xml'`/`'cdr'` o un valor fuera de la lista lanza
`ErrorDeValidacion` (`codigo: 'DATOS_INVALIDOS'`, `campos.formato`) **sin hacer la petición**.

### Anular facturas y boletas

`anulaciones.crear` sirve para las dos; el API elige el camino según lo que mandes:

| Mandas | SUNAT lo anula con | `tipo` | `identificador` |
|---|---|---|---|
| Facturas y sus notas | Comunicación de baja | `baja` | `RA-AAAAMMDD-N` |
| Boletas y sus notas (solo **aceptadas**, estado `05`) | Resumen diario | `resumen` | `RC-AAAAMMDD-N` |
| Las dos cosas juntas | — | `422` `ANULACION_MIXTA` (`ErrorDeValidacion`) | — |

```js
const a = await fs.anulaciones.crear({
  fecha_de_emision_de_documentos: '14-10-2026', // DD-MM-AAAA, la de emisión de los comprobantes
  documentos: [{ external_id: r.external_id, motivo_anulacion: 'Error en el comprobante' }],
})
console.log(a.tipo, a.identificador, a.ticket) // 'resumen' 'RC-20261014-1' '1792012278669'
const e = await fs.anulaciones.estado(a.ticket) // e.estado '05' = aceptada; e.documentos[i].estado '11' = anulado
```

La respuesta trae también `creditos_restantes` y `credito_cobrado` (y en RUCs demo `modo_demo` y
`pruebas_restantes_hoy`). Haz una petición para las facturas y otra para las boletas.
`anulaciones.crear` nunca se reintenta automáticamente.

### Catálogos SUNAT

```js
const { catalogos } = await fs.catalogos.listar() // unidades, afectacion-igv, monedas, ...
const { datos } = await fs.catalogos.consultar('unidades', { q: 'kilo' }) // o por número: consultar('03')
const activas = datos.filter((f) => f.activo) // usa solo las filas activas: el RUC valida contra ellas
```

`consultar` lee el catálogo del RUC (`ruc` de la llamada o del constructor). Un nombre que no existe
lanza `NoEncontrado` (la lista válida viene en `e.respuesta.catalogos_disponibles`).

**Código de producto SUNAT (catálogo 25):** búscalo por texto (sin tildes) o por código (exacto o
prefijo). `limite` máximo 50; `hay_mas: true` significa que conviene afinar la búsqueda.

```js
const { datos, hay_mas } = await fs.catalogos.buscarProductoSunat('computador', { limite: 10 })
// datos: [{ codigo: '43211503', descripcion: '...' }, ...]
```

### Anexos (establecimientos)

Los locales del RUC con su código de anexo SUNAT y sus series. Para emitir desde un local, manda su
`codigo_anexo` en `comprobantes.emitir`; sin él se usa el `predeterminado`.

```js
const { establecimientos } = await fs.establecimientos.listar()
// [{ codigo_anexo: '0000', nombre: 'Oficina Principal', predeterminado: true, series: [...] }, ...]

const { establecimiento } = await fs.establecimientos.crear({
  codigo_anexo: '0001', // el que te dio SUNAT: regístralo antes allí con tu Clave SOL
  nombre: 'Tienda Miraflores',
  direccion: 'Av. Larco 345',
  ubigeo: '150122',
  series: [{ codigo_tipo_documento: '03', serie: 'B002' }], // opcional; además se crean las series por defecto
})
```

No consumen crédito. `crear` **nunca se reintenta** automáticamente (no es idempotente): si falla
por red, revisa con `listar()` antes de volver a intentarlo. Si el plan del RUC no permite más
locales lanza `RucNoAutorizado` con `codigo: 'LIMITE_ESTABLECIMIENTOS'`. Editar o eliminar un local
se hace desde el sistema web.

## ¿Calcular en el servidor o local?

| | `fs.comprobantes.calcular(items, opciones?)` | `FactuSmart.calcularComprobante(items)` |
|---|---|---|
| Dónde | En FactuSmart (`POST /calcular`) | En tu proceso, sin petición |
| Precio | `valor_unitario` (sin IGV) **o** `precio_unitario` (con IGV) | Solo `valor_unitario` (sin IGV) |
| IGV | 18 % o 10.5 % (`{ porcentaje_igv: 10.5 }`, Ley 31556, restaurantes y hoteles MYPE acogidos) | Solo 18 % |
| Costo | No emite ni cobra crédito (ni manda `ruc`) | Cero peticiones |

Para lo que soportan los dos, dan **los mismos números** al centavo.

- Usa `comprobantes.calcular` si tus precios incluyen IGV, si aplicas la tasa 10.5 % o si prefieres
  que el cálculo lo haga siempre FactuSmart. Con `precio_unitario` se respeta lo que paga el cliente:
  3 menús de S/ 10.00 suman S/ 30.00 (no S/ 29.99).
- Usa `calcularComprobante` si tus precios son sin IGV al 18 % y no quieres una petición extra.

```js
const { items, totales } = await fs.comprobantes.calcular([
  { descripcion: 'Menú', cantidad: 3, precio_unitario: 10, afectacion: '10', unidad_de_medida: 'ZZ' },
])
await fs.comprobantes.emitir({ codigo_tipo_documento: '03', datos_del_cliente_o_receptor: cliente, items, totales })
```

Los errores de `comprobantes.calcular` vienen por ítem en `e.campos` (clave `items.N.campo`). Al no
tener efectos, se reintenta igual que un GET.

## `calcularComprobante(items)`

Recibe ítems con `descripcion`, `cantidad`, `valor_unitario` (**sin IGV**), `afectacion` y opcionalmente
`codigo_interno` y `unidad_de_medida` (default `NIU`). Devuelve `{ items, totales }` listos para emitir.

| `afectacion` | Significado | IGV | Suma en |
|---|---|---|---|
| `10` | Gravado | 18% | `total_operaciones_gravadas` |
| `20` | Exonerado | 0 | `total_operaciones_exoneradas` |
| `30` | Inafecto | 0 | `total_operaciones_inafectas` |
| `40` | Exportación | 0 | `total_exportacion` |

Redondeo a 2 decimales por ítem, "mitad hacia arriba", sin el error de coma flotante de JavaScript
(por ejemplo `10.555 × 3` da `31.67`, igual que en los SDK de PHP y Python).

## Errores

Todos heredan de `FactuSmartError` y traen:

- `status`: HTTP (`0` si fue red/timeout).
- `mensaje`: el `message` del API. `respuesta`: el cuerpo completo.
- `codigo`: código estable del error, en MAYÚSCULAS (ej. `DATOS_INVALIDOS`). Úsalo en tu lógica en
  vez de comparar textos. `null` si fue red/timeout o si el servidor es de una versión anterior.
- `reintentable`: `true` si repetir la misma petición más tarde puede funcionar. `null` si el API no
  lo mandó (servidor de versión anterior, red, timeout).
- `campos`: errores por campo, ej. `{ "items.0.cantidad": ["..."] }` (sobre todo en 422). `{}` si no hay.

| HTTP | Clase | Cuándo |
|---|---|---|
| 401 | `ErrorDeAutenticacion` | API key ausente, inválida o cuenta desactivada |
| 402 | `SinCreditos` | Sin créditos; no se emitió nada |
| 403 | `RucNoAutorizado` | El RUC no es de tu cuenta o está desactivado |
| 404 | `NoEncontrado` | Comprobante, guía, ticket o archivo inexistente |
| 422 | `ErrorDeValidacion` | Datos inválidos; el crédito no se cobra. Revisa `campos` (`errores` se mantiene por compatibilidad) |
| 429 | `LimiteDePeticiones` | Límite de peticiones; `segundosDeEspera` si se pudo leer |
| otros / red | `FactuSmartError` | |

```js
import { ErrorDeValidacion, SinCreditos } from 'factusmart'
try {
  await fs.comprobantes.emitir(datos)
} catch (e) {
  if (e instanceof ErrorDeValidacion) console.log('Corrige el JSON:', e.mensaje, e.campos)
  else if (e instanceof SinCreditos) console.log('Recarga créditos')
  else if (e.codigo === 'PLAN_VENCIDO') console.log('Renueva tu plan')
  else throw e
}
```

Códigos más comunes (lista completa en `CODIGOS_DE_ERROR`; el API puede agregar otros y manda
`ERROR_<status>` como genérico, así que no asumas una lista cerrada):

| `codigo` | Qué pasó |
|---|---|
| `NO_AUTENTICADO` | API key inválida o cuenta desactivada |
| `PLAN_VENCIDO` / `SIN_CREDITOS` | Plan vencido o sin créditos |
| `RUC_NO_AUTORIZADO` / `RUC_DESACTIVADO` | El RUC no es de tu cuenta o está desactivado |
| `NO_ENCONTRADO` | Comprobante, guía, ticket o archivo inexistente |
| `DATOS_INVALIDOS` | Validación; detalle en `campos` |
| `EMISION_EN_CURSO` | Ya hay una emisión con esa `Idempotency-Key` en proceso |
| `RECHAZADO_SUNAT` / `ERROR_EMISION` | SUNAT rechazó o falló la emisión |
| `SUNAT_NO_DISPONIBLE` | SUNAT no responde (reintentable) |
| `LIMITE_PETICIONES` | Demasiadas peticiones por minuto (reintentable) |
| `LIMITE_PRUEBAS_DIARIO` | 429 **no reintentable**: tope de 200 operaciones/día en RUCs demo |
| `ANULACION_MIXTA` | Facturas y boletas en la misma anulación (422) |
| `LLAVE_DE_PRUEBA_EN_PRODUCCION` | Llave de prueba usada con un RUC en producción (403) |
| `ERROR_INTERNO` | Error del servidor |

### RUCs demo: sin costo, con tope diario

En un RUC en modo demo (pruebas, SUNAT beta, sin validez fiscal) **no se cobra crédito**: las respuestas
traen `credito_cobrado: false`, `modo_demo: true` y `pruebas_restantes_hoy`, y `creditos_restantes` no
baja. A cambio hay un tope de **200 operaciones por día por cuenta**; al llegar, el API responde 429
con `codigo: 'LIMITE_PRUEBAS_DIARIO'` y `reintentable: false`. El SDK lanza `LimiteDePeticiones` tras
**una sola** petición (no reintenta: el cupo se reinicia a medianoche, hora de Perú). Distínguelo del
límite por minuto con `e.codigo`, no con la clase:

```js
catch (e) {
  if (e.codigo === 'LIMITE_PRUEBAS_DIARIO') console.log('Se acabaron las pruebas de hoy')
}
```

## Verificar webhooks

FactuSmart firma cada webhook con el header `X-FactuSmart-Firma`: HMAC-SHA256 (hex) del cuerpo
**crudo** con tu secreto. Verifica con el cuerpo tal como llegó, **nunca** con `JSON.stringify(req.body)`:
un JSON re-serializado cambia espacios u orden y la firma ya no coincide.

```js
import express from 'express'
import { verificarFirmaWebhook } from 'factusmart' // o FactuSmart.verificarFirmaWebhook

const app = express()
app.post('/webhooks/factusmart', express.raw({ type: 'application/json' }), (req, res) => {
  if (!verificarFirmaWebhook(req.body, req.get('x-factusmart-firma'), process.env.FACTUSMART_WEBHOOK_SECRETO)) {
    return res.sendStatus(401)
  }
  const evento = JSON.parse(req.body.toString('utf8'))
  // ... procesa evento
  res.sendStatus(200)
})
```

`verificarFirmaWebhook(cuerpoCrudo, firma, secreto)` acepta string, `Buffer` o `Uint8Array`, compara
en tiempo constante y nunca lanza: si la firma o el secreto faltan o están mal formados, devuelve `false`.


## Reintentos e idempotencia

- `comprobantes.emitir` **siempre** manda el header `Idempotency-Key`: la tuya (`{ idempotencyKey: 'venta-123' }`,
  recomendado: el id de la venta en tu sistema) o un UUID v4 generado. **La misma clave se reusa en todos
  los reintentos de esa llamada**, así un reintento nunca emite dos veces ni cobra dos veces.
- Se reintenta solo ante: error de red/timeout, 429, 502, 503, 504 y, en
  `emitir`, 409 ("emisión en curso con esa clave"). Espera creciente: 1 s, 2 s, 4 s… Ante límite de
  peticiones se respeta `Retry-After` o el "Espera N segundos" del mensaje.
- Se reintentan: todos los GET, `comprobantes.emitir`, `comprobantes.calcular` (no tiene efectos) y
  `rucs.crear` (idempotente por RUC). En
  estas operaciones también se reintenta cuando el API responde `reintentable: true` (ej.
  `ERROR_INTERNO`, `SUNAT_NO_DISPONIBLE`), con el mismo tope y la misma espera.
- **`reintentable: false` manda:** si el cuerpo del error trae `reintentable: false`, no se reintenta
  nunca, aunque el HTTP sea 429, 409, 502, 503 o 504 (caso real: 429 `LIMITE_PRUEBAS_DIARIO`). Si el
  cuerpo no trae `reintentable` (servidor de versión anterior), se usa la regla por HTTP de arriba.
- **Nunca** se reintentan automáticamente: `anulaciones.crear`, `guias.emitir` (no acepta
  `Idempotency-Key`), `comprobantes.reenviar`, `comprobantes.consultarSunat`, `rucs.activar`,
  aunque el API responda `reintentable: true`.

## Pruebas locales con certificado propio (`verificarSsl: false`)

`fetch` nativo de Node no permite desactivar la verificación del certificado por petición. Con
`verificarSsl: false` el SDK:

1. usa el paquete `undici` si tu proyecto lo tiene instalado (`npm i -D undici`), con un `Agent` que
   acepta el certificado propio; o
2. si no, avisa con un warning y debes correr el proceso con `NODE_TLS_REJECT_UNAUTHORIZED=0`
   (desactiva la verificación para **todo** el proceso: solo en pruebas, nunca en producción).

## Desarrollo del SDK

```bash
npm install
npm run typecheck     # tsc --noEmit
npm run build         # dist/ en ESM + CJS + .d.ts
npm run test:unit     # sin red (fetch falso) + prueba de contrato contra openapi.yaml
npm run test:api:nuevo # API local: anexos, PDF ticket y código SUNAT; solo lee, no emite
npm test              # todo, incluido el API local https://factusmart.test (máx. 3 emisiones demo, sin costo)
```

Las pruebas del API local usan las variables `FACTUSMART_BASE_URL`, `FACTUSMART_API_KEY`,
`FACTUSMART_RUC` y `FACTUSMART_OPENAPI` (ruta del `openapi.yaml`) si están definidas.

## Licencia

MIT
