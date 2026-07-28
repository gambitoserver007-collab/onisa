# Carpeta `supabase/` — backend del proyecto

## Para montar el backend, ejecuta UN SOLO archivo

```
install/01_install.sql
```

Ese archivo crea **TODO**: extensiones, tablas, relaciones, índices, funciones, triggers,
seguridad (RLS), RPC y los datos base (planes, ajustes de país). Es el **único** archivo de
instalación.

Después:

1. Despliega las **Edge Functions** que están en `functions/`.
2. Crea el usuario administrador en **Supabase Auth** y ejecuta en el SQL Editor:
   ```sql
   select public.bootstrap_owner_profile('superadmin@user.test');
   ```

## ⚠️ Importante

- **NO ejecutes la carpeta `migrations/`.** Es solo el historial de desarrollo. El único
  instalador es `install/01_install.sql`.
- `config.toml` es la configuración del proyecto Supabase (sin secretos).
