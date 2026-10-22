# Quizzes en vivo · Municipalidad de San Miguel de Tucumán

Encuestas y quizzes tipo Mentimeter/Kahoot con la estética del municipio. El
público entra escaneando un QR desde el celular; la pantalla proyectada muestra
los resultados en vivo. Pensado para ~300 chicos a la vez.

| Ruta | Para quién | Qué hace |
|---|---|---|
| `/` | Público | Entrar escribiendo el código |
| `/<codigo>` | Público (QR) | Responder, una pregunta por pantalla |
| `/presentar/<codigo>` | Equipo (proyector) | QR gigante, sala de espera, resultados en vivo, podio |
| `/panel` | Equipo | Crear, editar, duplicar, abrir/cerrar, exportar CSV |

## Dos modos

- **Encuesta**: anónima, sin puntaje. Para temas sensibles (por ejemplo, *Romper el Silencio*).
  Puede mostrar una caja «¿Necesitás ayuda ahora?» con teléfonos.
- **Quiz con puntaje**: apodo (con dado de apodos de fauna argentina), respuestas correctas,
  devolución al instante, rachas 🔥 (100 pts por acierto, +25 por cada acierto seguido),
  ranking y podio. El puntaje lo recalcula la base: no se puede inflar desde el navegador.

Tipos de pregunta: opción única, opción múltiple (con «Otro» y opción exclusiva),
escala 1 a 5 con emojis, nube de palabras y texto libre.

## Moderación en pantalla

Con 300 chicos, todo lo que escriben arranca **tapado** en la pantalla proyectada:
texto libre, nube de palabras y «Otro» se muestran recién al tocar **Mostrar** (tecla `R`).
Cualquier respuesta, palabra o apodo se oculta tocándolo. Los apodos con malas palabras
se reemplazan solos por un animal.

Atajos del presentador: `←` `→` (o el control de diapositivas), `1`–`9`, `Q` (QR),
`R` (mostrar respuestas), `C` (mostrar la correcta), `F` (pantalla completa).

## Puesta en marcha

1. **Base de datos**: en Supabase → SQL Editor, pegar y correr
   `supabase/migrations/20261022180000_quizzes_en_vivo.sql`. Crea todo y carga las dos
   encuestas de Niñez (`consumos` y `silencio`).
2. **Conexión**: en `js/config.js` poner la URL del proyecto y la clave *publishable*
   (o *anon*). Son públicas por diseño: solo permiten leer un quiz y mandar respuestas.
3. **Deploy**: es un sitio estático, sin build. Vercel lo toma tal cual (rutas en `vercel.json`).

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

Abre en http://localhost:5180. Sin `js/config.js` completo funciona en **modo local**
(todo se guarda en el navegador, cualquier clave entra): sirve para probar, no para el público.

Sin dependencias ni build: HTML, CSS y JavaScript. El QR usa
[qrcode-generator](https://github.com/kazuhikoarase/qrcode-generator) (MIT) en `js/vendor`.
