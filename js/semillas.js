// Los dos primeros quizzes, tal cual llegaron de Niñez. Se cargan en la base
// con la migración (supabase/migrations) y en el modo local del navegador.
// Desde el panel se editan como cualquier otro.

const AYUDA_SILENCIO = {
  texto: 'Si vos o alguien cercano necesita ayuda ahora, no esperes al encuentro ni a una respuesta de esta encuesta: recurrí a una persona adulta de confianza o a un servicio de salud.',
  lineas: [
    { numero: '911', detalle: 'Emergencias' },
    { numero: '0800 345 1435', detalle: 'Centro de Asistencia al Suicida · gratis, todo el país' },
  ],
};

export const SEMILLAS = [
  {
    codigo: 'consumos',
    def: {
      titulo: 'Abordaje de situaciones de riesgo y consumos problemáticos',
      etiqueta: 'Encuesta',
      subtitulo: '',
      intro: 'Queremos conocer tus dudas para orientar la capacitación. Te invitamos a responder estas breves preguntas.',
      modo: 'encuesta',
      ritmo: 'guiado',
      contacto: 'obligatorio',
      tema: 'azul',
      celebrar: true,
      cierre: { titulo: '¡Gracias por participar!', texto: 'Tus respuestas nos ayudan a armar una capacitación a la medida de tus dudas.' },
      ayuda: null,
      preguntas: [
        { id: 'p1', tipo: 'unica', texto: '¿Sabés reconocer cuándo una persona está atravesando una situación de riesgo relacionada con el consumo de alcohol u otras sustancias?', opciones: ['Sí', 'Más o menos', 'No'] },
        { id: 'p2', tipo: 'unica', texto: '¿Sabrías qué hacer si alguien cercano necesita ayuda por su consumo?', opciones: ['Sí', 'No', 'Tengo dudas'] },
        { id: 'p3', tipo: 'unica', texto: '¿Conocés algún lugar donde pedir orientación o ayuda?', opciones: ['Sí', 'No'] },
        { id: 'p4', tipo: 'unica', texto: '¿Qué te dificultaría ayudar a una persona en esa situación?', opciones: ['No saber cómo acercarme', 'Miedo a su reacción', 'No saber a quién recurrir'], otro: true },
        { id: 'p5', tipo: 'multiple', texto: '¿Qué te gustaría aprender en la capacitación?', opciones: ['Reconocer señales de alerta', 'Cómo hablar con alguien que necesita ayuda', 'Qué hacer ante una emergencia', 'Dónde buscar ayuda', 'Cómo acompañar a familiares y amigos'] },
        { id: 'p6', tipo: 'unica', texto: '¿Sabés diferenciar entre consumo problemático e intoxicación por drogas?', opciones: ['Sí, puedo distinguir ambas situaciones', 'Tengo algunas dudas sobre sus diferencias', 'No, no sé diferenciarlas', 'Me gustaría recibir más información sobre el tema'] },
        { id: 'p7', tipo: 'texto', texto: '¿Qué duda puntual sobre cómo actuar ante una situación de riesgo o consumo te gustaría resolver en esta capacitación?', placeholder: 'Escribí tu duda…' },
      ],
    },
  },
  {
    codigo: 'silencio',
    def: {
      titulo: 'Romper el Silencio',
      etiqueta: 'Encuesta para adolescentes y jóvenes',
      subtitulo: 'Salud mental y suicidio',
      intro: 'Queremos conocer tus dudas sobre la prevención del suicidio. La encuesta es anónima: no incluyas nombres ni experiencias personales. Podés dejar sin responder cualquier pregunta.',
      modo: 'encuesta',
      ritmo: 'guiado',
      contacto: 'obligatorio',
      tema: 'celeste',
      celebrar: false,
      cierre: { titulo: 'Gracias por participar', texto: 'Tu pregunta puede ayudar a otras personas a animarse a hablar.' },
      ayuda: AYUDA_SILENCIO,
      preguntas: [
        { id: 'p1', tipo: 'unica', texto: '¿Creés que hablar sobre el suicidio puede ayudar a prevenirlo?', opciones: ['Sí', 'No', 'No sé'] },
        { id: 'p2', tipo: 'unica', texto: '¿Sabés cuáles pueden ser las señales de alerta de que una persona está pensando en suicidarse?', opciones: ['Sí', 'Conozco algunas', 'No'] },
        { id: 'p3', tipo: 'unica', texto: 'Si un amigo o una amiga te dice que no quiere seguir viviendo, ¿sabrías qué hacer?', opciones: ['Sí', 'Tengo dudas', 'No'] },
        { id: 'p4', tipo: 'unica', texto: 'Si alguien te cuenta que está pensando en suicidarse y te pide que guardes el secreto, ¿qué harías?', opciones: ['Guardaría el secreto', 'Buscaría ayuda de una persona adulta de confianza o un profesional', 'No sabría qué hacer'] },
        { id: 'p5', tipo: 'multiple', texto: '¿Qué podría dificultar que pidas ayuda si vos o alguien cercano está pensando en suicidarse?', opciones: ['Miedo a que me juzguen', 'No saber con quién hablar', 'Vergüenza de contar lo que pasa', 'Pensar que no me van a tomar en serio', 'No tendría dificultad para pedir ayuda'], otro: true, exclusiva: 'No tendría dificultad para pedir ayuda' },
        { id: 'p6', tipo: 'unica', texto: '¿Sabés dónde acudir para recibir ayuda profesional ante una situación de riesgo de suicidio en San Miguel de Tucumán?', opciones: ['Sí', 'No', 'Tengo dudas'] },
        { id: 'p7', tipo: 'multiple', texto: '¿Qué te gustaría aprender sobre la prevención del suicidio?', opciones: ['Cómo reconocer señales de alerta', 'Qué decir y cómo escuchar a alguien que piensa en suicidarse', 'Qué hacer y a quién recurrir ante un riesgo inmediato', 'Cómo pedir ayuda si tengo pensamientos de suicidio', 'Qué mitos existen sobre el suicidio'] },
        { id: 'p8', tipo: 'texto', texto: '¿Qué duda puntual sobre el suicidio o cómo prevenirlo te gustaría que responda el especialista?', placeholder: 'Escribí tu pregunta…', nota: 'Sin nombres ni experiencias personales.' },
      ],
    },
  },
];
