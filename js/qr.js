// Código QR en SVG (librería qrcode-generator, MIT, en js/vendor) con el
// isologo municipal al centro. Corrección de errores alta (H): el logo tapa
// menos del 5% de los módulos y el código se lee igual.
export function qrHtml(texto) {
  const qr = window.qrcode(0, 'H');
  qr.addData(texto);
  qr.make();
  const n = qr.getModuleCount();
  const m = 4; // zona silenciosa
  const t = n + m * 2;
  let d = '';
  for (let r = 0; r < n; r++) {
    for (let c = 0; c < n; c++) if (qr.isDark(r, c)) d += `M${c + m} ${r + m}h1v1h-1z`;
  }
  // Desde la versión 7 hay patrones de alineación en el centro: ahí no va logo.
  const logo = n < 45 ? '<span class="qr-logo"><img src="/img/isologo.png" alt=""></span>' : '';
  return `<span class="qr"><svg class="qr-svg" viewBox="0 0 ${t} ${t}" shape-rendering="crispEdges" role="img" aria-label="Código QR"><rect width="${t}" height="${t}" fill="#fff"/><path d="${d}" fill="#062B6B"/></svg>${logo}</span>`;
}
