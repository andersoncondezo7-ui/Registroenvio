// =========================================================
// CONFIGURACIÓN — lo único que normalmente tendrías que tocar
// =========================================================

// Fuente de datos de agencias: "json" (archivo local, actualizado con
// scripts/generar_agencias.py) o "sheets" (Google Sheets publicado como CSV, en vivo).
const DATA_SOURCE = "json";

// Usado cuando DATA_SOURCE = "json". Se regenera cada mes con el script.
const JSON_URL = "./agencias.json";

// Usado cuando DATA_SOURCE = "sheets". Pega aquí la URL de "Archivo > Compartir >
// Publicar en la web" de tu Google Sheet, eligiendo formato CSV para la hoja de agencias.
// Instrucciones completas al final de este archivo.
const SHEETS_CSV_URL = "";

// Backend (el mismo Code.gs / Apps Script del sistema de inventario — usa un token propio
// SHALOM_TOKEN que solo puede llamar a "registrarEnvioShalom", nada más). Cada registro se
// guarda en la hoja "Envios_Shalom" de tu Google Sheets.
const API_URL = "https://script.google.com/macros/s/AKfycby96q3BUEbRRjcs3_dcWTlOfgUMtK_7eKLEnHKnLIWnPtgHmg-nyf4dG5WDMJN7B5kblA/exec";
const SHALOM_API_TOKEN = "shl_7Wm2Qx9Nc4Vb0Rt6Zk3Ly8Ag5Sf1Dh_2026";

// Número de WhatsApp que recibe el mensaje (formato: código de país + número, sin "+" ni espacios).
const WHATSAPP_NUMBER = "51906745999";

// =========================================================
// ESTADO
// =========================================================

let AGENCIAS = [];
let AGENCIA_SELECCIONADA = null;

// =========================================================
// CARGA DE DATOS (JSON local o Google Sheets publicado como CSV)
// =========================================================

async function cargarAgencias() {
  if (DATA_SOURCE === "sheets" && SHEETS_CSV_URL) {
    const sep = SHEETS_CSV_URL.includes("?") ? "&" : "?";
    const res = await fetch(SHEETS_CSV_URL + sep + "cachebust=" + Date.now());
    if (!res.ok) throw new Error("No se pudo leer el Google Sheet publicado.");
    const csvText = await res.text();
    return parsearAgenciasCsv(csvText);
  }

  const res = await fetch(JSON_URL + "?v=" + Date.now());
  if (!res.ok) throw new Error("No se pudo leer agencias.json.");
  return res.json();
}

// Parser CSV simple (soporta comillas y comas dentro de campos), sin librerías externas.
// Espera encabezados: ruta_agencia, distrito, direccion_completa, referencia (en cualquier orden).
function parsearAgenciasCsv(csvText) {
  const filas = parsearFilasCsv(csvText);
  if (!filas.length) return [];

  const encabezados = filas[0].map(h => normalizarTexto(h).replace(/\s+/g, "_"));
  const idx = {
    ruta_agencia: encabezados.indexOf("ruta_agencia"),
    distrito: encabezados.indexOf("distrito"),
    direccion_completa: encabezados.indexOf("direccion_completa"),
    referencia: encabezados.indexOf("referencia")
  };

  const agencias = [];
  for (let i = 1; i < filas.length; i++) {
    const f = filas[i];
    if (!f || !f.length) continue;
    const ruta = (idx.ruta_agencia >= 0 ? f[idx.ruta_agencia] : "").trim();
    if (!ruta) continue;
    agencias.push({
      ruta_agencia: ruta,
      distrito: (idx.distrito >= 0 ? f[idx.distrito] : "").trim(),
      direccion_completa: (idx.direccion_completa >= 0 ? f[idx.direccion_completa] : "").trim(),
      referencia: (idx.referencia >= 0 ? f[idx.referencia] : "").trim()
    });
  }
  return agencias;
}

function parsearFilasCsv(text) {
  const filas = [];
  let fila = [];
  let campo = "";
  let dentroComillas = false;

  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (dentroComillas) {
      if (c === '"' && text[i + 1] === '"') { campo += '"'; i++; }
      else if (c === '"') { dentroComillas = false; }
      else { campo += c; }
    } else {
      if (c === '"') dentroComillas = true;
      else if (c === ",") { fila.push(campo); campo = ""; }
      else if (c === "\n") { fila.push(campo); filas.push(fila); fila = []; campo = ""; }
      else if (c === "\r") { /* ignorar */ }
      else campo += c;
    }
  }
  if (campo.length || fila.length) { fila.push(campo); filas.push(fila); }
  return filas.filter(f => f.some(v => String(v).trim() !== ""));
}

// =========================================================
// BUSCADOR INTELIGENTE (sin tildes, sin mayúsculas, por fragmentos)
// =========================================================

function normalizarTexto(str) {
  return String(str || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();
}

function buscarAgencias(query) {
  const tokens = normalizarTexto(query).split(/\s+/).filter(Boolean);
  if (!tokens.length) return [];

  return AGENCIAS
    .filter(a => {
      const pajar = normalizarTexto(a.ruta_agencia + " " + a.distrito);
      return tokens.every(t => pajar.includes(t));
    })
    .slice(0, 40);
}

function renderSugerencias(lista) {
  const wrap = document.getElementById("sugerencias");

  if (!lista.length) {
    wrap.innerHTML = '<div class="suggestion-empty">Sin resultados. Prueba con otro distrito o nombre.</div>';
    wrap.classList.remove("hidden");
    return;
  }

  wrap.innerHTML = lista.map((a, i) => `
    <div class="suggestion-item" data-idx="${i}">
      <div class="suggestion-ruta">${escaparHtml(a.ruta_agencia)}</div>
      <div class="suggestion-distrito">${escaparHtml(a.distrito)}</div>
      <div class="suggestion-detail"><span>Dirección:</span> ${escaparHtml(a.direccion_completa)}</div>
      <div class="suggestion-detail"><span>Referencia:</span> ${escaparHtml(a.referencia)}</div>
    </div>
  `).join("");
  wrap.classList.remove("hidden");

  wrap.querySelectorAll(".suggestion-item").forEach(el => {
    el.addEventListener("click", () => {
      const agencia = lista[Number(el.dataset.idx)];
      seleccionarAgencia(agencia);
    });
  });
}

function escaparHtml(s) {
  return String(s).replace(/[&<>"']/g, m => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;" }[m]));
}

function seleccionarAgencia(agencia) {
  AGENCIA_SELECCIONADA = agencia;

  document.getElementById("buscadorAgencia").value = agencia.ruta_agencia;
  document.getElementById("sugerencias").classList.add("hidden");
  document.getElementById("errAgencia").classList.add("hidden");

  document.getElementById("agRuta").textContent = agencia.ruta_agencia;
  document.getElementById("agDireccion").textContent = agencia.direccion_completa;
  document.getElementById("agReferencia").textContent = agencia.referencia;
  document.getElementById("agenciaCard").classList.remove("hidden");
}

function limpiarSeleccionAgencia() {
  AGENCIA_SELECCIONADA = null;
  document.getElementById("agenciaCard").classList.add("hidden");
  document.getElementById("buscadorAgencia").value = "";
  document.getElementById("buscadorAgencia").focus();
}

// =========================================================
// FECHA/HORA EN ZONA HORARIA DE LIMA
// =========================================================

function ahoraLimaTexto() {
  return new Intl.DateTimeFormat("es-PE", {
    timeZone: "America/Lima",
    day: "2-digit", month: "2-digit", year: "numeric",
    hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: true
  }).format(new Date());
}

// =========================================================
// ENVÍO: guardar en Google Sheets (webhook) + abrir WhatsApp
// =========================================================

function construirMensajeWhatsapp(datos) {
  return `📦 NUEVO ENVÍO (AGENCIA)

👤 ${datos.nombre}
📱 ${datos.telefono}
🆔 DNI: ${datos.dni}
🏢 Agencia: ${datos.ruta_agencia}
📍 ${datos.direccion_completa}, Ref. ${datos.referencia}

🛍️ Prendas compradas: ${datos.cantidad}
📅 Registro: ${datos.fecha_hora}

🚚 Shalom`;
}

async function guardarEnServidor(datos) {
  // Se usa GET con el payload en la URL (en vez de POST con body JSON) porque Apps Script
  // hace una redirección (302) al ejecutar un Web App, y esa redirección puede perder el
  // body de un POST — el mismo problema ya resuelto en Index.html/pedido.html.
  const payloadStr = encodeURIComponent(JSON.stringify(datos));
  const qs = `?action=registrarEnvioShalom&token=${SHALOM_API_TOKEN}&payload=${payloadStr}`;

  const res = await fetch(API_URL + qs);
  const json = await res.json();
  if (!json.ok) throw new Error(json.error || "El servidor rechazó el registro.");
}

function abrirWhatsapp(mensaje) {
  // Se usa api.whatsapp.com (el dominio oficial de Meta) en vez de wa.me: wa.me es un
  // acortador que primero redirige a api.whatsapp.com, y ese salto extra es un punto
  // común de falla (ERR_QUIC_PROTOCOL_ERROR, timeouts) en redes con QUIC/HTTP3 bloqueado
  // o inestable. Yendo directo a api.whatsapp.com se evita ese salto.
  const url = `https://api.whatsapp.com/send?phone=${WHATSAPP_NUMBER}&text=${encodeURIComponent(mensaje)}`;
  window.open(url, "_blank");
}

// =========================================================
// VALIDACIÓN Y ENVÍO DEL FORMULARIO
// =========================================================

function mostrarError(id, mostrar) {
  const el = document.getElementById(id);
  if (el) el.classList.toggle("hidden", !mostrar);
}

function validarFormulario() {
  const nombre = document.getElementById("nombre").value.trim();
  const telefonoDigitos = document.getElementById("telefono").value.replace(/\D/g, "");
  const dni = document.getElementById("dni").value.trim();
  const cantidad = Number(document.getElementById("cantidad").value);

  let valido = true;

  // Celular peruano = 9 dígitos exactos (el "+51" ya está fijo en la interfaz, no se pide).
  const telefonoValido = telefonoDigitos.length === 9;

  // DNI peruano = 8 dígitos exactos. El campo también acepta CE (carné de extranjería),
  // que no siempre es solo numérico, así que la regla de 8 dígitos solo aplica cuando
  // el valor ingresado es puramente numérico.
  const dniSoloDigitos = /^\d+$/.test(dni);
  const dniValido = dni !== "" && (dniSoloDigitos ? dni.length === 8 : dni.length >= 6);

  if (!nombre) { mostrarError("errNombre", true); valido = false; } else mostrarError("errNombre", false);
  if (!telefonoValido) { mostrarError("errTelefono", true); valido = false; } else mostrarError("errTelefono", false);
  if (!dniValido) { mostrarError("errDni", true); valido = false; } else mostrarError("errDni", false);
  if (!isFinite(cantidad) || cantidad < 1) { mostrarError("errCantidad", true); valido = false; } else mostrarError("errCantidad", false);
  if (!AGENCIA_SELECCIONADA) { mostrarError("errAgencia", true); valido = false; } else mostrarError("errAgencia", false);

  return valido ? { nombre, telefono: "+51 " + telefonoDigitos, dni, cantidad } : null;
}

function mostrarMensajeForm(tipo, texto) {
  const el = document.getElementById("formMsg");
  el.className = "form-msg " + tipo;
  el.textContent = texto;
  el.classList.remove("hidden");
}

async function manejarSubmit(evento) {
  evento.preventDefault();

  const datosCliente = validarFormulario();
  if (!datosCliente) {
    mostrarMensajeForm("bad", "Revisa los campos marcados en rojo antes de continuar.");
    return;
  }

  const datos = {
    nombre: datosCliente.nombre,
    telefono: datosCliente.telefono,
    dni: datosCliente.dni,
    cantidad: datosCliente.cantidad,
    ruta_agencia: AGENCIA_SELECCIONADA.ruta_agencia,
    distrito: AGENCIA_SELECCIONADA.distrito,
    direccion_completa: AGENCIA_SELECCIONADA.direccion_completa,
    referencia: AGENCIA_SELECCIONADA.referencia,
    fecha_hora: ahoraLimaTexto(),
    fecha_hora_iso: new Date().toISOString()
  };

  const btn = document.getElementById("btnEnviar");
  const btnTxt = document.getElementById("btnEnviarTxt");
  btn.disabled = true;
  btnTxt.textContent = "Guardando…";

  try {
    await guardarEnServidor(datos);
    mostrarMensajeForm("ok", "Registro guardado en Sheets. Abriendo WhatsApp…");
  } catch (err) {
    console.error("Error guardando en Sheets:", err);
    mostrarMensajeForm("bad", "No se pudo guardar en Sheets, pero igual se abrirá WhatsApp. Avisa al negocio si esto se repite.");
  }

  abrirWhatsapp(construirMensajeWhatsapp(datos));

  btn.disabled = false;
  btnTxt.textContent = "📲 Confirmar y enviar por WhatsApp";
  document.getElementById("envioForm").reset();
  limpiarSeleccionAgencia();
  document.getElementById("agenciaCard").classList.add("hidden");
}

// =========================================================
// INICIALIZACIÓN
// =========================================================

function initTelefono() {
  const input = document.getElementById("telefono");
  input.addEventListener("input", () => {
    input.value = input.value.replace(/\D/g, "").slice(0, 9);
  });
}

function initBuscador() {
  const input = document.getElementById("buscadorAgencia");
  const wrap = document.getElementById("sugerencias");

  input.addEventListener("input", () => {
    AGENCIA_SELECCIONADA = null;
    document.getElementById("agenciaCard").classList.add("hidden");
    const q = input.value.trim();
    if (!q) { wrap.classList.add("hidden"); return; }
    renderSugerencias(buscarAgencias(q));
  });

  input.addEventListener("focus", () => {
    const q = input.value.trim();
    if (q && !AGENCIA_SELECCIONADA) renderSugerencias(buscarAgencias(q));
  });

  document.addEventListener("click", e => {
    if (!wrap.contains(e.target) && e.target !== input) wrap.classList.add("hidden");
  });

  document.getElementById("btnCambiarAgencia").addEventListener("click", limpiarSeleccionAgencia);
}

async function init() {
  try {
    AGENCIAS = await cargarAgencias();
  } catch (err) {
    console.error(err);
    mostrarMensajeForm("bad", "No se pudieron cargar las agencias. Recarga la página o avisa al negocio.");
    return;
  }

  initTelefono();
  initBuscador();
  document.getElementById("envioForm").addEventListener("submit", manejarSubmit);
}

document.addEventListener("DOMContentLoaded", init);

// =========================================================
// GOOGLE SHEETS EN VIVO (alternativa a agencias.json)
// =========================================================
// 1. Sube el Excel del mes a una hoja de Google Sheets (o pégalo directo).
//    La hoja debe tener encabezados: ruta_agencia, distrito, direccion_completa, referencia
//    (en cualquier orden; mayúsculas/minúsculas no importan).
// 2. Archivo > Compartir > Publicar en la web.
// 3. En "Vincular", elige la hoja con las agencias. En el segundo desplegable, elige "Valores separados por comas (.csv)".
// 4. Marca "Volver a publicar automáticamente cuando se realicen cambios" para que se actualice solo.
// 5. Clic en "Publicar" y copia la URL que te da Google.
// 6. Pega esa URL en SHEETS_CSV_URL (arriba de este archivo) y cambia DATA_SOURCE a "sheets".
// A partir de ahí, cada vez que edites esa hoja de Google Sheets, el formulario se actualiza solo
// (puede demorar unos minutos en reflejar el cambio por el caché de Google).
