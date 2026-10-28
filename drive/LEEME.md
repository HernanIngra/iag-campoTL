# La planilla de I.Ag · Tierra Lejana

La app guarda todo en cada equipo y lo sincroniza con una planilla de Google, a
través de un programa chico dentro de la planilla (Apps Script, `Code.gs`).
Lo que se carga en la app aparece en la planilla, y **lo que se corrige o se
agrega a mano en la planilla aparece en la app** (en un minuto, aprox.).

## Pestañas

| Pestaña | Una fila por | Qué se hace a mano |
|---|---|---|
| **Movimientos** | Cada entrada o salida de un depósito | Cargar el **stock previo** (Tipo «Stock inicial»), corregir cantidades, ajustes |
| **Stock** | Cada producto (columnas: depósitos) | Nada: son **fórmulas** sobre Movimientos, se recalcula solo |
| **Planificación** | Cada lote, campaña 26-27 | Cultivo y variedad de cada lote hasta la siembra |
| **OT** | Cada orden de trabajo | Cargar **órdenes ya ejecutadas** (Estado «Aplicada»), corregir datos |
| **OT_Productos** | Cada producto de cada orden | Los productos de esas órdenes |
| **Productos** | Cada producto | Envase, unidad, mínimo |
| **Depósitos** | Cada depósito | Zona y tipo |
| **Campos** | Cada campo | «En sociedad»: Sí / No |

Las dos últimas columnas de cada pestaña, **id** y **rev**, las completa el
programa: no se tocan. La columna **datos** (oculta) tampoco.

### Movimientos

| Columna | Qué va |
|---|---|
| Fecha | `2026-10-20` |
| Tipo | Stock inicial · Compra · Traslado · Retiro para aplicar · Aplicado · Devolución · Ajuste · Venta · Reingreso al Rincón |
| Producto | El nombre, igual que en Productos (si es nuevo, se crea) |
| Depósito | Depósito TL (y los que se agreguen) · En tránsito |
| Cantidad | **Con signo**: `+` entra al depósito, `−` sale. Un traslado son dos filas (− en uno, + en el otro) |
| Envase | Cerrado o Rincón (envase abierto) |
| OT · Remito | La orden y el remito, si corresponde |
| Verificado | En compras: Sí / No (si alguien la vio en el galpón) |
| Confirmado | En compras: **No** = pedido o cotización; **Sí** = factura (o, si es de un socio, aporte confirmado). Mientras diga No, **no suma al stock**. Se tilda en la app (Stock → «Pedidos y cotizaciones sin confirmar») o se pone Sí acá. Una factura se puede cargar directo, sin pedido previo |

### Stock

La arma el programa con fórmulas `QUERY` sobre Movimientos: una fila por
producto, una columna por depósito y el total. No cuenta lo anulado ni los
pedidos sin confirmar. No se escribe a mano.

### Planificación

Zona · Campo · Lote · ha · Cultivo · Variedad. «En el mapa» = No para lotes
que no están dibujados. La app usa el cultivo para
pintar el mapa y para proponer el cultivo de la orden.

### OT · zonas

Tierra Lejana tiene una sola zona: la gerencia y el encargado recetan en
todos los campos.

### Órdenes de prueba

Tilde **«Orden de prueba (ficticia)»** en la orden: queda **Prueba = Sí** en
OT y en todos sus movimientos (el PDF dice «ORDEN DE PRUEBA · NO APLICAR»).
Mientras tanto mueven el stock como una real. Para limpiarlas todas juntas:
`python tools/limpiar_pruebas.py --url … --clave …` (muestra qué haría) y con
`--aplicar` les pone Anulado = Sí.

### Velocidad

Cada consulta a la planilla tarda unos segundos (servidor gratuito de Google).
El programa recuerda cuándo fue el último cambio: si no hubo novedades,
contesta enseguida sin leer las pestañas.

### OT · estados

**Solicitada** → **Producto retirado** → **Aplicación reportada** (por el equipo) → **Aplicada** (confirmada por el encargado) → **Remanente devuelto**

Una orden ya ejecutada antes de usar la app se carga con Estado «Aplicada»,
los lotes como `EM10 (68 ha), EM11` y sus productos en OT_Productos (misma
OT). No mueve stock: se supone que el stock previo ya lo descuenta.

### Reglas

- **No borrar filas.** Para sacar algo, poner **Sí** en la columna **Anulado**.
- Las columnas se buscan por nombre: se pueden reordenar o agregar columnas propias.
- Los nombres (productos, depósitos, lotes) tienen que coincidir con los de la app.
  Mayúsculas y acentos no importan.

## Armar la planilla (una vez)

1. En la planilla: **Extensiones → Apps Script**. Pegar todo `Code.gs` y poner
   la clave en `const CLAVE = "…"`. Guardar.
2. **Implementar → Nueva implementación → Aplicación web**. Ejecutar como: **Yo** ·
   Acceso: **Cualquier persona**. Autorizar.
3. Copiar la URL (termina en `/exec`).

**Si se cambia `Code.gs`:** Implementar → **Administrar implementaciones** → lápiz
→ Versión: **Nueva versión** → Implementar. Así la URL sigue siendo la misma.

## Conectar los equipos

Cada equipo abre el **enlace para conectar** (lo arma la página *Conectar con el
Drive* de la app, o lo pasa quien ya está conectado). Queda conectado y baja
solo los datos de la empresa. Abajo a la izquierda se ve el estado:
*Sincronizado 10:42*, *3 cambios por subir*, *Sin señal*.

## Cosas a saber · fase de prueba

- **La página es pública.** El código de la app está en un servidor gratuito de
  GitHub (GitHub Pages), abierto: cualquiera puede ver la página y su código,
  incluido el dibujo de los lotes. **Los datos no están ahí.**
- **Lo que no es abierto es la planilla de Google.** Movimientos, órdenes, stock,
  historial de labores viven sólo en la planilla de Drive; para leerlos o
  escribirlos hace falta el enlace con la clave.
- **Este sprint se enfoca en la orden de trabajo (OT).** El resto (stock,
  compras) ya se puede probar, pero por eso **una OT se puede
  ejecutar aunque el producto no figure comprado en el stock**: la app avisa
  el saldo negativo y no bloquea.
- Esto es para la **prueba**. Si se adopta, se pasa a un servidor y una base
  de datos propios, con usuario y contraseña por persona.
- Quien tiene el enlace (con la clave) puede leer y escribir. Para la prueba alcanza.
- Si dos personas cambian la misma fila a la vez, queda la última.
- El historial de labores vive en la pestaña `_archivos` (no se toca).
  Los pedidos, en `_registros` (tampoco).
