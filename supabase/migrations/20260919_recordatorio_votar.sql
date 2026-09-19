-- ════════════════════════════════════════════════════════════════════════════
-- Recordatorio de votación: "te faltan tus votos, tienes hasta esta noche".
--
-- La ventana de votación es más corta de lo que parece. Las evaluaciones abren
-- al cerrar el partido (~1 h después del pito) y el cron las cierra cuando la
-- fecha del partido queda dos días atrás — o sea en el primer tic de las 00:00
-- del día D+2. Para un partido del martes: abren martes ~8 PM y cierran jueves
-- a medianoche. En la práctica se vota "hasta que se acabe el miércoles", y eso
-- no está escrito en ninguna parte ni se ve en la app.
--
-- El recordatorio sale a las 7 PM del día siguiente al partido, solo a los
-- confirmados que todavía no han entregado su evaluación.
--
-- La bandera existe porque el cron corre cada minuto: sin ella el aviso saldría
-- una vez por minuto durante toda la noche. Mismo patrón que
-- notif_apertura_sent, notif_cupos_sent y notif_dia_antes_sent.
-- ════════════════════════════════════════════════════════════════════════════

ALTER TABLE public.partidos
  ADD COLUMN IF NOT EXISTS notif_votar_sent boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.partidos.notif_votar_sent IS
  'El recordatorio de votación de este partido ya salió. Evita que el cron, que corre cada minuto, lo repita.';

-- Los partidos que ya pasaron no deben recibir el recordatorio de forma
-- retroactiva cuando esto se despliegue.
UPDATE public.partidos
SET notif_votar_sent = true
WHERE fecha < (now() AT TIME ZONE 'America/Bogota')::date;

-- Comprobar: la columna existe y el histórico queda marcado.
SELECT count(*) FILTER (WHERE notif_votar_sent) AS ya_marcados,
       count(*)                                  AS total
FROM public.partidos;
