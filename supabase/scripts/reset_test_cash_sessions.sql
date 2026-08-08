-- Limpia las cajas de PRUEBA que quedaron abiertas con conteos
-- equivocados, para volver a abrirlas y probar el arqueo desde cero.
--
-- Qué borra: solo sesiones de caja con status = 'open' (las cerradas y
-- autorizadas NO se tocan). Al borrar la fila de cash_sessions, sus
-- movimientos (cash_movements) y conteos (till_counts / till_count_lines)
-- se borran solos en cascada -- no hace falta borrarlos aparte.
-- Qué NO borra: ventas (sales), stock, ni nada del catálogo.
--
-- Corre esto en el SQL Editor de tu proyecto de Supabase.

delete from public.cash_sessions
where status = 'open'
  and is_demo_data = false;
