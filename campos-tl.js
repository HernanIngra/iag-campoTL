// Campos de Tierra Lejana. Público: no tiene datos de producción.
// Sirve para que la app ande (campos, mapa) sin el historial de labores,
// que es privado y se baja de la planilla del Drive de TL.
// Una sola zona (TL): el encargado ve y receta en todos los campos.
window.CAMPOS_TL = {
  "TL-DR": { "nombre": "Don Ramón",   "zona": "TL" },
  "TL-ER": { "nombre": "El Rosario",  "zona": "TL" },
  "TL-LL": { "nombre": "La Lejanía",  "zona": "TL" },
  "TL-LS": { "nombre": "La Sipinca",  "zona": "TL" },
  "TL-LT": { "nombre": "La Tenca",    "zona": "TL" },
};
// Si el historial no se cargó, se arma su parte pública con esto
window.APLIC_META = window.APLIC_META || { campos: window.CAMPOS_TL };
