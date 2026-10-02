# Finanzas MF

Billetera web privada publicada con **GitHub Pages** y respaldada por **Supabase**. Permite registrar ingresos, egresos y compras Cashea personales o compartidas entre Anny y Danny. No usa Google Apps Script ni Google Sheets.

## Privacidad

- Los ingresos y egresos pertenecen exclusivamente a la cuenta que los creó.
- Una compra Cashea **Personal** sólo puede verla y abonarla su dueño.
- Una compra Cashea **Compartida** puede ser vista y abonada únicamente por estas dos cuentas:
  - Anny: `fontanamarianni@gmail.com`
  - Danny: `josedgonzalezm127@gmail.com`
- Las compras que ya existían antes de esta actualización quedan privadas automáticamente.
- La seguridad se aplica en PostgreSQL mediante Row Level Security (RLS), no sólo ocultando elementos de la pantalla.

> Si el correo de Danny no es correcto, cámbialo tanto en `config.js` como en la función `is_finanzas_pair` de `supabase-setup.sql` **antes** de usar cuentas compartidas.

## Paso obligatorio: actualizar Supabase

Aunque ya ejecutaste una versión anterior, debes ejecutar otra vez el archivo actualizado:

1. Abre tu proyecto **Finanzas-MF** en Supabase.
2. Ve a **SQL Editor → New query**.
3. Abre `supabase-setup.sql` en este proyecto, copia todo y pégalo en el editor SQL.
4. Pulsa **Run**.
5. El resultado correcto es `Success. No rows returned`.

El script conserva los datos existentes, agrega la tabla privada de movimientos, añade la opción compartida y reemplaza las políticas RLS anteriores.

## Cuentas de acceso

Cada persona debe crear su propia cuenta desde la aplicación:

- Anny inicia sesión con `fontanamarianni@gmail.com`.
- Danny inicia sesión con `josedgonzalezm127@gmail.com`.

En **Authentication → Providers → Email**, mantén obligatoriamente activado **Confirm email** antes de que se registren las cuentas. Cada persona debe confirmar el mensaje recibido; esto demuestra que controla el correo autorizado. Nunca compartan contraseñas.

En **Authentication → URL Configuration** configura:

- `Site URL`: `https://fontanamarianni-svg.github.io/Finanzas-MF/`
- `Redirect URLs`: agrega la misma dirección.

## Actualizar GitHub Pages

Sube o reemplaza estos cinco archivos en el repositorio `Finanzas-MF`:

- `index.html`
- `app.js`
- `config.js`
- `supabase-setup.sql`
- `README.md`

Desde la web de GitHub puedes usar **Add file → Upload files**, arrastrarlos y pulsar **Commit changes**. GitHub Pages actualizará la aplicación en unos minutos:

`https://fontanamarianni-svg.github.io/Finanzas-MF/`

Si prefieres PowerShell y el repositorio local ya está conectado:

```powershell
git add index.html app.js config.js supabase-setup.sql README.md
git commit -m "Agregar billetera privada y Cashea compartido"
git push
```

## Cómo probar

1. Entra con la cuenta de Anny y registra un ingreso y un egreso.
2. Registra una compra Cashea **Personal**.
3. Registra otra compra Cashea **Compartida**.
4. Cierra sesión e inicia con la cuenta de Danny.
5. Danny debe ver solamente la compra compartida. No debe ver los ingresos, egresos ni la compra personal de Anny.
6. Registra un abono desde Danny, vuelve a entrar como Anny y comprueba que el saldo compartido se actualizó.

## Archivos

- `index.html`: interfaz responsive y pestañas de la billetera.
- `app.js`: autenticación, formularios, cálculos y consultas a Supabase.
- `config.js`: URL, clave publishable y correos usados por la identidad y los controles de interfaz; la autorización real se aplica nuevamente en SQL.
- `supabase-setup.sql`: tablas, migración, políticas RLS y pago transaccional.

La clave `sb_publishable_...` puede estar en el navegador. Nunca agregues claves `sb_secret_`, `service_role` ni contraseñas al repositorio.
