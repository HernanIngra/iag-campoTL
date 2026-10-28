// Identidad y permisos, compartidos por los tres módulos.
// Generado a mano — es código, no datos.
(function (g) {
  "use strict";

  // Tierra Lejana: una sola zona (TL), así que nadie tiene zona asignada y
  // cada perfil ve todos los campos.
  var USUARIOS = [
    { id: "gerencia",  nombre: "Gerencia Agricultura", rol: "gerente",  titulo: "Gerencia Agricultura",
      hace: "Puede hacer todo: recetar, retirar, confirmar, comprar y presupuestar" },
    { id: "encargado", nombre: "Encargado Agricultura", rol: "encargado", titulo: "Encargado Agricultura",
      hace: "Crea las órdenes y confirma su realización y la devolución del remanente" },
    { id: "operarios", nombre: "Operarios", rol: "equipo", titulo: "Operarios",
      hace: "Reciben las órdenes pendientes y reportan la aplicación para que la confirme el encargado" },
    { id: "oficina", nombre: "Oficina", rol: "oficina",  titulo: "Oficina",
      hace: "Carga las compras y arma el presupuesto" },
  ];

  // Circuito de una orden: el encargado (o la gerencia) la emite; los
  // operarios o el encargado retiran el producto (remito); los operarios
  // reportan la aplicación y el encargado la confirma; el encargado confirma
  // la devolución del remanente.
  var PERMISOS = {
    gerente:   { borrarOT: 1, verPresupuesto: 1, emitirOT: 1, remitir: 1, reportar: 1, confirmarOT: 1, confirmarRetorno: 1, comprar: 1, verificar: 1, trasladar: 1 },
    encargado: { verPresupuesto: 0, emitirOT: 1, remitir: 1, reportar: 1, confirmarOT: 1, confirmarRetorno: 1, comprar: 0, verificar: 1, trasladar: 1 },
    equipo:    { verPresupuesto: 0, emitirOT: 0, remitir: 1, reportar: 1, confirmarOT: 0, confirmarRetorno: 0, comprar: 0, verificar: 0, trasladar: 0 },
    oficina:   { verPresupuesto: 1, emitirOT: 0, remitir: 0, reportar: 0, confirmarOT: 0, confirmarRetorno: 0, comprar: 1, verificar: 1, trasladar: 1 },
  };

  var CLAVE = "iagtl_usuario";

  function actual() {
    try {
      var id = localStorage.getItem(CLAVE);
      var u = null;
      for (var i = 0; i < USUARIOS.length; i++) if (USUARIOS[i].id === id) u = USUARIOS[i];
      return u;
    } catch (e) { return null; }
  }

  function entrar(id) {
    try { localStorage.setItem(CLAVE, id); } catch (e) {}
  }

  function salir() {
    try { localStorage.removeItem(CLAVE); } catch (e) {}
  }

  function puede(accion) {
    var u = actual();
    if (!u) return true;                    // sin identificar no se bloquea nada
    if (u.permisos && u.permisos[accion] != null) return !!u.permisos[accion];
    return !!(PERMISOS[u.rol] || {})[accion];
  }

  /**
   * Como puede(), pero además la zona tiene que ser la del usuario. Sin zona
   * = cualquiera (en Tierra Lejana nadie tiene zona: hay una sola).
   */
  function puedeEnZona(accion, zona) {
    var u = actual();
    if (!puede(accion)) return false;
    return !u || !u.zona || !zona || u.zona === zona;
  }

  /** Barra con quién sos, para poner en el encabezado de cada módulo. */
  function barra(destinoInicio) {
    var u = actual();
    if (!u) {
      return '<a class="hbtn" href="' + (destinoInicio || "index.html?v=25") +
             '" style="text-decoration:none">Identificarse</a>';
    }
    return '<span class="quien" title="' + u.hace + '">' +
             '<b>' + u.nombre + '</b><span class="rol">' + u.titulo + '</span>' +
           '</span>' +
           '<a class="hbtn" href="' + (destinoInicio || "index.html?v=25") +
           '" style="text-decoration:none" title="Cambiar de usuario">Cambiar</a>';
  }

  g.IAgUsuario = {
    USUARIOS: USUARIOS, PERMISOS: PERMISOS,
    actual: actual, entrar: entrar, salir: salir, puede: puede, puedeEnZona: puedeEnZona, barra: barra,
  };
})(window);
