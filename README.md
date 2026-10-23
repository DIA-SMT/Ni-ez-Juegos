# Quizzes en vivo · Municipalidad de San Miguel de Tucumán

Encuestas y quizzes tipo Mentimeter/Kahoot con la estética del municipio. El
público entra escaneando un QR desde el celular; la pantalla proyectada muestra
los resultados en vivo. Pensado para ~300 chicos a la vez.

| Ruta | Para quién | Qué hace |
|---|---|---|
| `/` | Público | Entrar escribiendo el código |
| `/<codigo>` | Público (QR) | Responder, una pregunta por pantalla |
| `/presentar/<codigo>` | Equipo (proyector) | **Todo desde acá**: QR siempre a la vista, botón Empezar/Siguiente y resultados en vivo |
| `/control/<codigo>` | Equipo (celular, opcional) | Botonera: lo mismo que los botones de la pantalla, desde el celular |
| `/panel` | Equipo | Crear, editar, duplicar, abrir/cerrar, exportar CSV |

## Dos modos

- **Encuesta**: anónima, sin puntaje. Para temas sensibles (por ejemplo, *Romper el Silencio*).
  Puede mostrar una caja «¿Necesitás ayuda ahora?» con teléfonos.
- **Quiz con puntaje**: apodo (con dado de apodos de fauna argentina), respuestas correctas,
  devolución al instante, rachas 🔥 (100 pts por acierto, +25 por cada acierto seguido),
  ranking y podio. El puntaje lo recalcula la base: no se puede inflar desde el navegador.

Tipos de pregunta: opción única, opción múltiple (con «Otro» y opción exclusiva),
escala 1 a 5 con emojis, nube de palabras y texto libre.

## Ritmo: guiado o libre

- **Guiado** (por defecto, como Mentimeter/Kahoot): los chicos escanean el QR y quedan en una
  sala de espera. Cada pregunta aparece en los celulares cuando el presentador la activa
  (pasando de placa en la pantalla o con la **botonera** del celular). En el quiz, la respuesta
  queda enviada y cuando se toca **Mostrar la correcta** a cada uno le llega si acertó, con sus
  puntos y su racha; mientras tanto, la pantalla muestra solo cuántos respondieron.
- **Libre**: cada uno responde de corrido, a su ritmo.

La **botonera** copia la de la presentación del CIMT: ACCIÓN en amarillo cuando toca hacer
algo, SIGUIENTE gigante y borde verde/rojo según si la pantalla recibió el toque. Se abre
desde la pantalla de presentar con la tecla `B` (muestra un QR) o desde el panel.
Pantalla y botonera quedan sincronizadas: se puede usar cualquiera de las dos.

Los celulares preguntan el estado cada ~3 segundos (sin conexiones abiertas): el plan gratis
de Supabase corta Realtime en 200 conexiones y acá son ~300 chicos.

## Datos de contacto

Cada quiz puede pedir **nombre y teléfono** en la primera pantalla (No pedir / Opcional /
Obligatorio, en el editor). Se guardan **aparte** de las respuestas, sin nada que los una
(ni el participante, ni la hora: solo el día), así las respuestas siguen siendo anónimas.
Se descargan en CSV desde el panel o desde el menú de la pantalla de presentar, con la clave
del equipo. «Borrar respuestas» también borra los contactos.

## Moderación en pantalla

Con 300 chicos, todo lo que escriben arranca **tapado** en la pantalla proyectada:
texto libre, nube de palabras y «Otro» se muestran recién al tocar **Mostrar** (tecla `R`).
Cualquier respuesta, palabra o apodo se oculta tocándolo. Los apodos con malas palabras
se reemplazan solos por un animal.

Atajos del presentador: `←` `→` (o el control de diapositivas), `1`–`9`, `Q` (QR),
`R` (mostrar respuestas), `C` (mostrar la correcta), `B` (botonera), `F` (pantalla completa).

## Puesta en marcha

1. **Base de datos**: en Supabase → SQL Editor, correr en orden los archivos de
   `supabase/migrations/`. Crean todo y cargan las dos encuestas de Niñez (`consumos` y `silencio`).
2. **Conexión**: en `js/config.js` poner la URL del proyecto y la clave *publishable*
   (o *anon*). Son públicas por diseño: solo permiten leer un quiz y mandar respuestas.
3. **Deploy**: es un sitio estático, sin build (rutas en `vercel.json`). Está publicado en
   https://ninez-juegos.vercel.app (proyecto `ninez-juegos` de la cuenta direccionia en Vercel).
   Para publicar cambios: `npx vercel deploy --prod` desde esta carpeta.

La **clave del equipo** (para `/panel` y `/presentar`) no está en el repo: en la base
solo se guarda su huella. Para cambiarla, en el SQL Editor:

```sql
insert into privado.claves (hash) values (sha256(convert_to('NUEVA-CLAVE', 'UTF8')));
delete from privado.claves where hash <> sha256(convert_to('NUEVA-CLAVE', 'UTF8'));
```

## Desarrollo

```bash
node dev.mjs
```

Abre en http://localhost:5180 contra la base real. Con `MODO_LOCAL=1 node dev.mjs` funciona
en **modo local** (todo se guarda en el navegador, cualquier clave entra): para probar sin tocar datos.

Sin dependencias ni build: HTML, CSS y JavaScript. El QR usa
[qrcode-generator](https://github.com/kazuhikoarase/qrcode-generator) (MIT) en `js/vendor`.
