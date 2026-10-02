# Finanzas MF

Aplicación estática para registrar compras, cuotas y pagos. Se publica con **GitHub Pages** y persiste los datos en **Supabase**. Ya no usa Google Apps Script ni Google Sheets.

## Antes de publicar

1. En Supabase, abre **SQL Editor → New query**.
2. Copia y ejecuta por completo `supabase-setup.sql`. Esto crea las tablas, las reglas privadas de acceso (RLS) y la operación segura para registrar pagos.
3. En **Authentication → Providers → Email**, deja habilitado Email. Para simplificar el primer acceso puedes desactivar temporalmente `Confirm email`; si lo mantienes activado, el usuario debe confirmar el correo recibido.
4. En **Authentication → URL Configuration**, configura:
   - `Site URL`: `https://TU_USUARIO.github.io/Finanzas-MF/`
   - `Redirect URLs`: añade la misma dirección. Mientras pruebas localmente, añade también `http://localhost:5500/` si usas Live Server.
5. `config.js` ya usa el Project URL correcto (`https://bxoykyderhdupuhfzfdx.supabase.co`) y la **Publishable key**. Esta clave es pública por diseño; la seguridad de los datos depende de las reglas RLS instaladas en el paso 2. No agregues claves `sb_secret_`, `service_role` ni contraseñas al repositorio.

## Publicar en GitHub Pages

1. Crea el repositorio público `Finanzas-MF` en GitHub.
2. En esta carpeta, ejecuta en PowerShell (sustituye `TU_USUARIO`):

```powershell
git init
git add index.html app.js config.js supabase-setup.sql README.md
git commit -m "Crear Finanzas MF con Supabase"
git branch -M main
git remote add origin https://github.com/TU_USUARIO/Finanzas-MF.git
git push -u origin main
```

3. En GitHub abre **Settings → Pages** y selecciona `Deploy from a branch`, rama `main` y carpeta `/(root)`.
4. Espera la publicación y entra en `https://TU_USUARIO.github.io/Finanzas-MF/`.

## Uso

- Crea una cuenta con correo y contraseña de al menos ocho caracteres.
- Registra una compra. La inicial se descuenta del financiamiento antes de repartir la deuda.
- Registra cada abono indicando quién pagó. El saldo y el estado se actualizan de forma atómica en Supabase.
- Cada cuenta sólo puede leer sus propias compras y pagos.

## Archivos

- `index.html`: interfaz estática compatible con GitHub Pages.
- `app.js`: autenticación, validación, consultas y renderizado.
- `config.js`: URL del proyecto y clave publishable pública de Supabase.
- `supabase-setup.sql`: esquema, RLS y función transaccional de pagos.
