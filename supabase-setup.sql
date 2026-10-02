-- Finanzas MF: ejecuta este archivo completo en Supabase > SQL Editor > New query.
-- Usa solo la clave publishable en el frontend. Nunca uses una clave secret/service_role.

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
  installments smallint not null check (installments in (1, 2, 3, 6, 12)),
  notes text not null default '' check (char_length(notes) <= 500),
  total_paid numeric(12,2) not null default 0 check (total_paid >= 0),
  status text not null default 'activa' check (status in ('activa', 'saldada')),
  constraint debt_matches_financing check (round(anny_debt + danny_debt, 2) = round(total_amount - initial_amount, 2))
);

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

create index if not exists purchases_owner_created_idx on public.purchases(user_id, created_at desc);
create index if not exists payments_owner_created_idx on public.payments(user_id, created_at desc);

alter table public.purchases enable row level security;
alter table public.payments enable row level security;

-- Se recrean para que el script pueda ejecutarse más de una vez.
drop policy if exists "Usuarios leen sus compras" on public.purchases;
drop policy if exists "Usuarios crean sus compras" on public.purchases;
drop policy if exists "Usuarios leen sus pagos" on public.payments;

create policy "Usuarios leen sus compras" on public.purchases for select to authenticated using (user_id = auth.uid());
create policy "Usuarios crean sus compras" on public.purchases for insert to authenticated with check (user_id = auth.uid());
create policy "Usuarios leen sus pagos" on public.payments for select to authenticated using (user_id = auth.uid());

-- Esta función registra un abono y actualiza el saldo dentro de una misma transacción.
-- Los usuarios no tienen permiso directo para modificar saldo ni insertar pagos.
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
set search_path = public
as $$
declare
  v_purchase public.purchases;
  v_financed numeric(12,2);
  v_new_total numeric(12,2);
begin
  if auth.uid() is null then
    raise exception 'Debes iniciar sesión.';
  end if;
  if p_payer not in ('Anny', 'Danny') then
    raise exception 'La persona que pagó no es válida.';
  end if;
  if p_amount is null or p_amount <= 0 then
    raise exception 'El monto debe ser mayor que cero.';
  end if;

  select * into v_purchase from public.purchases
    where id = p_purchase_id and user_id = auth.uid() for update;
  if not found then
    raise exception 'No se encontró la compra.';
  end if;
  if v_purchase.status = 'saldada' then
    raise exception 'Esta compra ya está saldada.';
  end if;

  v_financed := v_purchase.total_amount - v_purchase.initial_amount;
  v_new_total := round(v_purchase.total_paid + p_amount, 2);
  if v_new_total > v_financed then
    raise exception 'El abono supera el saldo pendiente de $%.', round(v_financed - v_purchase.total_paid, 2);
  end if;

  insert into public.payments (user_id, purchase_id, payer, amount, reference, paid_at, receipt_url)
  values (auth.uid(), p_purchase_id, p_payer, round(p_amount, 2), nullif(trim(p_reference), ''), coalesce(p_paid_at, current_date), nullif(trim(p_receipt_url), ''));

  update public.purchases
  set total_paid = v_new_total,
      status = case when v_new_total >= v_financed then 'saldada' else 'activa' end
  where id = p_purchase_id;

  return jsonb_build_object('success', true, 'total_paid', v_new_total, 'status', case when v_new_total >= v_financed then 'saldada' else 'activa' end);
end;
$$;

revoke all on function public.record_payment(uuid, text, numeric, text, date, text) from public;
revoke all on function public.record_payment(uuid, text, numeric, text, date, text) from anon;
grant execute on function public.record_payment(uuid, text, numeric, text, date, text) to authenticated;
