-- Finanzas MF: instalación y migración segura.
-- Ejecuta este archivo completo en Supabase > SQL Editor > New query.
-- Puede ejecutarse nuevamente y conserva los datos existentes.

begin;
create extension if not exists pgcrypto;

create table if not exists public.purchases (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  purchase_date date not null default current_date,
  product text not null check (char_length(trim(product)) between 1 and 120),
  category text not null default '',
  store_name text not null default '',
  mode text not null default 'cotidiano' check (mode in ('cotidiano', 'principal')),
  credit_line text not null check (credit_line in ('Anny', 'Danny')),
  total_amount numeric(12,2) not null check (total_amount > 0),
  initial_amount numeric(12,2) not null default 0 check (initial_amount >= 0 and initial_amount <= total_amount),
  initial_paid_by text not null check (initial_paid_by in ('Anny', 'Danny')),
  split_type text not null check (split_type in ('mitad', 'personalizado')),
  anny_debt numeric(12,2) not null check (anny_debt >= 0),
  danny_debt numeric(12,2) not null check (danny_debt >= 0),
  anny_paid numeric(12,2) not null default 0 check (anny_paid >= 0),
  danny_paid numeric(12,2) not null default 0 check (danny_paid >= 0),
  installments smallint not null check (installments in (1, 2, 3, 6, 12)),
  notes text not null default '' check (char_length(notes) <= 500),
  total_paid numeric(12,2) not null default 0 check (total_paid >= 0),
  status text not null default 'activa' check (status in ('activa', 'saldada')),
  is_shared boolean not null default false,
  constraint debt_matches_financing check (round(anny_debt + danny_debt, 2) = round(total_amount - initial_amount, 2))
);

-- Migración explícita desde la versión anterior. Las compras viejas quedan privadas.
alter table public.purchases add column if not exists is_shared boolean not null default false;
alter table public.purchases add column if not exists anny_paid numeric(12,2) not null default 0;
alter table public.purchases add column if not exists danny_paid numeric(12,2) not null default 0;

create table if not exists public.payments (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  purchase_id uuid not null references public.purchases(id) on delete cascade,
  created_at timestamptz not null default now(),
  paid_at date not null default current_date,
  payer text not null check (payer in ('Anny', 'Danny')),
  amount numeric(12,2) not null check (amount > 0),
  reference text,
  receipt_url text
);

create table if not exists public.private_entries (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  entry_date date not null default current_date,
  entry_type text not null check (entry_type in ('ingreso', 'egreso')),
  amount numeric(12,2) not null check (amount > 0),
  category text not null default '' check (char_length(category) <= 60),
  description text not null check (char_length(trim(description)) between 1 and 160),
  notes text not null default '' check (char_length(notes) <= 500)
);

-- Los pagos son la fuente de verdad para reconstruir todos los saldos existentes.
with payment_totals as (
  select purchase_id,
    coalesce(sum(amount) filter (where payer = 'Anny'), 0) as anny_total,
    coalesce(sum(amount) filter (where payer = 'Danny'), 0) as danny_total
  from public.payments
  group by purchase_id
), reconciled as (
  select purchase.id,
    coalesce(totals.anny_total, 0) as anny_total,
    coalesce(totals.danny_total, 0) as danny_total
  from public.purchases purchase
  left join payment_totals totals on totals.purchase_id = purchase.id
)
update public.purchases purchase
set anny_paid = reconciled.anny_total,
    danny_paid = reconciled.danny_total,
    total_paid = reconciled.anny_total + reconciled.danny_total,
    status = case
      when reconciled.anny_total + reconciled.danny_total >= purchase.total_amount - purchase.initial_amount then 'saldada'
      else 'activa'
    end
from reconciled
where reconciled.id = purchase.id;

-- En instalaciones migradas, añade las restricciones que CREATE TABLE no puede incorporar.
do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'purchases_anny_paid_nonnegative'
      and conrelid = 'public.purchases'::regclass
  ) then
    alter table public.purchases
      add constraint purchases_anny_paid_nonnegative check (anny_paid >= 0);
  end if;
  if not exists (
    select 1 from pg_constraint
    where conname = 'purchases_danny_paid_nonnegative'
      and conrelid = 'public.purchases'::regclass
  ) then
    alter table public.purchases
      add constraint purchases_danny_paid_nonnegative check (danny_paid >= 0);
  end if;
end
$$;

create index if not exists purchases_owner_created_idx on public.purchases(user_id, created_at desc);
create index if not exists purchases_shared_created_idx on public.purchases(is_shared, created_at desc) where is_shared = true;
create index if not exists payments_owner_created_idx on public.payments(user_id, created_at desc);
create index if not exists payments_purchase_idx on public.payments(purchase_id);
create index if not exists private_entries_owner_date_idx on public.private_entries(user_id, entry_date desc, created_at desc);

alter table public.purchases enable row level security;
alter table public.payments enable row level security;
alter table public.private_entries enable row level security;

-- Devuelve Anny o Danny sólo para un usuario confirmado y autorizado.
create or replace function public.finanzas_member_name(p_user_id uuid)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select case lower(user_record.email)
    when 'fontanamarianni@gmail.com' then 'Anny'
    when 'josedgonzalezm127@gmail.com' then 'Danny'
    else null
  end
  from auth.users user_record
  where user_record.id = p_user_id
    and user_record.email_confirmed_at is not null
  limit 1;
$$;

revoke all on function public.finanzas_member_name(uuid) from public;
revoke all on function public.finanzas_member_name(uuid) from anon;
grant execute on function public.finanzas_member_name(uuid) to authenticated;

-- Sólo se eliminan políticas pertenecientes a esta aplicación.
drop policy if exists "Usuarios leen sus compras" on public.purchases;
drop policy if exists "Usuarios crean sus compras" on public.purchases;
drop policy if exists "Usuarios leen sus pagos" on public.payments;
drop policy if exists "Leer compras propias o compartidas" on public.purchases;
drop policy if exists "Crear compras propias autorizadas" on public.purchases;
drop policy if exists "Leer pagos de compras visibles" on public.payments;
drop policy if exists "Leer movimientos privados propios" on public.private_entries;
drop policy if exists "Crear movimientos privados propios" on public.private_entries;
drop policy if exists "Actualizar movimientos privados propios" on public.private_entries;
drop policy if exists "Eliminar movimientos privados propios" on public.private_entries;

create policy "Leer compras propias o compartidas"
on public.purchases for select to authenticated
using (
  (user_id = auth.uid() and public.finanzas_member_name(auth.uid()) is not null)
  or (
    is_shared = true
    and public.finanzas_member_name(auth.uid()) is not null
    and public.finanzas_member_name(user_id) is not null
  )
);

create policy "Crear compras propias autorizadas"
on public.purchases for insert to authenticated
with check (
  user_id = auth.uid()
  and public.finanzas_member_name(auth.uid()) is not null
);

create policy "Leer pagos de compras visibles"
on public.payments for select to authenticated
using (
  exists (
    select 1 from public.purchases purchase
    where purchase.id = payments.purchase_id
      and (
        (purchase.user_id = auth.uid() and public.finanzas_member_name(auth.uid()) is not null)
        or (
          purchase.is_shared = true
          and public.finanzas_member_name(auth.uid()) is not null
          and public.finanzas_member_name(purchase.user_id) is not null
        )
      )
  )
);

create policy "Leer movimientos privados propios"
on public.private_entries for select to authenticated
using (user_id = auth.uid() and public.finanzas_member_name(auth.uid()) is not null);

create policy "Crear movimientos privados propios"
on public.private_entries for insert to authenticated
with check (user_id = auth.uid() and public.finanzas_member_name(auth.uid()) is not null);

create policy "Actualizar movimientos privados propios"
on public.private_entries for update to authenticated
using (user_id = auth.uid() and public.finanzas_member_name(auth.uid()) is not null)
with check (user_id = auth.uid() and public.finanzas_member_name(auth.uid()) is not null);

create policy "Eliminar movimientos privados propios"
on public.private_entries for delete to authenticated
using (user_id = auth.uid() and public.finanzas_member_name(auth.uid()) is not null);

create or replace function public.record_payment(
  p_purchase_id uuid,
  p_payer text,
  p_amount numeric,
  p_reference text default null,
  p_paid_at date default current_date,
  p_receipt_url text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_purchase public.purchases%rowtype;
  v_member_name text;
  v_person_pending numeric(12,2);
  v_new_total numeric(12,2);
begin
  v_member_name := public.finanzas_member_name(auth.uid());
  if auth.uid() is null or v_member_name is null then
    raise exception 'Tu cuenta no está autorizada o el correo no está confirmado.';
  end if;
  if p_payer not in ('Anny', 'Danny') then
    raise exception 'La persona que pagó no es válida.';
  end if;
  if p_amount is null or round(p_amount, 2) <= 0 then
    raise exception 'El monto debe ser al menos $0.01.';
  end if;
  if char_length(coalesce(p_reference, '')) > 120 or char_length(coalesce(p_receipt_url, '')) > 500 then
    raise exception 'La referencia o el enlace es demasiado largo.';
  end if;

  select * into v_purchase
  from public.purchases
  where id = p_purchase_id
    and (
      user_id = auth.uid()
      or (
        is_shared = true
        and public.finanzas_member_name(user_id) is not null
      )
    )
  for update;

  if not found then
    raise exception 'No se encontró la compra o no tienes permiso para verla.';
  end if;
  if v_purchase.status = 'saldada' then
    raise exception 'Esta compra ya está saldada.';
  end if;
  if not v_purchase.is_shared and p_payer <> public.finanzas_member_name(v_purchase.user_id) then
    raise exception 'Una compra personal sólo puede abonarse a nombre de su dueño.';
  end if;

  v_person_pending := case
    when p_payer = 'Anny' then v_purchase.anny_debt - v_purchase.anny_paid
    else v_purchase.danny_debt - v_purchase.danny_paid
  end;
  if round(p_amount, 2) > round(v_person_pending, 2) then
    raise exception 'El abono supera el saldo de %: $%.', p_payer, round(v_person_pending, 2);
  end if;

  v_new_total := round(v_purchase.total_paid + p_amount, 2);
  insert into public.payments (user_id, purchase_id, payer, amount, reference, paid_at, receipt_url)
  values (auth.uid(), p_purchase_id, p_payer, round(p_amount, 2), nullif(trim(p_reference), ''), coalesce(p_paid_at, current_date), nullif(trim(p_receipt_url), ''));

  update public.purchases
  set anny_paid = anny_paid + case when p_payer = 'Anny' then round(p_amount, 2) else 0 end,
      danny_paid = danny_paid + case when p_payer = 'Danny' then round(p_amount, 2) else 0 end,
      total_paid = v_new_total,
      status = case when v_new_total >= total_amount - initial_amount then 'saldada' else 'activa' end
  where id = p_purchase_id;

  return jsonb_build_object('success', true, 'total_paid', v_new_total);
end;
$$;

revoke all on function public.record_payment(uuid, text, numeric, text, date, text) from public;
revoke all on function public.record_payment(uuid, text, numeric, text, date, text) from anon;
grant execute on function public.record_payment(uuid, text, numeric, text, date, text) to authenticated;

-- Corrige una compra Cashea. Sólo el creador puede modificarla.
-- Cuando existen pagos, sus importes, reparto y cuotas quedan bloqueados.
create or replace function public.update_purchase(
  p_purchase_id uuid,
  p_purchase_date date,
  p_product text,
  p_category text,
  p_store_name text,
  p_mode text,
  p_total_amount numeric,
  p_initial_amount numeric,
  p_initial_paid_by text,
  p_credit_line text,
  p_split_type text,
  p_anny_debt numeric,
  p_danny_debt numeric,
  p_installments smallint,
  p_notes text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_purchase public.purchases%rowtype;
  v_financed numeric(12,2);
  v_has_payments boolean;
begin
  if public.finanzas_member_name(auth.uid()) is null then
    raise exception 'Tu cuenta no está autorizada o el correo no está confirmado.';
  end if;
  if p_purchase_date is null or char_length(trim(coalesce(p_product, ''))) not between 1 and 120 then
    raise exception 'La fecha y el producto son obligatorios.';
  end if;
  if char_length(coalesce(p_category, '')) > 60 or char_length(coalesce(p_store_name, '')) > 120 or char_length(coalesce(p_notes, '')) > 500 then
    raise exception 'Uno de los textos supera el límite permitido.';
  end if;
  if p_mode not in ('cotidiano', 'principal') or p_initial_paid_by not in ('Anny', 'Danny') or p_credit_line not in ('Anny', 'Danny') or p_split_type not in ('mitad', 'personalizado') or p_installments not in (1, 2, 3, 6, 12) then
    raise exception 'Los datos de la compra no son válidos.';
  end if;
  if p_total_amount is null or p_initial_amount is null or round(p_total_amount, 2) <= round(p_initial_amount, 2) or p_initial_amount < 0 then
    raise exception 'La inicial debe ser menor que el total de la compra.';
  end if;
  v_financed := round(p_total_amount - p_initial_amount, 2);
  if p_anny_debt is null or p_danny_debt is null or p_anny_debt < 0 or p_danny_debt < 0 or round(p_anny_debt + p_danny_debt, 2) <> v_financed then
    raise exception 'La división de deuda no coincide con el financiamiento.';
  end if;

  select * into v_purchase
  from public.purchases
  where id = p_purchase_id and user_id = auth.uid()
  for update;
  if not found then
    raise exception 'No se encontró la compra o no puedes editarla.';
  end if;

  v_has_payments := exists (
    select 1 from public.payments
    where purchase_id = v_purchase.id
  );
  if v_has_payments and (
    round(p_total_amount, 2) is distinct from round(v_purchase.total_amount, 2)
    or round(p_initial_amount, 2) is distinct from round(v_purchase.initial_amount, 2)
    or p_initial_paid_by is distinct from v_purchase.initial_paid_by
    or p_credit_line is distinct from v_purchase.credit_line
    or p_split_type is distinct from v_purchase.split_type
    or round(p_anny_debt, 2) is distinct from round(v_purchase.anny_debt, 2)
    or round(p_danny_debt, 2) is distinct from round(v_purchase.danny_debt, 2)
    or p_installments is distinct from v_purchase.installments
  ) then
    raise exception 'Esta compra tiene pagos. Sólo puedes editar fecha, producto, categoría, tienda, tipo y notas.';
  end if;

  update public.purchases
  set purchase_date = p_purchase_date,
      product = trim(p_product),
      category = trim(coalesce(p_category, '')),
      store_name = trim(coalesce(p_store_name, '')),
      mode = p_mode,
      notes = trim(coalesce(p_notes, '')),
      total_amount = case when v_has_payments then total_amount else round(p_total_amount, 2) end,
      initial_amount = case when v_has_payments then initial_amount else round(p_initial_amount, 2) end,
      initial_paid_by = case when v_has_payments then initial_paid_by else p_initial_paid_by end,
      credit_line = case when v_has_payments then credit_line else p_credit_line end,
      split_type = case when v_has_payments then split_type else p_split_type end,
      anny_debt = case when v_has_payments then anny_debt else round(p_anny_debt, 2) end,
      danny_debt = case when v_has_payments then danny_debt else round(p_danny_debt, 2) end,
      installments = case when v_has_payments then installments else p_installments end
  where id = p_purchase_id;

  return jsonb_build_object('success', true, 'has_payments', v_has_payments);
end;
$$;

revoke all on function public.update_purchase(uuid, date, text, text, text, text, numeric, numeric, text, text, text, numeric, numeric, smallint, text) from public;
revoke all on function public.update_purchase(uuid, date, text, text, text, text, numeric, numeric, text, text, text, numeric, numeric, smallint, text) from anon;
grant execute on function public.update_purchase(uuid, date, text, text, text, text, numeric, numeric, text, text, text, numeric, numeric, smallint, text) to authenticated;

-- Corrige un pago registrado por el usuario actual y recalcula ambos saldos de forma atómica.
create or replace function public.update_payment(
  p_payment_id uuid,
  p_payer text,
  p_amount numeric,
  p_reference text default null,
  p_paid_at date default current_date,
  p_receipt_url text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_payment public.payments%rowtype;
  v_purchase public.purchases%rowtype;
  v_anny_paid numeric(12,2);
  v_danny_paid numeric(12,2);
  v_total_paid numeric(12,2);
begin
  if public.finanzas_member_name(auth.uid()) is null then
    raise exception 'Tu cuenta no está autorizada o el correo no está confirmado.';
  end if;
  if p_payer not in ('Anny', 'Danny') or p_amount is null or round(p_amount, 2) <= 0 then
    raise exception 'Los datos del pago no son válidos.';
  end if;
  if p_paid_at is null or char_length(coalesce(p_reference, '')) > 120 or char_length(coalesce(p_receipt_url, '')) > 500 then
    raise exception 'La fecha, referencia o enlace no son válidos.';
  end if;

  select * into v_payment
  from public.payments
  where id = p_payment_id and user_id = auth.uid()
  for update;
  if not found then
    raise exception 'Sólo puedes editar pagos que registraste tú.';
  end if;

  select * into v_purchase
  from public.purchases
  where id = v_payment.purchase_id
  for update;
  if not found then
    raise exception 'No se encontró la compra relacionada.';
  end if;
  if not v_purchase.is_shared and p_payer <> public.finanzas_member_name(v_purchase.user_id) then
    raise exception 'Una compra personal sólo puede abonarse a nombre de su dueño.';
  end if;

  v_anny_paid := round(v_purchase.anny_paid - case when v_payment.payer = 'Anny' then v_payment.amount else 0 end + case when p_payer = 'Anny' then p_amount else 0 end, 2);
  v_danny_paid := round(v_purchase.danny_paid - case when v_payment.payer = 'Danny' then v_payment.amount else 0 end + case when p_payer = 'Danny' then p_amount else 0 end, 2);
  if v_anny_paid < 0 or v_danny_paid < 0 or v_anny_paid > v_purchase.anny_debt or v_danny_paid > v_purchase.danny_debt then
    raise exception 'El cambio supera el saldo asignado a Anny o Danny.';
  end if;
  v_total_paid := round(v_anny_paid + v_danny_paid, 2);

  update public.payments
  set payer = p_payer,
      amount = round(p_amount, 2),
      reference = nullif(trim(p_reference), ''),
      paid_at = p_paid_at,
      receipt_url = nullif(trim(p_receipt_url), '')
  where id = p_payment_id;

  update public.purchases
  set anny_paid = v_anny_paid,
      danny_paid = v_danny_paid,
      total_paid = v_total_paid,
      status = case when v_total_paid >= total_amount - initial_amount then 'saldada' else 'activa' end
  where id = v_purchase.id;

  return jsonb_build_object('success', true, 'total_paid', v_total_paid);
end;
$$;

revoke all on function public.update_payment(uuid, text, numeric, text, date, text) from public;
revoke all on function public.update_payment(uuid, text, numeric, text, date, text) from anon;
grant execute on function public.update_payment(uuid, text, numeric, text, date, text) to authenticated;

commit;
