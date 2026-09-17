-- ════════════════════════════════════════════════════════════════════════════
-- "No aplica" es una respuesta, no un silencio.
--
-- La pantalla de evaluación ya tenía el botón "No aplica", pero el cliente
-- filtraba esas categorías antes de enviar: no llegaba nada al servidor. Una
-- categoría donde los 14 dijeron "no aplica" se veía idéntica a una donde nadie
-- la miró, y un jugador que se abstuvo en todo y no puso pulgares recibía
-- "No hay evaluaciones válidas" — no podía enviar su evaluación.
--
-- Una abstención ahora es una fila con votado_id NULL. Cuenta como votante del
-- partido (sí participó) y no cuenta para ningún jugador en el conteo.
--
-- El UNIQUE (partido_id, votante_id, categoria) sigue aplicando: una sola
-- respuesta por categoría, sea voto o abstención.
-- ════════════════════════════════════════════════════════════════════════════

ALTER TABLE public.votos_reconocimiento
  ALTER COLUMN votado_id DROP NOT NULL;
