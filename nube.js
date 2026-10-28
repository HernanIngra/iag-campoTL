// Conexión con la planilla del Drive (ver drive/LEEME.md). Va en todas las
// páginas, DESPUÉS de los <script> de datos y ANTES del código de la página.
//
// Hace tres cosas:
//   1. Datos de la empresa (lotes, historial, presupuesto base): si la página
//      no los pudo cargar de un archivo (porque la app está publicada sin
//      ellos), los toma de la copia guardada en este equipo o los baja del Drive.
//   2. Sincroniza lo que se carga (stock y presupuesto): sube lo nuevo y baja
//      lo de los demás. Funciona sin señal: guarda en el equipo y sincroniza
//      cuando vuelve la conexión.
//   3. Muestra el estado abajo a la izquierda.
(function (g) {
  "use strict";

  var CONFIG = "iagtl_nube";            // {url, clave}
  var BASE = "iagtl_nube_base2";         // {clave localStorage: {tabla: {id: json}}} — lo último en común con el Drive
  var REV = "iagtl_nube_rev";           // + "_" + clave: última revisión bajada para esa clave
  var ULTIMA = "iagtl_nube_ultima";     // fecha de la última sincronización buena
  var INTENTO_ARCHIVOS = "iagtl_nube_falta_archivos";   // último intento de bajar historial y presupuesto

  // ── Datos de la empresa ───────────────────────────────────────────────
  var ARCHIVOS = [
    { nombre: "lotes-tl", globales: ["LOTES_META", "LOTES"], falta: "LOTES_FALTA" },
    // APLICACIONES primero: APLIC_META puede venir de campos-tl.js (la parte pública)
    { nombre: "aplicaciones-tl", globales: ["APLICACIONES", "APLIC_META", "APLIC_DIC", "APLIC_GRUPOS"], falta: "APLIC_FALTA" },
  ];
  var claveArchivo = function (n) { return "iagtl_archivo_" + n; };

  function leer(k) { try { return JSON.parse(localStorage.getItem(k) || "null"); } catch (e) { return null; } }
  var setItemOriginal = Storage.prototype.setItem;
  function escribir(k, v) { try { setItemOriginal.call(localStorage, k, typeof v === "string" ? v : JSON.stringify(v)); return true; } catch (e) { return false; } }

  function config() {
    var c = leer(CONFIG);
    return c && c.url && c.clave ? c : null;
  }

  // Un enlace «…#conectar=…» deja este equipo conectado (lo genera conectar.html)
  (function deEnlace() {
    var m = (location.hash || "").match(/conectar=([^&]+)/);
    if (!m) return;
    try {
      var c = JSON.parse(decodeURIComponent(escape(atob(m[1].replace(/-/g, "+").replace(/_/g, "/")))));
      if (c.url && c.clave) escribir(CONFIG, c);
    } catch (e) { /* enlace roto: se ignora */ }
    history.replaceState(null, "", location.pathname + location.search);
  })();

  /** Lo que la página no pudo cargar de un archivo, desde la copia del equipo. */
  var faltan = [];
  ARCHIVOS.forEach(function (a) {
    if (g[a.globales[0]] !== undefined) return;            // vino del archivo (en la Mac, por ejemplo)
    var texto = null;
    try { texto = localStorage.getItem(claveArchivo(a.nombre)); } catch (e) { texto = null; }
    if (texto) {
      try { (0, eval)(texto); g[a.falta] = false; return; } catch (e) { /* copia rota: se vuelve a bajar */ }
    }
    faltan.push(a);
  });
  // Sólo importa si la página usa ese archivo: lo sabe porque su <script> falló
  var necesarios = faltan.filter(function (a) { return g[a.falta]; });

  // ── Llamadas al Apps Script ───────────────────────────────────────────
  function pedir(params) {
    var c = config();
    var q = Object.keys(params).map(function (k) { return k + "=" + encodeURIComponent(params[k]); }).join("&");
    return fetch(c.url + "?" + q + "&clave=" + encodeURIComponent(c.clave)).then(function (r) { return r.json(); });
  }
  function enviar(cuerpo) {
    var c = config();
    cuerpo.clave = c.clave;
    // text/plain: así no hay consulta previa de CORS (Apps Script no la contesta)
    return fetch(c.url, { method: "POST", headers: { "Content-Type": "text/plain;charset=utf-8" }, body: JSON.stringify(cuerpo) })
      .then(function (r) { return r.json(); });
  }

  function bajarArchivos(lista) {
    return Promise.all(lista.map(function (a) {
      return pedir({ accion: "archivo", nombre: a.nombre }).then(function (r) {
        if (!r.ok) throw new Error(r.error || "no se pudo bajar " + a.nombre);
        if (!escribir(claveArchivo(a.nombre), r.contenido)) throw new Error("no entra en la memoria del navegador");
        escribir(claveArchivo(a.nombre) + "_subido", r.subido || "");
      });
    }));
  }

  // ── Qué se sincroniza ─────────────────────────────────────────────────
  // Cada colección del estado de una página es una «tabla» de registros con id.
  var porId = function (campo) {
    return {
      sacar: function (arr) { var o = {}; (arr || []).forEach(function (x) { if (x && x[campo] != null) o[x[campo]] = x; }); return o; },
      poner: function (estado, prop, id, valor) {
        var arr = estado[prop] = estado[prop] || [];
        var i = -1;
        for (var j = 0; j < arr.length; j++) if (String(arr[j][campo]) === String(id)) { i = j; break; }
        if (valor === null) { if (i >= 0) arr.splice(i, 1); }
        else if (i >= 0) arr[i] = valor; else arr.push(valor);
      },
    };
  };
  var mapa = {
    sacar: function (obj) { return obj || {}; },
    poner: function (estado, prop, id, valor) {
      var o = estado[prop] = estado[prop] || {};
      if (valor === null) delete o[id]; else o[id] = valor;
    },
  };
  // Stock: las pestañas legibles de la planilla (hojas.js). Sólo en las
  // páginas que tienen lo necesario para traducirlas (los lotes y el
  // historial, que dicen la zona de cada campo); en las demás no se toca.
  // Presupuesto y pedidos: registros internos (_registros), como JSON.
  var CLAVES = {
    iagtl_stock_v2: {
      disponible: function () { return !!(g.IAgHojas && g.APLIC_META && Array.isArray(g.LOTES)); },
      hojas: true,
      json: { "stock.pedidos": { prop: "pedidos", t: porId("id") } },
    },
    iagtl_presupuesto_v1: {
      disponible: function () { return true; },
      json: {
        "pres.lotes": { prop: "lotes", t: porId("uid") },
        "pres.modelos": { prop: "modelos", t: mapa },
        "pres.precios": { prop: "precios", t: mapa },
        "pres.siembra": { prop: "siembra", t: mapa },
      },
    },
  };
  var claveDeTabla = {};
  Object.keys(CLAVES).forEach(function (k) { Object.keys(CLAVES[k].json).forEach(function (t) { claveDeTabla[t] = k; }); });
  var esHoja = function (t) { return !!(g.IAgHojas && g.IAgHojas.TABLAS.indexOf(t) !== -1); };
  var disponibles = function () { return Object.keys(CLAVES).filter(function (k) { return CLAVES[k].disponible(); }); };
  var cursor = function (k) { return Number(leer(REV + "_" + k) || 0); };

  /** {tabla: {id: json}} del estado de una clave: filas de la planilla y registros. */
  function foto(k, estado) {
    var out = {};
    if (CLAVES[k].hojas) {
      var f = g.IAgHojas.filas(estado);
      Object.keys(f).forEach(function (t) {
        var o = out[t] = {};
        Object.keys(f[t]).forEach(function (id) { o[id] = JSON.stringify(f[t][id]); });
      });
    }
    Object.keys(CLAVES[k].json).forEach(function (t) {
      var def = CLAVES[k].json[t];
      var regs = def.t.sacar(def.prop ? estado[def.prop] : estado);
      var o = out[t] = {};
      Object.keys(regs).forEach(function (id) { o[id] = JSON.stringify(regs[id]); });
    });
    return out;
  }

  /** ¿La fila que llegó de la planilla es la misma que este equipo ya tiene? */
  function igual(json, remoto) {
    if (!json || !remoto) return false;
    var a = JSON.parse(json);
    return Object.keys(a).every(function (c) {
      var x = a[c], y = remoto[c] === undefined || remoto[c] === null ? "" : remoto[c];
      if (typeof x === "number" || typeof y === "number") return Math.abs(Number(x || 0) - Number(y || 0)) < 1e-6 && String(x) !== "" === (String(y) !== "");
      return String(x) === String(y);
    });
  }

  /** Cambios de este equipo que todavía no están en el Drive. */
  function pendientes() {
    var base = leer(BASE) || {}, n = 0, regs = [];
    disponibles().forEach(function (k) {
      var estado = leer(k);
      if (!estado) return;
      var cur = foto(k, estado), b = base[k] || {};
      Object.keys(cur).forEach(function (t) {
        var bt = b[t] || {};
        Object.keys(cur[t]).forEach(function (id) {
          if (cur[t][id] !== bt[id]) { n++; regs.push({ k: k, tabla: t, id: id, json: cur[t][id] }); }
        });
        Object.keys(bt).forEach(function (id) {
          if (!(id in cur[t])) { n++; regs.push({ k: k, tabla: t, id: id, borrado: true }); }
        });
      });
    });
    return { n: n, regs: regs };
  }

  var avisar = {};    // clave → funciones de la página para recargar su estado
  var enCurso = null, ultimoError = "";

  /**
   * Una vuelta: primero se baja lo de los demás y después se sube lo propio.
   * Lo bajado no pisa una fila que este equipo cambió y todavía no subió (lo
   * propio gana y se sube enseguida), salvo en la primera sincronización de
   * una clave: ahí la planilla manda, para no subir los datos de arranque de
   * un equipo nuevo encima de lo que ya cargaron los demás.
   */
  function sincronizar() {
    if (!config()) { pintarEstado(); return Promise.resolve(); }
    if (enCurso) return enCurso;
    if (!navigator.onLine) { pintarEstado(); return Promise.resolve(); }
    var claves = disponibles();
    // Se vuelve a pedir un margen de dos minutos: lo que se editó a mano justo
    // mientras se leía no se pierde (aplicar dos veces lo mismo no cambia nada)
    var desde = Math.max(0, Math.min.apply(null, claves.map(cursor)) - 120000);
    enCurso = pedir({ accion: "cambios", desde: desde }).then(function (r) {
      if (!r.ok) throw new Error(r.error === "clave" ? "clave incorrecta" : r.error);
      var base = leer(BASE) || {};
      var tocadas = {};
      claves.forEach(function (k) {
        var estado = leer(k) || {};
        var primera = !base[k];
        var b = base[k] = base[k] || {};
        var cur = foto(k, estado);
        var cambio = false;

        // Registros internos (JSON)
        var ultimos = {};
        (r.registros || []).forEach(function (x) { if (claveDeTabla[x.tabla] === k) ultimos[x.tabla + "\u0001" + x.id] = x; });
        Object.keys(ultimos).forEach(function (kk) {
          var x = ultimos[kk], bt = b[x.tabla] = b[x.tabla] || {}, ct = cur[x.tabla] || {};
          if (bt[x.id] === (x.borrado ? undefined : x.json)) return;          // ya está
          if (!primera && ct[x.id] !== bt[x.id]) return;                     // cambio propio sin subir: gana
          var def = CLAVES[k].json[x.tabla];
          def.t.poner(estado, def.prop, x.id, x.borrado ? null : JSON.parse(x.json));
          if (x.borrado) delete bt[x.id]; else bt[x.id] = x.json;
          cambio = true;
        });

        // Filas de las pestañas
        if (CLAVES[k].hojas) {
          var ultimasF = {};
          (r.filas || []).forEach(function (x) { if (esHoja(x.tabla)) ultimasF[x.tabla + "\u0001" + x.id] = x; });
          var entrantes = {}, hay = false;
          Object.keys(ultimasF).forEach(function (kk) {
            var x = ultimasF[kk], bt = b[x.tabla] = b[x.tabla] || {}, ct = cur[x.tabla] || {};
            var anulada = g.IAgHojas.anulada(x.valores);
            if (anulada ? !(x.id in ct) && !(x.id in bt) : igual(bt[x.id], x.valores) && ct[x.id] === bt[x.id]) return;
            if (!primera && x.tabla in cur && ct[x.id] !== bt[x.id]) return;
            (entrantes[x.tabla] = entrantes[x.tabla] || {})[x.id] = anulada ? null : x.valores;
            hay = true;
          });
          if (hay) {
            var antes = g.IAgHojas.filas(estado);
            var otIds = g.IAgHojas.aplicar(estado, entrantes, antes);
            var despues = g.IAgHojas.filas(estado);
            // Base = cómo queda cada fila tocada, vista desde este equipo
            var poner = function (t, id) {
              var bt = b[t] = b[t] || {};
              if (despues[t] && despues[t][id]) bt[id] = JSON.stringify(despues[t][id]); else delete bt[id];
            };
            Object.keys(entrantes).forEach(function (t) { Object.keys(entrantes[t]).forEach(function (id) { poner(t, id); }); });
            var numeros = {};
            otIds.forEach(function (id) {
              poner("OT", id);
              [antes, despues].forEach(function (f) { if (f["OT"] && f["OT"][id]) numeros[f["OT"][id]["OT"]] = true; });
            });
            [antes, despues].forEach(function (f) {
              Object.keys(f["OT_Productos"] || {}).forEach(function (id) { if (numeros[f["OT_Productos"][id]["OT"]]) poner("OT_Productos", id); });
            });
            cambio = true;
          }
        }
        if (cambio) { escribir(k, estado); tocadas[k] = true; }
        escribir(REV + "_" + k, Math.max(cursor(k), Number(r.rev) || 0));
      });
      escribir(BASE, base);
      Object.keys(tocadas).forEach(function (k) { (avisar[k] || []).forEach(function (fn) { try { fn(); } catch (e) { /* la página se arregla sola al recargar */ } }); });
      return subir();
    }).then(function () {
      ultimoError = "";
      escribir(ULTIMA, new Date().toISOString());
    }).catch(function (e) {
      ultimoError = navigator.onLine ? String(e.message || e) : "";
    }).then(function () { enCurso = null; pintarEstado(); });
    pintarEstado();
    return enCurso;
  }

  function subir() {
    var p = pendientes();
    if (!p.n) return Promise.resolve();
    var u = g.IAgUsuario && g.IAgUsuario.actual();
    var filas = [], registros = [];
    p.regs.forEach(function (x) {
      if (esHoja(x.tabla)) filas.push(x.borrado ? { tabla: x.tabla, id: x.id, anulado: true } : { tabla: x.tabla, id: x.id, valores: JSON.parse(x.json) });
      else registros.push({ tabla: x.tabla, id: x.id, valor: x.borrado ? null : JSON.parse(x.json), borrado: !!x.borrado });
    });
    return enviar({ accion: "guardar", usuario: u ? u.id : "", filas: filas, registros: registros }).then(function (r) {
      if (!r.ok) throw new Error(r.error === "clave" ? "clave incorrecta" : r.error);
      var base = leer(BASE) || {};
      p.regs.forEach(function (x) {
        var b = base[x.k] = base[x.k] || {}, bt = b[x.tabla] = b[x.tabla] || {};
        if (x.borrado) delete bt[x.id]; else bt[x.id] = x.json;
      });
      escribir(BASE, base);
    });
  }

  // Cada vez que una página guarda stock o presupuesto, se sincroniza a los pocos segundos
  var demora = null;
  Storage.prototype.setItem = function (k, v) {
    setItemOriginal.apply(this, arguments);
    if (this === localStorage && CLAVES[k] && config()) {
      clearTimeout(demora);
      demora = setTimeout(sincronizar, 3000);
      pintarEstado();
    }
  };

  // ── Estado en pantalla ────────────────────────────────────────────────
  var pastilla = null;
  function pintarEstado() {
    if (!document.body) return;
    if (!pastilla) {
      pastilla = document.createElement("a");
      pastilla.href = "conectar.html";
      pastilla.id = "nube-estado";
      pastilla.style.cssText = "position:fixed;left:12px;bottom:12px;z-index:900;font:600 12.5px system-ui,-apple-system,sans-serif;" +
        "padding:6px 11px;border-radius:20px;text-decoration:none;box-shadow:0 2px 8px rgba(15,23,42,.15);background:#fff;color:#334155;border:1px solid #e2e8f0";
      document.body.appendChild(pastilla);
    }
    var c = config(), txt, color = "#334155";
    if (!c) { txt = "☁ Sin conectar al Drive · conectar"; color = "#92400e"; }
    else {
      var n = pendientes().n;
      var ult = localStorage.getItem(ULTIMA);
      var hora = ult ? new Date(ult).toLocaleTimeString("es-AR", { hour: "2-digit", minute: "2-digit" }) : "";
      // Mientras pregunta a la planilla se puede seguir trabajando: se avisa
      // con la hora de la última vez, sin parecer que la app está trabada
      if (enCurso) { txt = hora ? "☁ Sincronizado " + hora + " · buscando novedades…" : "☁ Sincronizando…"; color = "#64748b"; }
      else if (ultimoError) { txt = "☁ Error: " + ultimoError; color = "#b91c1c"; }
      else if (!navigator.onLine) { txt = "☁ Sin señal" + (n ? " · " + n + " cambio(s) por subir" : ""); color = "#92400e"; }
      else if (n) { txt = "☁ " + n + " cambio(s) por subir"; color = "#92400e"; }
      else txt = "☁ Sincronizado" + (hora ? " " + hora : "");
    }
    pastilla.textContent = txt;
    pastilla.style.color = color;
  }

  // ── Arranque ──────────────────────────────────────────────────────────

  document.addEventListener("DOMContentLoaded", function () {
    pintarEstado();
    // Lo que falta (historial, presupuesto base) no frena la página: el mapa y
    // las órdenes andan igual. Si el equipo está conectado, se baja en segundo
    // plano y se recarga una vez; si no, la pastilla avisa que falta conectar.
    // Si no están en la planilla todavía, no se insiste en cada página: cada
    // pedido al servidor gratuito de Google tarda segundos
    var intento = Number(leer(INTENTO_ARCHIVOS) || 0);
    if (necesarios.length && config() && navigator.onLine && Date.now() - intento > 10 * 60000) {
      bajarArchivos(necesarios).then(function () { location.reload(); })
        .catch(function () { escribir(INTENTO_ARCHIVOS, Date.now()); /* no estaba: se reintenta en 10 minutos */ });
    }
    // Al pasar de una página a otra no se vuelve a preguntar si se sincronizó
    // hace menos de medio minuto: la página abre con lo que ya tiene el equipo
    var hace = Date.now() - (Date.parse(localStorage.getItem(ULTIMA) || "") || 0);
    if (hace < 30000 && !pendientes().n) pintarEstado();
    else sincronizar();
  });
  g.addEventListener("online", function () { sincronizar(); });
  g.addEventListener("offline", pintarEstado);
  document.addEventListener("visibilitychange", function () { if (!document.hidden) sincronizar(); });
  setInterval(function () { if (!document.hidden) sincronizar(); }, 60000);

  g.IAgNube = {
    config: config,
    conectar: function (url, clave) { escribir(CONFIG, { url: url.trim(), clave: clave.trim() }); pintarEstado(); },
    desconectar: function () { try { localStorage.removeItem(CONFIG); } catch (e) { /* nada */ } pintarEstado(); },
    probar: function () { return pedir({ accion: "probar" }); },
    subirArchivo: function (nombre, contenido) { return enviar({ accion: "archivo", nombre: nombre, contenido: contenido }); },
    bajarArchivos: function () { return bajarArchivos(ARCHIVOS); },
    ARCHIVOS: ARCHIVOS,
    sincronizar: sincronizar,
    pendientes: function () { return pendientes().n; },
    /** La página avisa cómo recargar su estado cuando llegan cambios de otros. */
    alCambiar: function (clave, fn) { (avisar[clave] = avisar[clave] || []).push(fn); },
    enlace: function () {
      var c = config();
      if (!c) return "";
      var b = btoa(unescape(encodeURIComponent(JSON.stringify(c)))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
      return location.origin + location.pathname.replace(/[^/]*$/, "") + "index.html#conectar=" + b;
    },
  };
})(window);
