// Traducción entre el stock de la app y las pestañas legibles de la planilla
// (Movimientos · OT · OT_Productos · Productos · Depósitos · Campos).
//
// En la planilla todo va con nombres («Roundup Full II», «Depósito TL»,
// «Retiro para aplicar») y la cantidad con signo (+ entra, − sale), para que
// una tabla dinámica dé el stock por depósito. La app trabaja con ids. Esto
// convierte en los dos sentidos. Lo que una fila no muestra (vínculos entre
// movimientos, detalles de la orden) viaja en la columna oculta «datos».
//
// Una fila cargada a mano (sin «datos») también se entiende: un producto o un
// depósito con un nombre nuevo se crea; una OT «Aplicada» cargada a mano entra
// como orden ya ejecutada, sin mover stock.
(function (g) {
  "use strict";

  var TRANSITO = "transito";
  var ZONA_TXT = { TL: "Tierra Lejana" };
  var slug = function (t) {
    return String(t || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase()
      .replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  };
  /** Un número escrito a mano: «68,5» o «1.250,5» (es-AR) o «0.05». */
  var num = function (v) {
    if (typeof v === "number") return v;
    var t = String(v == null ? "" : v).trim();
    if (t.indexOf(",") !== -1) t = t.replace(/\./g, "").replace(",", ".");
    var n = parseFloat(t);
    return isNaN(n) ? 0 : n;
  };
  var r3 = function (v) { return Math.round(num(v) * 1000) / 1000; };
  var si = function (v) { return /^(s[ií]|si|true|x|1)$/i.test(String(v || "").trim()); };
  var datosDe = function (v) { try { return v ? JSON.parse(v) : {}; } catch (e) { return {}; } };

  // ── Movimientos ───────────────────────────────────────────────────────
  var TIPO_TXT = {
    inicial: "Stock inicial", compra: "Compra", transferencia: "Traslado", remito: "Retiro para aplicar",
    uso: "Aplicado", retorno: "Devolución", ajuste_pos: "Ajuste", ajuste_neg: "Ajuste", venta: "Venta",
    rincon: "Reingreso al Rincón", apertura: "Apertura de envase",
  };
  var TIPO_DE = {};
  Object.keys(TIPO_TXT).forEach(function (k) { if (k !== "ajuste_neg") TIPO_DE[slug(TIPO_TXT[k])] = k; });
  var CON_SIGNO = { transferencia: 1, apertura: 1, remito: 1, retorno: 1 };
  var SIGNO = { inicial: 1, compra: 1, ajuste_pos: 1, rincon: 1, venta: -1, uso: -1, ajuste_neg: -1 };

  function nombreDep(S, id) {
    if (id === TRANSITO) return "En tránsito";
    var d = (S.depositos || []).find(function (x) { return x.id === id; });
    return d ? d.nombre : "";
  }
  function nombreProd(S, id) {
    var p = (S.catalogo || []).find(function (x) { return x.id === id; });
    return p ? p.marca : "";
  }
  function numeroOT(S, id) {
    var o = (S.ordenes || []).find(function (x) { return x.id === id; });
    return o ? o.numero : "";
  }

  /** Un depósito por nombre; si no existe, se crea (cargado a mano en la planilla). */
  function depPorNombre(S, nombre) {
    if (!nombre) return "";
    if (slug(nombre) === "en-transito") return TRANSITO;
    var d = (S.depositos || []).find(function (x) { return slug(x.nombre) === slug(nombre); });
    if (!d) { d = { id: "dep-" + slug(nombre), nombre: String(nombre).trim(), zona: "", tipo: "propio", ubicacion: "" }; S.depositos.push(d); }
    return d.id;
  }
  /** Un producto por nombre; si no existe, se crea. */
  function prodPorNombre(S, nombre, unidad) {
    if (!nombre) return "";
    var p = (S.catalogo || []).find(function (x) { return slug(x.marca) === slug(nombre); });
    if (!p) {
      p = { id: "cat-" + slug(nombre), marca: String(nombre).trim(), pa: "", tipo: "Otro", unidad: unidad || "L", dosis: 0, min: 0, precio: 0 };
      S.catalogo.push(p);
    }
    return p.id;
  }
  function otPorNumero(S, numero) {
    var o = (S.ordenes || []).find(function (x) { return x.numero === numero; });
    return o ? o.id : "";
  }
  function unidadDe(S, prodId) {
    var p = (S.catalogo || []).find(function (x) { return x.id === prodId; });
    return p ? p.unidad : "";
  }

  function filaMovimiento(S, m) {
    var cant = CON_SIGNO[m.tipo] ? m.cant : (SIGNO[m.tipo] || 0) * m.cant;
    var resto = {};
    ["link", "compra", "zona", "otId", "ref", "verificadoPor", "fechaVerificacion", "aporta", "sub", "proveedor", "confirmadoPor", "fechaConfirmacion"].forEach(function (k) { if (m[k] !== undefined && m[k] !== "") resto[k] = m[k]; });
    return Object.assign({
      "Fecha": m.fecha || "", "Tipo": TIPO_TXT[m.tipo] || m.tipo, "Producto": nombreProd(S, m.prod),
      "Depósito": nombreDep(S, m.deposito), "Cantidad": r3(cant), "Unidad": unidadDe(S, m.prod),
      "Envase": m.sub === "abierto" ? "Rincón" : "Cerrado", "OT": m.otId ? numeroOT(S, m.otId) : "",
      "Remito": m.tipo === "remito" ? (m.ref || "") : "",
      "Verificado": m.tipo === "compra" ? (m.verificado === false ? "No" : "Sí") : "",
      // Pedido o cotización: cuenta como compra recién con la factura (o la confirmación del socio)
      "Confirmado": m.confirmado === false ? "No" : m.confirmado === true || m.proveedor ? "Sí" : "",
      "Precio US$": m.precio ? r3(m.precio) : "", "Nota": m.nota || "", "Usuario": m.usuario || "",
      "Anulado": "", "datos": JSON.stringify(resto),
    }, prueba(m.prueba !== undefined ? m.prueba : ordenDe(S, m.otId).prueba));
  }
  /**
   * Columna «Prueba»: órdenes ficticias, cargadas para probar la app, y sus
   * movimientos. Se limpian juntas después. Sólo aparece si se marcó (o
   * desmarcó): así las filas de siempre no cambian.
   */
  function prueba(v) { return v === undefined ? {} : { "Prueba": v ? "Sí" : "No" }; }
  function ordenDe(S, id) {
    if (!id) return {};
    for (var i = 0; i < (S.ordenes || []).length; i++) if (S.ordenes[i].id === id) return S.ordenes[i];
    return {};
  }
  function movimientoDeFila(S, id, f) {
    var d = datosDe(f.datos);
    var tipo = TIPO_DE[slug(f["Tipo"])] || "ajuste_pos";
    var c = num(f["Cantidad"]);
    if (tipo === "ajuste_pos" && c < 0) tipo = "ajuste_neg";
    var m = {
      id: id, fecha: f["Fecha"] || "", tipo: tipo,
      prod: prodPorNombre(S, f["Producto"], f["Unidad"]), deposito: depPorNombre(S, f["Depósito"]),
      cant: CON_SIGNO[tipo] ? c : Math.abs(c), precio: num(f["Precio US$"]), nota: f["Nota"] || "", usuario: f["Usuario"] || "",
    };
    m.sub = slug(f["Envase"]) === "rincon" ? "abierto" : (d.sub === "abierto" && !f["Envase"] ? "abierto" : "cerrado");
    ["link", "compra", "zona", "ref", "verificadoPor", "fechaVerificacion", "aporta", "proveedor", "confirmadoPor", "fechaConfirmacion"].forEach(function (k) { if (d[k] !== undefined) m[k] = d[k]; });
    m.otId = f["OT"] ? (otPorNumero(S, f["OT"]) || d.otId || "") : (d.otId || "");
    if (tipo === "remito" && f["Remito"]) m.ref = f["Remito"];
    if (tipo === "compra") m.verificado = !/^no$/i.test(String(f["Verificado"] || "").trim());
    if (/^no$/i.test(String(f["Confirmado"] || "").trim())) m.confirmado = false;
    else if (si(f["Confirmado"])) m.confirmado = true;
    if (si(f["Prueba"])) m.prueba = true;
    return m;
  }

  // ── Productos · Depósitos · Campos ─────────────────────────────────────
  var PROD_VISIBLES = ["id", "marca", "pa", "tipo", "unidad", "envase", "min", "reg"];
  function filaProducto(p) {
    var resto = {};
    Object.keys(p).forEach(function (k) { if (PROD_VISIBLES.indexOf(k) === -1) resto[k] = p[k]; });
    return { "Producto": p.marca || "", "Principio activo": p.pa || "", "Tipo": p.tipo || "", "Unidad": p.unidad || "",
             "Envase": p.envase ? r3(p.envase) : "", "Mínimo": p.min ? r3(p.min) : "", "Registro SENASA": p.reg || "",
             "Anulado": "", "datos": JSON.stringify(resto) };
  }
  function productoDeFila(id, f, previo) {
    var p = Object.assign({}, previo || {}, datosDe(f.datos));
    p.id = id; p.marca = String(f["Producto"] || "").trim(); p.pa = f["Principio activo"] || "";
    p.tipo = f["Tipo"] || p.tipo || "Otro"; p.unidad = f["Unidad"] || p.unidad || "L";
    p.envase = num(f["Envase"]); p.min = num(f["Mínimo"]);
    if (f["Registro SENASA"]) p.reg = String(f["Registro SENASA"]);
    if (p.dosis === undefined) p.dosis = 0;
    if (p.precio === undefined) p.precio = 0;
    return p;
  }
  function filaDeposito(d) {
    return { "Depósito": d.nombre, "Zona": ZONA_TXT[d.zona] || d.zona || "", "Tipo": d.tipo === "tercero" ? "Comercio" : "Propio",
             "Ubicación": d.ubicacion || "", "Anulado": "" };
  }
  function depositoDeFila(id, f) {
    var z = slug(f["Zona"]);
    return { id: id, nombre: String(f["Depósito"] || "").trim(), zona: "TL",   // Tierra Lejana: una sola zona
             tipo: /comercio|tercero/i.test(f["Tipo"] || "") ? "tercero" : "propio", ubicacion: f["Ubicación"] || "" };
  }
  function camposDe(S) {
    var meta = (g.APLIC_META && g.APLIC_META.campos) || {};
    var lotes = Array.isArray(g.LOTES) ? g.LOTES : (S.lotes || []);
    var vistos = {};
    lotes.forEach(function (l) { if (l.campo) vistos[l.campo] = true; });
    return Object.keys(vistos).sort().map(function (c) {
      return { codigo: c, nombre: (meta[c] && meta[c].nombre) || c, zona: (meta[c] && meta[c].zona) || "" };
    });
  }

  // ── OT ────────────────────────────────────────────────────────────────
  function estadoTxt(o) {
    if (o.estado === "transito") return "Producto retirado";
    if (o.estado === "reportada") return "Aplicación reportada";
    if (o.estado === "aplicada") return o.retorno === "hecho" ? "Remanente devuelto" : "Aplicada";
    return "Solicitada";
  }
  function estadoDe(txt) {
    var s = slug(txt);
    if (s === "producto-retirado" || s === "en-transito" || s === "retirado") return { estado: "transito" };
    if (s === "aplicacion-reportada" || s === "reportada") return { estado: "reportada" };
    if (s === "remanente-devuelto" || s === "cerrada") return { estado: "aplicada", retorno: "hecho" };
    if (s === "aplicada") return { estado: "aplicada" };
    return { estado: "borrador" };
  }
  function loteTxt(S, x) {
    var l = (S.lotes || []).find(function (y) { return y.id === x.loteId; });
    return (l ? l.nombre : "?") + " (" + String(r3(x.ha)).replace(".", ",") + " ha)";
  }
  function lotesTxt(S, o) { return (o.lotes || []).map(function (x) { return loteTxt(S, x); }).join(", "); }
  /** «EM10 (68 ha), EM11» → lotes de la orden (por nombre; sin ha, la del lote). */
  function lotesDeTxt(S, txt) {
    return String(txt || "").split(/[,;]/).map(function (p) { return p.trim(); }).filter(Boolean).map(function (p) {
      var m = p.match(/^(.*?)\s*(?:\(([\d.,]+)\s*ha\)?)?$/i);
      var nombre = (m ? m[1] : p).trim();
      var l = (S.lotes || []).find(function (y) { return slug(y.nombre) === slug(nombre); });
      if (!l) return null;
      return { loteId: l.id, ha: m && m[2] ? num(m[2]) : l.ha, nota: "" };
    }).filter(Boolean);
  }
  function zonaDe(S, o) {
    var meta = (g.APLIC_META && g.APLIC_META.campos) || {};
    var zs = {};
    (o.lotes || []).forEach(function (x) {
      var l = (S.lotes || []).find(function (y) { return y.id === x.loteId; });
      var z = l && meta[l.campo] && meta[l.campo].zona;
      if (z) zs[z] = true;
    });
    var k = Object.keys(zs);
    return k.length === 1 ? (ZONA_TXT[k[0]] || k[0]) : k.length ? "Mezcladas" : "";
  }
  var OT_DATOS = ["campania", "mojado", "tanque", "lotes", "remito", "retorno", "haReal", "deposito", "reporte"];
  function filaOT(S, o) {
    var resto = {};
    OT_DATOS.forEach(function (k) { if (o[k] !== undefined) resto[k] = o[k]; });
    return Object.assign({
      "OT": o.numero, "Fecha": o.fecha || "", "Estado": estadoTxt(o), "Zona": zonaDe(S, o), "Lotes": lotesTxt(S, o),
      "ha": r3((o.lotes || []).reduce(function (a, x) { return a + num(x.ha); }, 0)),
      "Cultivo": o.cultivo || "", "Labor": o.labor || "", "Aplicador": o.responsable || "", "Aporta": o.aporta || "",
      "Remito": o.remito ? o.remito.numero : "", "Fecha aplicación": o.fechaAplicacion || "",
      "ha aplicadas": o.haReal ? r3(o.haReal) : "", "Observaciones": o.obs || "", "Usuario": o.usuario || "",
      "Anulado": "", "datos": JSON.stringify(resto),
    }, prueba(o.prueba));
  }
  function idItem(o, it, i) {
    if (it._fila) return it._fila;          // fila cargada a mano en la planilla: conserva su id
    var n = 0;
    for (var j = 0; j < i; j++) if (o.items[j].prod === it.prod) n++;
    return o.id + "|" + it.prod + (n ? "|" + n : "");
  }
  var ITEM_DATOS = ["origen", "decision", "retiros", "origenRemito", "remanente"];
  function filasItems(S, o) {
    var out = {};
    var ha = (o.lotes || []).reduce(function (a, x) { return a + num(x.ha); }, 0);
    (o.items || []).forEach(function (it, i) {
      if (!it.prod) return;
      var resto = { orden: i };
      ITEM_DATOS.forEach(function (k) { if (it[k] !== undefined) resto[k] = it[k]; });
      var porHa = /^(l|kg)\/ha$/i.test(it.unidad || "") ? num(it.dosis) : /^(cc|g)\/ha$/i.test(it.unidad || "") ? num(it.dosis) / 1000 : 0;
      out[idItem(o, it, i)] = {
        "OT": o.numero, "Producto": nombreProd(S, it.prod), "Dosis": r3(it.dosis), "Unidad dosis": it.unidad || "",
        "Necesidad": porHa ? r3(porHa * ha) : "", "Retirado": it.retirado ? r3(it.retirado) : "",
        "Usado": it.usado ? r3(it.usado) : "", "Dosis real": it.dosisReal ? r3(it.dosisReal) : "",
        "Devuelto": it.volvio !== undefined ? r3(it.volvio) : "", "Sale de": nombreDep(S, it.origenRemito || it.origen || ""),
        "Anulado": "", "datos": JSON.stringify(resto),
      };
    });
    return out;
  }
  /** La orden a partir de su fila y las de sus productos. */
  function otDeFilas(S, id, f, filasProd, previa) {
    var d = datosDe(f.datos);
    var o = Object.assign({ items: [], lotes: [] }, previa || {}, d);
    o.id = id; o.numero = String(f["OT"] || o.numero || ""); o.fecha = f["Fecha"] || o.fecha || "";
    var e = estadoDe(f["Estado"]);
    o.estado = e.estado;
    if (e.retorno) o.retorno = e.retorno;
    else if (o.estado !== "aplicada") delete o.retorno;
    else if (!d.retorno && !(previa && previa.retorno)) o.retorno = "";
    // Lotes: si el texto no cambió, se conservan los de «datos» (con sus notas)
    if (!(d.lotes && lotesTxt(S, { lotes: d.lotes }) === String(f["Lotes"] || ""))) o.lotes = lotesDeTxt(S, f["Lotes"]);
    o.cultivo = f["Cultivo"] || ""; o.labor = f["Labor"] || o.labor || ""; o.responsable = f["Aplicador"] || "";
    o.aporta = f["Aporta"] || ""; o.obs = f["Observaciones"] || ""; o.usuario = f["Usuario"] || o.usuario || "";
    o.fechaAplicacion = f["Fecha aplicación"] || "";
    if (si(f["Prueba"])) o.prueba = true;
    else if (/^no$/i.test(String(f["Prueba"] || "").trim())) o.prueba = false;
    o.haReal = f["ha aplicadas"] !== "" && f["ha aplicadas"] !== undefined ? num(f["ha aplicadas"]) : o.haReal;
    if (f["Remito"]) o.remito = Object.assign({}, o.remito || {}, { numero: String(f["Remito"]) });
    if (o.mojado === undefined) o.mojado = 80;
    if (o.tanque === undefined) o.tanque = 3000;
    o.items = filasProd.slice().sort(function (a, b) { return (datosDe(a.f.datos).orden || 0) - (datosDe(b.f.datos).orden || 0); })
      .map(function (x) {
        var fd = x.f, dd = datosDe(fd.datos);
        var it = { prod: prodPorNombre(S, fd["Producto"]), dosis: num(fd["Dosis"]), unidad: fd["Unidad dosis"] || "l/ha" };
        if (x.id.indexOf("|") === -1) it._fila = x.id;
        ITEM_DATOS.forEach(function (k) { if (dd[k] !== undefined) it[k] = dd[k]; });
        if (fd["Retirado"] !== "" && fd["Retirado"] !== undefined) it.retirado = num(fd["Retirado"]);
        if (fd["Usado"] !== "" && fd["Usado"] !== undefined) it.usado = num(fd["Usado"]);
        if (fd["Dosis real"] !== "" && fd["Dosis real"] !== undefined) it.dosisReal = num(fd["Dosis real"]);
        if (fd["Devuelto"] !== "" && fd["Devuelto"] !== undefined) it.volvio = num(fd["Devuelto"]);
        if (fd["Sale de"]) it.origenRemito = depPorNombre(S, fd["Sale de"]);
        return it;
      });
    return o;
  }

  // ── Planificación (cultivo por lote) ──────────────────────────────────
  function filaPlan(p) {
    return { "Zona": p.zona || "", "Campo": p.campo || "", "Lote": p.lote || "", "ha": p.ha ? r3(p.ha) : "",
             "Cultivo": p.cultivo || "", "Variedad": p.variedad || "", "En el mapa": p.loteId ? "Sí" : "No",
             "Observaciones": p.obs || "", "Anulado": "" };
  }
  function planDeFila(S, id, f) {
    var lote = String(f["Lote"] || "").trim();
    // Primero el lote del mapa (ids del shapefile); si no, el que tenga el equipo
    var l = (Array.isArray(g.LOTES) ? g.LOTES.find(function (y) { return slug(y.nombre) === slug(lote); }) : null) ||
            (S.lotes || []).find(function (y) { return slug(y.nombre) === slug(lote); });
    return { id: id, zona: f["Zona"] || "", campo: f["Campo"] || "", lote: lote, ha: num(f["ha"]), cultivo: String(f["Cultivo"] || "").trim(),
             variedad: f["Variedad"] || "", obs: f["Observaciones"] || "", loteId: l ? l.id : "" };
  }

  // ── API ───────────────────────────────────────────────────────────────
  var TABLAS = ["Productos", "Depósitos", "Campos", "Movimientos", "OT", "OT_Productos", "Planificación"];

  /** El estado del stock como filas de la planilla: {tabla: {id: valores}}. */
  function filas(S) {
    var out = { "Productos": {}, "Depósitos": {}, "Campos": {}, "Movimientos": {}, "OT": {}, "OT_Productos": {}, "Planificación": {} };
    (S.planificacion || []).forEach(function (p) { out["Planificación"][p.id] = filaPlan(p); });
    (S.catalogo || []).forEach(function (p) { out["Productos"][p.id] = filaProducto(p); });
    (S.depositos || []).forEach(function (d) { out["Depósitos"][d.id] = filaDeposito(d); });
    var soc = S.camposSociedad || [];
    if (!g.APLIC_META) delete out["Campos"];      // sin el historial no se sabe la zona: no se compara
    else camposDe(S).forEach(function (c) {
      out["Campos"]["campo-" + slug(c.codigo)] = { "Campo": c.nombre, "Código": c.codigo, "Zona": ZONA_TXT[c.zona] || c.zona,
                                                    "En sociedad": soc.indexOf(c.codigo) !== -1 ? "Sí" : "No" };
    });
    (S.movimientos || []).forEach(function (m) { out["Movimientos"][m.id] = filaMovimiento(S, m); });
    (S.ordenes || []).forEach(function (o) {
      out["OT"][o.id] = filaOT(S, o);
      var it = filasItems(S, o);
      Object.keys(it).forEach(function (k) { out["OT_Productos"][k] = it[k]; });
    });
    return out;
  }

  /**
   * Aplica al estado las filas que llegaron de la planilla.
   * entrantes: {tabla: {id: valores | null}} (null = anulada).
   * actuales: filas(S) antes de aplicar, para completar una OT con los
   * productos que no cambiaron. Devuelve los ids de OT reconstruidas.
   */
  function aplicar(S, entrantes, actuales) {
    ["depositos", "catalogo", "movimientos", "ordenes", "lotes", "planificacion"].forEach(function (k) { if (!Array.isArray(S[k])) S[k] = []; });
    // Los lotes son los del mapa: hacen falta para entender «EM10 (68 ha)»
    if (!S.lotes.length && Array.isArray(g.LOTES)) {
      S.lotes = g.LOTES.map(function (l) { return { id: l.id, nombre: l.nombre, campo: l.campo, ha: l.ha, cultivo: "" }; });
    }
    var E = function (t) { return entrantes[t] || {}; };
    var reemplazar = function (lista, id, nuevo) {
      var i = -1;
      for (var j = 0; j < lista.length; j++) if (lista[j].id === id) { i = j; break; }
      if (nuevo === null) { if (i >= 0) lista.splice(i, 1); } else if (i >= 0) lista[i] = nuevo; else lista.push(nuevo);
    };
    Object.keys(E("Depósitos")).forEach(function (id) { var f = E("Depósitos")[id]; reemplazar(S.depositos, id, f ? depositoDeFila(id, f) : null); });
    Object.keys(E("Productos")).forEach(function (id) {
      var f = E("Productos")[id];
      var previo = S.catalogo.find(function (p) { return p.id === id; });
      reemplazar(S.catalogo, id, f ? productoDeFila(id, f, previo) : null);
    });
    Object.keys(E("Campos")).forEach(function (id) {
      var f = E("Campos")[id];
      if (!f) return;
      var soc = (S.camposSociedad || []).filter(function (c) { return c !== f["Código"]; });
      if (si(f["En sociedad"])) soc.push(f["Código"]);
      S.camposSociedad = soc;
    });
    // Órdenes antes que movimientos: un movimiento nuevo puede nombrar una OT nueva
    var tocadas = {};
    Object.keys(E("OT")).forEach(function (id) { tocadas[id] = true; });
    var numeroAId = {};
    (S.ordenes || []).forEach(function (o) { numeroAId[o.numero] = o.id; });
    Object.keys(E("OT")).forEach(function (id) { var f = E("OT")[id]; if (f) numeroAId[f["OT"]] = id; });
    Object.keys(E("OT_Productos")).forEach(function (pid) {
      var f = E("OT_Productos")[pid];
      var otId = pid.indexOf("|") > 0 ? pid.split("|")[0] : (f && numeroAId[f["OT"]]);
      var act = (actuales["OT_Productos"] || {})[pid];
      if (!otId && act) otId = numeroAId[act["OT"]];
      if (otId) tocadas[otId] = true;
    });
    Object.keys(tocadas).forEach(function (otId) {
      var cab = otId in E("OT") ? E("OT")[otId] : (actuales["OT"] || {})[otId];
      var previa = S.ordenes.find(function (o) { return o.id === otId; });
      if (!cab) { reemplazar(S.ordenes, otId, null); return; }
      var prods = {};
      Object.keys(actuales["OT_Productos"] || {}).forEach(function (pid) {
        if (pid.split("|")[0] === otId) prods[pid] = actuales["OT_Productos"][pid];
      });
      Object.keys(E("OT_Productos")).forEach(function (pid) {
        var f = E("OT_Productos")[pid];
        var suya = pid.indexOf("|") > 0 ? pid.split("|")[0] === otId : (f && numeroAId[f["OT"]] === otId);
        if (!suya) return;
        if (f) prods[pid] = f; else delete prods[pid];
      });
      var lista = Object.keys(prods).map(function (pid) { return { id: pid, f: prods[pid] }; });
      reemplazar(S.ordenes, otId, otDeFilas(S, otId, cab, lista, previa));
    });
    Object.keys(E("Planificación")).forEach(function (id) {
      var f = E("Planificación")[id];
      reemplazar(S.planificacion, id, f ? planDeFila(S, id, f) : null);
    });
    Object.keys(E("Movimientos")).forEach(function (id) {
      var f = E("Movimientos")[id];
      reemplazar(S.movimientos, id, f ? movimientoDeFila(S, id, f) : null);
    });
    return Object.keys(tocadas);
  }

  g.IAgHojas = { TABLAS: TABLAS, filas: filas, aplicar: aplicar, anulada: function (f) { return si(f && f["Anulado"]); } };
})(window);
