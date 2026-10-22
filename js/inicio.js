// Portada: entrar con el código que se ve en la pantalla.
const form = document.getElementById('form');
const campo = document.getElementById('codigo');

campo.addEventListener('input', () => {
  const limpio = campo.value.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '');
  if (limpio !== campo.value) campo.value = limpio;
});

form.addEventListener('submit', (e) => {
  e.preventDefault();
  const codigo = campo.value.trim().replace(/^-+|-+$/g, '');
  if (codigo) location.href = `/${encodeURIComponent(codigo)}`;
});
