# Cómo instalar el backend (Supabase) — guía paso a paso

Esta guía está pensada para alguien **sin experiencia técnica**. Si en algún paso te
atoras, cada sección tiene un apartado de "Si algo sale mal" con la solución más común
(son problemas reales que ya pasaron durante una instalación real).

No necesitas saber programar. Sí necesitas una cuenta gratuita de
[supabase.com](https://supabase.com) y unos 15-20 minutos.

## Antes de empezar: 3 cosas que vas a manejar

| Cosa | Qué es | ¿La comparto con alguien? |
|---|---|---|
| **anon key** (clave pública) | Permite que la app hable con tu base de datos, respetando los permisos de cada usuario. | Va en el `.env` de la app. No es secreta, pero tampoco la publiques sin necesidad. |
| **service_role key** (clave secreta) | Salta todos los permisos — acceso total a la base de datos. | **Nunca**. No la pongas en la app, no la compartas en un chat, solo se usa una vez en scripts de servidor. |
| **contraseña de tu usuario admin** | Con la que entras a la app cada día. | Solo tú. Guárdala en un gestor de contraseñas. |

## Paso 1 — Crea el proyecto en Supabase

1. Entra a [supabase.com/dashboard](https://supabase.com/dashboard) e inicia sesión (o
   crea una cuenta).
2. Clic en **"+ New project"**.
3. Ponle un nombre (por ejemplo, el nombre de tu negocio), elige una **contraseña de
   base de datos** fuerte (guárdala, es distinta a la contraseña con la que vas a entrar
   a la app todos los días) y una región cercana a tus clientes.
4. Espera 1-2 minutos a que termine de crearse.

## Paso 2 — Instala la base de datos (un solo archivo)

1. En el menú de la izquierda, entra a **SQL Editor**.
2. Clic en **"+ New query"** (consulta nueva, en blanco).
3. Abre el archivo [`supabase/install/01_install.sql`](install/01_install.sql) de este
   proyecto, copia **todo** su contenido, y pégalo en el cuadro del SQL Editor.
4. Clic en **Run** (o Ctrl/Cmd + Enter).
5. Debe terminar con **"Success. No rows returned"** — así se ve cuando todo salió bien
   (es un instalador, no una consulta que regresa datos, por eso no "devuelve filas").

Este mismo archivo es **seguro de volver a correr** las veces que haga falta sobre la
misma base de datos (por ejemplo, si actualizas el sistema más adelante) — no borra
información existente.

**Si algo sale mal:** copia el mensaje de error completo y pide ayuda con ese mensaje
exacto — casi siempre dice justo qué línea falló.

## Paso 3 — Crea tu usuario administrador

1. En el menú de la izquierda, entra a **Authentication → Users**.
2. Clic en **"Add user"** → **"Create new user"**.
3. Llena **correo** y **contraseña** (usa tu correo real y una contraseña fuerte que
   vayas a recordar — esta sí es con la que vas a entrar a la app todos los días).
   Marca la opción de **"Auto Confirm User"** si aparece, para no tener que confirmar
   por correo.
4. Guarda.

## Paso 4 — Vuélvete Super Admin de la plataforma

Crear el usuario en Authentication no te da permisos todavía — ese es un paso aparte.
Además, por seguridad, el sistema **solo** da permisos de Super Admin a una cuenta que
tú hayas creado o marcado como tuya: si el registro público de Supabase seguía abierto,
alguien pudo registrarse antes con tu correo y quedarse con su propia contraseña.

1. Regresa a **SQL Editor → "+ New query"** (una consulta nueva, no reutilices la del
   Paso 2).
2. Revisa que la cuenta la acabas de crear tú (debe aparecer con fecha de hace unos
   minutos, no de antes):
   ```sql
   select id, email, created_at, last_sign_in_at
   from auth.users where lower(email) = lower('tu-correo-real@ejemplo.com');
   ```
   Si la fecha es anterior a cuando hiciste el Paso 3, **no es tuya**: bórrala en
   Authentication → Users y repite el Paso 3.
3. Márcala como tuya y conviértela en Super Admin (cambia el correo en las dos líneas):
   ```sql
   update auth.users
   set raw_app_meta_data = raw_app_meta_data || '{"owner_bootstrap": true}'::jsonb
   where lower(email) = lower('tu-correo-real@ejemplo.com');

   select public.bootstrap_owner_profile('tu-correo-real@ejemplo.com');
   ```
4. Debe decir "Success" de nuevo.

Alternativa por terminal: `scripts/create-owner-user.mjs` crea la cuenta ya marcada. Si el
correo ya existía, el script se detiene y te explica qué hacer (ver el encabezado del
script).

## Paso 5 — Conecta la app a tu proyecto

La app necesita dos datos de tu proyecto para saber a quién conectarse:

1. En Supabase, ve a **Settings → API**.
2. Copia el **Project URL** — es la URL corta, algo como
   `https://xxxxxxxxxxxx.supabase.co` (⚠️ **no** la que termina en `/rest/v1/`, esa es
   otra cosa).
3. Copia la clave marcada como **`anon` `public`** (un texto largo que empieza con
   `eyJ...`). **No** copies la de `service_role` para esto.
4. En la carpeta del proyecto, crea (o edita) un archivo llamado `.env` con este
   contenido:
   ```
   VITE_SUPABASE_URL=https://xxxxxxxxxxxx.supabase.co
   VITE_SUPABASE_ANON_KEY=eyJ...tu-clave-anon...
   ```
5. Instala dependencias y levanta la app:
   ```bash
   npm install
   npm run dev
   ```
6. Abre `http://localhost:3000/login` y entra con el correo/contraseña del Paso 3.

## Paso 6 (opcional, más técnico) — Edge Functions

Sin este paso, el sistema **ya funciona completo para el día a día** (vender, comprar,
inventario, caja, reportes). Estas funciones solo se necesitan para dos cosas puntuales:
que el Super Admin pueda **crear una empresa nueva desde el panel** `/admin`, y que un
dueño de tienda pueda **invitar usuarios** desde `/usuarios` sin pasar por el SQL Editor.
Puedes saltarte este paso e instalarlo después, cuando lo necesites.

Requiere instalar la [CLI de Supabase](https://supabase.com/docs/guides/cli):

```bash
supabase login
supabase link --project-ref xxxxxxxxxxxx   # tu project ref, está en la URL del proyecto
supabase functions deploy admin-create-company
supabase functions deploy team-create-user
supabase functions deploy team-manage-user
```

## Problemas comunes

**"Failed to send password recovery... email rate limit exceeded"**
El correo gratuito de Supabase permite muy pocos envíos por hora. Espera 30-60 minutos
y usa el botón de recuperación **una sola vez** (repetirlo agota el límite más rápido).

**El enlace de recuperación de contraseña dice "invalid or has expired"**
Estos enlaces caducan en minutos. Ábrelo apenas llegue, sin dejarlo esperando en la
bandeja de entrada.

**Se me olvidó la contraseña y no puedo entrar de ninguna forma**
La manera más confiable (sin depender de correos) es correr, **en tu propia Terminal**
(no en ningún chat), desde la carpeta del proyecto:
```bash
SUPABASE_URL="https://xxxxxxxxxxxx.supabase.co" \
SUPABASE_SERVICE_ROLE_KEY="tu_service_role_key" \
OWNER_EMAIL="tu-correo-real@ejemplo.com" \
OWNER_PASSWORD="LaContraseñaNuevaQueElijas" \
RESET_OWNER_PASSWORD=true \
node scripts/create-owner-user.mjs
```
La `service_role key` está en **Settings → API** (la marcada "secret"). Este comando la
usa solo en tu máquina, un momento — no la compartas con nadie más.

**Ya tengo sesión iniciada pero no recuerdo mi contraseña para el futuro**
Ve a **Mi Perfil** dentro de la app y cámbiala ahí directamente, sin necesitar correo.

## Importante

- **NO ejecutes `docs/legacy-migrations/`** (antes `supabase/migrations/`). Es solo el historial de
  desarrollo y contiene definiciones viejas y más débiles. El único instalador es
  `install/01_install.sql`. Si por error se aplicó, vuelve a correr el instalador completo.
- `config.toml` es la configuración del proyecto Supabase (sin secretos).
- Si el sitio queda público, desactiva también el registro nuevo en **Authentication →
  Providers** si no quieres que cualquiera pueda crear una cuenta.
