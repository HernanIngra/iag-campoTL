/**
 * I.Ag · intermediario entre la app y la planilla del Drive.
 *
 * Se pega en la planilla (Extensiones → Apps Script) y se publica como
 * aplicación web. La app no inicia sesión en Google: le habla a esta
 * dirección con una clave compartida. Ver drive/LEEME.md.
 *
 * Pestañas que crea solo (si no existen):
 *   Movimientos · OT · OT_Productos · Planificación · Productos · Depósitos · Campos
 *       Tablas para leer y editar a mano. Las columnas se buscan por nombre:
 *       se pueden reordenar o agregar columnas propias. Las dos últimas,
 *       «id» y «rev», las maneja este programa: no se tocan.
 *       Para borrar una fila, poner «Sí» en «Anulado» (no borrar la fila).
 *   Stock        se calcula solo con fórmulas a partir de Movimientos. No se edita.
 *   _registros   uso interno de la app (presupuesto, pedidos). No se toca.
 *   _archivos    datos de la empresa que no van a GitHub. No se toca.
 *
 * Cada fila lleva en «rev» el momento de su último cambio (milisegundos). Una
 * edición a mano también lo actualiza (onEdit), y así la app se entera.
 */

// La clave que también va en la app. Cambiala antes de publicar.
const CLAVE = "cambiar-esta-clave";

const TABLAS = {
  "Movimientos": ["Fecha", "Tipo", "Producto", "Depósito", "Cantidad", "Unidad", "Envase", "OT", "Remito",
                  "Verificado", "Confirmado", "Precio US$", "Nota", "Usuario", "Prueba", "Anulado", "datos", "id", "rev"],
  "OT": ["OT", "Fecha", "Estado", "Zona", "Lotes", "ha", "Cultivo", "Labor", "Aplicador", "Aporta",
         "Remito", "Fecha aplicación", "ha aplicadas", "Observaciones", "Usuario", "Prueba", "Anulado", "datos", "id", "rev"],
  "OT_Productos": ["OT", "Producto", "Dosis", "Unidad dosis", "Necesidad", "Retirado", "Usado", "Dosis real",
                   "Devuelto", "Sale de", "Anulado", "datos", "id", "rev"],
  "Planificación": ["Zona", "Campo", "Lote", "ha", "Cultivo", "Variedad", "En el mapa", "Observaciones", "Anulado", "id", "rev"],
  "Productos": ["Producto", "Principio activo", "Tipo", "Unidad", "Envase", "Mínimo", "Registro SENASA", "Anulado", "datos", "id", "rev"],
  "Depósitos": ["Depósito", "Zona", "Tipo", "Ubicación", "Anulado", "id", "rev"],
  "Campos": ["Campo", "Código", "Zona", "En sociedad", "id", "rev"],
};
const PARTE = 45000;

// ── Hojas ────────────────────────────────────────────────────────────────
function libro_() { return SpreadsheetApp.getActiveSpreadsheet(); }

/**
 * Último cambio (rev) que tiene la planilla. Si la app pregunta «¿hay algo
 * después de X?» y no lo hay, se contesta sin leer las pestañas: así cada
 * sincronización sin novedades tarda un segundo y no seis.
 */
function ultimo_() { return Number(PropertiesService.getScriptProperties().getProperty("ultimo") || 0); }
function marcar_(rev) {
  if (rev > ultimo_()) PropertiesService.getScriptProperties().setProperty("ultimo", String(rev));
}

/** La pestaña de una tabla, creada con su encabezado si no existe. Agrega las columnas que falten. */
function tabla_(nombre) {
  let h = libro_().getSheetByName(nombre);
  const cols = TABLAS[nombre];
  if (!h) {
    h = libro_().insertSheet(nombre);
    h.getRange(1, 1, 1, cols.length).setValues([cols]).setFontWeight("bold").setBackground("#e2e8f0");
    h.setFrozenRows(1);
    h.getRange(1, cols.indexOf("id") + 1, h.getMaxRows(), 1).setNumberFormat("@");
    h.getRange(1, cols.indexOf("id") + 1, 1, 2).setFontColor("#94a3b8");
    if (cols.indexOf("datos") >= 0) h.hideColumns(cols.indexOf("datos") + 1);
    return h;
  }
  const enc = encabezado_(h);
  cols.forEach((c) => {
    if (enc.indexOf(c) === -1) {
      const col = h.getLastColumn() + 1;
      h.getRange(1, col).setValue(c).setFontWeight("bold").setBackground("#e2e8f0");
      if (c === "id") h.getRange(1, col, h.getMaxRows(), 1).setNumberFormat("@");
    }
  });
  return h;
}
function encabezado_(h) {
  return h.getLastColumn() ? h.getRange(1, 1, 1, h.getLastColumn()).getValues()[0].map(String) : [];
}
function interna_(nombre, encabezado) {
  let h = libro_().getSheetByName(nombre);
  if (!h) {
    h = libro_().insertSheet(nombre);
    h.getRange(1, 1, h.getMaxRows(), encabezado.length).setNumberFormat("@");
    h.appendRow(encabezado);
    h.setFrozenRows(1);
  }
  return h;
}
const registros_ = () => interna_("_registros", ["rev", "tabla", "id", "actualizado", "usuario", "borrado", "json"]);
const archivos_ = () => interna_("_archivos", ["nombre", "parte", "contenido", "subido"]);

/** Valor de una celda, tal como lo usa la app: fechas como «2026-10-20». */
function valor_(v) {
  if (v instanceof Date) return Utilities.formatDate(v, libro_().getSpreadsheetTimeZone(), "yyyy-MM-dd");
  return v;
}
function nuevoId_() { return "h" + Utilities.getUuid().replace(/-/g, "").slice(0, 10); }

function respuesta_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

/**
 * Pestaña Stock: fórmulas sobre Movimientos (una tabla por depósito y el
 * total por producto). Se rearma sola si cambia el orden de las columnas.
 * No cuenta lo anulado ni los pedidos al socio sin confirmar.
 */
function stock_() {
  const mov = tabla_("Movimientos");
  const enc = encabezado_(mov);
  const L = (c) => { const i = enc.indexOf(c); return i < 0 ? null : columnaLetra_(i + 1); };
  const P = L("Producto"), D = L("Depósito"), C = L("Cantidad"), A = L("Anulado"), K = L("Confirmado");
  if (!P || !D || !C) return;
  const ultima = columnaLetra_(enc.length);
  const filtro = P + " is not null" + (A ? " and (" + A + " is null or " + A + " <> 'Sí')" : "") +
                 (K ? " and (" + K + " is null or " + K + " <> 'No')" : "");
  const rango = "Movimientos!A1:" + ultima;
  let h = libro_().getSheetByName("Stock");
  if (!h) h = libro_().insertSheet("Stock");
  const porDep = '=QUERY(' + rango + ',"select ' + P + ', sum(' + C + ') where ' + filtro + ' group by ' + P + ' pivot ' + D + '",1)';
  const total = '=QUERY(' + rango + ',"select ' + P + ', sum(' + C + ') where ' + filtro + ' group by ' + P + ' label sum(' + C + ') \'Total\'",1)';
  if (h.getRange("A3").getFormula() !== porDep || h.getRange("O3").getFormula() !== total) {
    h.clear();
    h.getRange("A1").setValue("Stock por depósito · se calcula solo a partir de Movimientos (no se edita)").setFontWeight("bold");
    h.getRange("O1").setValue("Total por producto").setFontWeight("bold");
    h.getRange("A3").setFormula(porDep);
    h.getRange("O3").setFormula(total);
    h.setFrozenRows(3);
  }
}
function columnaLetra_(n) { let s = ""; while (n > 0) { const m = (n - 1) % 26; s = String.fromCharCode(65 + m) + s; n = Math.floor((n - 1) / 26); } return s; }

// ── Lectura ──────────────────────────────────────────────────────────────
function doGet(e) {
  const p = e.parameter || {};
  if (p.clave !== CLAVE) return respuesta_({ ok: false, error: "clave" });

  if (p.accion === "probar") {
    Object.keys(TABLAS).forEach(tabla_);
    stock_();
    return respuesta_({ ok: true, planilla: libro_().getName(), version: 4 });
  }

  if (p.accion === "archivo") {
    const filas = archivos_().getDataRange().getValues().slice(1)
      .filter((f) => f[0] === p.nombre).sort((a, b) => Number(a[1]) - Number(b[1]));
    if (!filas.length) return respuesta_({ ok: false, error: "no hay archivo " + p.nombre });
    return respuesta_({ ok: true, nombre: p.nombre, subido: filas[0][3], contenido: filas.map((f) => f[2]).join("") });
  }

  if (p.accion === "cambios") {
    const desde = Number(p.desde || 0);
    const ult = ultimo_();
    if (ult && desde >= ult) return respuesta_({ ok: true, rev: ult, filas: [], registros: [] });
    let rev = desde;
    const filas = [];
    Object.keys(TABLAS).forEach((t) => {
      const h = libro_().getSheetByName(t);
      if (!h || h.getLastRow() < 2) return;
      const datos = h.getDataRange().getValues();
      const enc = datos[0].map(String);
      const cRev = enc.indexOf("rev"), cId = enc.indexOf("id");
      datos.slice(1).forEach((f) => {
        const r = Number(f[cRev]) || 0;
        if (r <= desde || !f[cId]) return;
        const valores = {};
        enc.forEach((c, i) => { if (c && c !== "rev") valores[c] = valor_(f[i]); });
        filas.push({ tabla: t, id: String(f[cId]), rev: r, valores: valores });
        rev = Math.max(rev, r);
      });
    });
    const registros = registros_().getDataRange().getValues().slice(1)
      .filter((f) => Number(f[0]) > desde)
      .map((f) => {
        rev = Math.max(rev, Number(f[0]));
        return { rev: Number(f[0]), tabla: f[1], id: String(f[2]), usuario: f[4], borrado: String(f[5]).toUpperCase() === "TRUE", json: f[6] };
      });
    marcar_(rev);
    return respuesta_({ ok: true, rev: rev, filas: filas, registros: registros });
  }
  return respuesta_({ ok: false, error: "acción desconocida" });
}

// ── Escritura ────────────────────────────────────────────────────────────
/**
 * El cuerpo llega como texto (Content-Type text/plain): así el navegador no
 * hace la consulta previa de CORS, que Apps Script no contesta.
 */
function doPost(e) {
  let d;
  try { d = JSON.parse(e.postData.contents); } catch (err) { return respuesta_({ ok: false, error: "json" }); }
  if (d.clave !== CLAVE) return respuesta_({ ok: false, error: "clave" });

  const lock = LockService.getScriptLock();
  lock.waitLock(25000);
  try {
    if (d.accion === "guardar") {
      let rev = Date.now();
      // Filas de las tablas: se busca por id; si no está, se agrega
      const porTabla = {};
      (d.filas || []).forEach((f) => { (porTabla[f.tabla] = porTabla[f.tabla] || []).push(f); });
      Object.keys(porTabla).forEach((t) => {
        if (!TABLAS[t]) return;
        const h = tabla_(t);
        const datos = h.getDataRange().getValues();
        const enc = datos[0].map(String);
        const cId = enc.indexOf("id");
        const fila = {};
        datos.forEach((f, i) => { if (i > 0 && f[cId]) fila[String(f[cId])] = i + 1; });
        const nuevas = [];
        porTabla[t].forEach((f) => {
          rev += 1;
          const vals = Object.assign({}, f.valores || {}, { id: String(f.id), rev: rev });
          if (f.anulado) vals["Anulado"] = "Sí";
          const n = fila[String(f.id)];
          if (n) {
            const actual = h.getRange(n, 1, 1, enc.length).getValues()[0];
            enc.forEach((c, i) => { if (c in vals) actual[i] = vals[c]; });
            h.getRange(n, 1, 1, enc.length).setValues([actual]);
          } else if (!f.anulado) {
            nuevas.push(enc.map((c) => (c in vals ? vals[c] : "")));
          }
        });
        if (nuevas.length) h.getRange(h.getLastRow() + 1, 1, nuevas.length, enc.length).setValues(nuevas);
      });
      // Registros internos (presupuesto, pedidos): se agregan, nunca se editan
      const regs = (d.registros || []).map((r) => {
        rev += 1;
        const json = r.borrado ? "" : JSON.stringify(r.valor);
        if (json.length > 49000) throw new Error("registro demasiado grande: " + r.tabla + " " + r.id);
        return [String(rev), r.tabla, String(r.id), new Date().toISOString(), d.usuario || "", r.borrado ? "TRUE" : "FALSE", json];
      });
      const hr = registros_();
      if (regs.length) hr.getRange(hr.getLastRow() + 1, 1, regs.length, 7).setNumberFormat("@").setValues(regs);
      if (porTabla["Movimientos"]) stock_();
      marcar_(rev);
      return respuesta_({ ok: true, rev: rev });
    }

    if (d.accion === "archivo") {
      const h = archivos_();
      const vals = h.getDataRange().getValues();
      for (let i = vals.length - 1; i >= 1; i--) if (vals[i][0] === d.nombre) h.deleteRow(i + 1);
      const texto = String(d.contenido || "");
      const ahora = new Date().toISOString();
      const partes = [];
      for (let i = 0, n = 0; i < texto.length; i += PARTE, n++) partes.push([d.nombre, String(n), texto.slice(i, i + PARTE), ahora]);
      if (partes.length) h.getRange(h.getLastRow() + 1, 1, partes.length, 4).setNumberFormat("@").setValues(partes);
      return respuesta_({ ok: true, nombre: d.nombre, partes: partes.length, caracteres: texto.length });
    }
    return respuesta_({ ok: false, error: "acción desconocida" });
  } catch (err) {
    return respuesta_({ ok: false, error: String(err.message || err) });
  } finally {
    lock.releaseLock();
  }
}

// ── Ediciones a mano ─────────────────────────────────────────────────────
/**
 * Cada vez que alguien edita una tabla en la planilla: la fila recibe «rev»
 * nuevo (así la app la baja) y, si es nueva, un id.
 */
function onEdit(e) {
  const h = e.range.getSheet();
  const t = h.getName();
  if (!TABLAS[t]) return;
  const enc = encabezado_(h);
  const cId = enc.indexOf("id") + 1, cRev = enc.indexOf("rev") + 1;
  if (!cId || !cRev) return;
  const desde = Math.max(2, e.range.getRow()), hasta = e.range.getLastRow();
  if (hasta < desde) return;
  // Si lo editado es la propia columna id o rev, no se pisa
  if (e.range.getColumn() >= cId && e.range.getLastColumn() <= cRev) return;
  const n = hasta - desde + 1;
  const ids = h.getRange(desde, cId, n, 1).getValues();
  const filas = h.getRange(desde, 1, n, enc.length).getValues();
  let rev = Date.now();
  const revs = filas.map((f, i) => {
    const vacia = f.every((v, j) => j === cId - 1 || j === cRev - 1 || v === "" || v === null);
    if (vacia) return [ids[i][0] ? rev++ : ""];
    if (!ids[i][0]) ids[i][0] = nuevoId_();
    return [rev++];
  });
  h.getRange(desde, cId, n, 1).setValues(ids);
  h.getRange(desde, cRev, n, 1).setValues(revs);
  marcar_(rev);
}
