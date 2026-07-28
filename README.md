# Tienda Agil SaaS

Frontend TanStack/Vite conectado a Supabase Auth y Postgres para un MVP multiempresa de POS,
inventario, ventas y reportes.

## Requisitos

- Bun o npm instalado.
- Proyecto Supabase conectado.
- Variables de entorno configuradas.

```bash
VITE_SUPABASE_URL=https://tu-proyecto.supabase.co
VITE_SUPABASE_ANON_KEY=tu_anon_key
```

Tambien se acepta `VITE_SUPABASE_PUBLISHABLE_KEY` como fallback.

No usar `service_role` en frontend.

## Instalacion

```bash
npm install
npm run dev
```

## Supabase Installer Kit

El proyecto incluye todo para instalar la base en un Supabase nuevo. Archivos del kit:

- `supabase/install/01_install.sql` — el ÚNICO instalador: crea todo (tablas, RPC, RLS, datos base y el admin).
- `supabase/functions/` — Edge Functions (crear usuarios y tiendas).
- `scripts/create-owner-user.mjs` y `scripts/verify-supabase-install.mjs`.

## Acceso

El registro publico esta deshabilitado por defecto en frontend. La pantalla `/register` queda
cerrada salvo que se active explicitamente:

```bash
VITE_ENABLE_PUBLIC_REGISTRATION=true
```

El acceso demo del login debe quedar oculto en una instalación real (recomendado):

```bash
VITE_SHOW_DEMO_ACCESS=false
```

Importante: si el sitio queda publico, desactiva tambien nuevos registros en Supabase Auth. No
dependas solo del frontend para bloquear registros.

## Cómo entrar (usuario administrador)

Al montar el backend en tu Supabase se crea la cuenta de administrador. Para entrar al sistema
usa estas credenciales:

```text
Usuario:     superadmin@user.test
Contraseña:  Demo1234
```

**Cambia el correo y la contraseña** desde tu perfil después del primer ingreso. La cuenta queda
como administrador (rol admin) — no es una cuenta de prueba.

## Base de datos

Instalador (un solo archivo):

```bash
supabase/install/01_install.sql
```

Aplícalo desde el SQL Editor de Supabase. No ejecutes la carpeta `migrations/` (es solo
historial de desarrollo).

La base crea tablas multiempresa, RLS, bloqueo de escrituras en Modo de Prueba, RPC `create_sale` y bootstrap del
administrador inicial.

## Modo de Prueba

El frontend detecta el Modo de Prueba desde `profiles.is_demo` y `profiles.demo_mode`. El email solo queda como
fallback defensivo si el perfil todavia no existe.

En Modo de Prueba se muestra:

```text
Estas usando el Modo de Prueba en modo lectura. Algunas acciones estan deshabilitadas.
```

Las acciones sensibles se bloquean con:

```text
Esta accion esta deshabilitada en el Modo de Prueba.
```

El bloqueo esta centralizado en `src/lib/demoMode.ts`, `src/hooks/useDemoSession.ts` y
`src/components/demo/DemoGuardedButton.tsx`. La base tambien bloquea escrituras en Modo de Prueba con RLS y
triggers.

## Modulos conectados

- Supabase Auth: login, registro opcional, logout y sesion persistente.
- Perfiles y empresa: `profiles` + `companies`.
- Configuracion de empresa: pais, moneda, impuesto y datos fiscales.
- Catalogos: categorias, productos, clientes, proveedores.
- POS: lectura de catalogo y RPC `create_sale`.
- Ventas: listado y detalle.
- Dashboard, inventario y reportes: metricas desde Supabase con fallback de prueba si la migracion aun no
  esta aplicada.

## Verificacion

```bash
npm run lint
npm run build
```

## Pendiente recomendado

- Probar el instalador en un Supabase limpio.
- Regenerar tipos con `supabase gen types typescript` si cambia la base.
- Desactivar registro publico tambien en Supabase Auth si el sitio queda publico.
- Conectar compras, caja, devoluciones, promociones, usuarios, suscripcion y admin SaaS a servicios
  reales.
- Reforzar reglas del Modo de Prueba tambien en cualquier endpoint/backend futuro.
