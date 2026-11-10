# Froobie · Limpieza y calidad 🍦

Aplicación web para móvil que controla la limpieza, el mantenimiento y las incidencias de las máquinas de producción de helados.

- **Trabajadores**: se registran con usuario, contraseña y su Gmail, y eligen idioma (Deutsch / English / Español). Escanean el QR de la máquina, completan el checklist del día (los días de limpieza profunda, p. ej. el viernes, aparecen pasos extra), pueden reportar incidencias con foto y firman con el dedo.
- **Administrador** (`froobieadmin`): resumen del día, máquinas, códigos QR imprimibles, órdenes de limpieza traducidas, incidencias, mantenimiento/reparaciones/actualizaciones, usuarios e **informes PDF** (limpieza, cumplimiento, incidencias, mantenimiento) y exportación CSV.

## Stack (100 % gratuito)

| Parte | Tecnología | Dónde (gratis) |
|---|---|---|
| Frontend | React + Vite (PWA instalable) | servido por el propio backend |
| Backend | Node + Fastify + Prisma | **Render** (plan Free) |
| Base de datos | PostgreSQL | **Supabase** (plan Free) · SQLite en local |
| Fotos | Supabase Storage (bucket privado) | **Supabase** · disco local en desarrollo |
| PDF / QR | pdfkit · qrcode | — |

---

## 1. Ejecutar en local (tu Mac)

```bash
npm run install:all                 # instala dependencias
npm --prefix server run db:migrate  # crea la base de datos SQLite local
npm run db:seed                     # crea froobieadmin + Máquina Nº1
npm run dev                         # app en http://localhost:5173
```

La configuración local está en `server/.env` (plantilla en `server/.env.example`).

**Probar desde el móvil (misma WiFi):** abre `http://IP-DE-TU-MAC:5173`. `PUBLIC_URL` en `server/.env` debe apuntar a esa dirección, porque es la URL que va dentro de los QR.

Tests de la API: `npm test`.

## 2. Publicarla gratis (Supabase + Render)

### a) Supabase (base de datos y fotos)
1. Crea una cuenta en <https://supabase.com> → **New project** (región *Central EU – Frankfurt*). Guarda la contraseña de la base de datos.
2. **Connect** → *Connection string* → **Session pooler** → copia la URI (`postgresql://postgres.xxxx:[PASSWORD]@aws-0-eu-central-1.pooler.supabase.com:5432/postgres`) y sustituye `[PASSWORD]`. Esto es `DATABASE_URL`.
3. **Project Settings → API**: copia la *Project URL* (`SUPABASE_URL`) y la clave **service_role** (`SUPABASE_SERVICE_ROLE_KEY`). ⚠️ Esta clave es secreta: va solo en el servidor y nunca en el navegador.
4. No hace falta crear tablas ni el bucket: la app los crea al arrancar.

### b) Render (la aplicación)
1. Sube esta carpeta a un repositorio de GitHub (privado).
2. En <https://render.com> → **New → Blueprint** → elige el repositorio (usa `render.yaml`).
3. Rellena las variables que pide: `ADMIN_INITIAL_PASSWORD`, `DATABASE_URL`, `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`.
4. Al terminar tendrás una URL como `https://froobie.onrender.com`. En el primer arranque se crean automáticamente el administrador y la Máquina Nº1.
5. Entra como admin → **Administración → Máquinas → Nº1 → Etiqueta QR (PDF)**, imprímela y pégala en la máquina.

> Si más adelante usas un dominio propio, define `PUBLIC_URL` y regenera/reimprime los QR.

### Límites del plan gratuito
- **Render Free**: tras 15 min sin uso el servidor se duerme; el primer acceso tarda unos 30–60 s en despertar.
- **Supabase Free**: 500 MB de base de datos y 1 GB de fotos (más que suficiente). El proyecto se **pausa tras 7 días sin actividad**; con uso diario no pasa.
- Cuando el uso sea crítico, basta con subir a un plan de pago sin cambiar código.

## Seguridad
- Contraseñas con hash bcrypt; sesión en cookie `httpOnly`; límite de intentos en el login.
- Las fotos solo se ven con sesión iniciada; los QR usan tokens aleatorios (se pueden regenerar).
- **Cambia la contraseña del administrador** tras el primer inicio de sesión (Perfil → Cambiar contraseña).

## Estructura
```
server/   API Fastify, Prisma (prisma/schema.prisma), PDFs (src/pdf), tests (test/)
web/      App React (src/pages: Auth, Worker, Admin · src/i18n.ts: textos DE/EN/ES)
render.yaml  Despliegue en Render
```
