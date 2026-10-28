# Historial de migraciones (SOLO LECTURA)

Estos archivos son el historial de desarrollo anterior a `supabase/install/01_install.sql`.
**No se aplican nunca**: contienen definiciones viejas y más débiles (helpers de aislamiento
entre empresas, políticas de escritura directa sobre ventas y caja, `GRANT DELETE`, la
versión antigua de `create_sale`, promociones a cuentas por correo...) que el instalador
ya reemplazó.

Viven aquí, fuera de `supabase/migrations/`, para que `supabase db push`, una rama de
vista previa o una sincronización de Lovable NO los encuentren y los apliquen sobre la
base real (una prueba, `tests/no-legacy-migrations.test.ts`, falla si vuelve a aparecer
una carpeta `supabase/migrations/` con archivos `.sql`).

Si por error se aplicaron, vuelve a correr `supabase/install/01_install.sql` completo: repara
funciones, políticas, permisos y sobrecargas (no deshace cambios de datos).
