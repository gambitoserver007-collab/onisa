# Onisa — POS SaaS multiempresa

Frontend TanStack/Vite conectado a Supabase Auth y Postgres para un sistema multiempresa de POS,
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

El instalador **no** crea ninguna cuenta de administrador por sí solo — eso es un paso aparte,
explicado con detalle en [`supabase/README_SUPABASE.md`](supabase/README_SUPABASE.md):

1. Crea el usuario en **Supabase → Authentication → Users**, con tu correo y contraseña reales.
2. En el SQL Editor, corre `select public.bootstrap_owner_profile('tu-correo@ejemplo.com');`
   para darle permisos de Super Admin de plataforma.

No hay contraseña "de fábrica" que cambiar después — desde el paso 1 ya usas tu contraseña real.

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

## Facturación electrónica: qué SÍ y qué NO hace este sistema

**Los "tipos de comprobante" (Boleta, Factura, Ticket, Nota de venta, etc.) son solo etiquetas
internas para tus propios registros de venta.** El sistema:

- ✅ Sí registra qué tipo de comprobante eligió el cajero, y si ese tipo carga IVA o no.
- ✅ Sí calcula el IVA/impuesto correspondiente según el país de la tienda.
- ❌ **No** genera folio fiscal, **no** timbra, **no** se conecta ni envía nada a ninguna
  autoridad fiscal (SAT, DIAN, SUNAT, DGI u otra).

Si tu negocio (o un cliente al que le revendas el sistema) necesita facturación electrónica
certificada para cumplir con la ley de su país, van a necesitar contratar un proveedor de
facturación electrónica aparte (un PAC, en el caso de México) — este sistema no lo reemplaza.
Este mismo aviso también aparece dentro de la app, en **Administración → Países / Impuestos**.

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

Ya resuelto (auditoría 2026-07): escritura directa vía API en tablas transaccionales, precio
manipulable en devoluciones, costo desactualizado tras una compra, idempotencia de `create_sale`,
bloqueo real por suscripción suspendida/vencida, límites de plan, vencimiento automático de
periodo de prueba, checklist de onboarding, instalador idempotente (re-ejecutable sin errores) y
verificado en un Supabase limpio.

Sigue pendiente:

- Regenerar tipos con `supabase gen types typescript` si cambia la base.
- Desactivar registro público también en Supabase Auth si el sitio queda público.
- Desplegar las Edge Functions (`supabase/functions/`) si vas a usar "crear empresa desde
  /admin" o "invitar usuarios desde /usuarios" — sin ellas, el resto del sistema funciona igual.
- Sumar pruebas automatizadas (hoy no hay ninguna) — ver recomendación de prioridades en la
  auditoría.
- Reforzar reglas del Modo de Prueba también en cualquier endpoint/backend futuro.
