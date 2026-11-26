-- MARKYS LICENÇAS — Supabase PostgreSQL
-- Aplicar no projeto Supabase EXCLUSIVO desta central.
-- Não concede acesso administrativo a usuários comuns.
begin;
create extension if not exists pgcrypto;
create schema if not exists markys_private;
revoke all on schema markys_private from public, anon, authenticated;

create table if not exists public.markys_products (
 id uuid primary key default gen_random_uuid(),
 slug text not null unique check (slug ~ '^[a-z0-9-]+$'),
 name text not null,
 active boolean not null default true,
 created_at timestamptz not null default now()
);
create table if not exists public.markys_customers (
 id uuid primary key default gen_random_uuid(),
 name text not null,
 email text,
 phone text,
 document text,
 notes text,
 created_at timestamptz not null default now()
);
create table if not exists public.markys_plans (
 id uuid primary key default gen_random_uuid(),
 product_id uuid not null references public.markys_products(id),
 name text not null,
 code text not null,
 duration_days integer check (duration_days is null or duration_days > 0),
 price_cents bigint not null default 0 check (price_cents>=0),
 active boolean not null default true,
 unique(product_id,code)
);
create table if not exists public.markys_licenses (
 id uuid primary key default gen_random_uuid(),
 product_id uuid not null references public.markys_products(id),
 customer_id uuid not null references public.markys_customers(id),
 plan_id uuid not null references public.markys_plans(id),
 external_user_id uuid not null,
 status text not null default 'pending' check(status in ('pending','active','blocked')),
 starts_at timestamptz,
 expires_at timestamptz,
 device_limit integer not null default 1 check(device_limit between 1 and 100),
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now(),
 unique(product_id,external_user_id)
);
create table if not exists public.markys_devices (
 license_id uuid not null references public.markys_licenses(id) on delete cascade,
 device_id uuid not null,
 created_at timestamptz not null default now(),
 last_seen_at timestamptz not null default now(),
 primary key(license_id,device_id)
);
create table if not exists public.markys_payments (
 id uuid primary key default gen_random_uuid(),
 license_id uuid not null references public.markys_licenses(id),
 amount_cents bigint not null check(amount_cents>=0),
 paid_at timestamptz,
 due_at timestamptz,
 status text not null default 'pending' check(status in ('pending','paid','overdue','cancelled')),
 method text,
 notes text
);
create table if not exists public.markys_admins (
 user_id uuid primary key references auth.users(id) on delete cascade
);
create table if not exists public.markys_audit (
 id bigint generated always as identity primary key,
 actor uuid references auth.users(id),
 event text not null,
 license_id uuid references public.markys_licenses(id),
 details jsonb not null default '{}'::jsonb,
 created_at timestamptz not null default now()
);
create index if not exists idx_markys_license_customer on public.markys_licenses(customer_id);
create index if not exists idx_markys_license_status on public.markys_licenses(status,expires_at);
create index if not exists idx_markys_payment_due on public.markys_payments(due_at,status);

alter table public.markys_products enable row level security;
alter table public.markys_customers enable row level security;
alter table public.markys_plans enable row level security;
alter table public.markys_licenses enable row level security;
alter table public.markys_devices enable row level security;
alter table public.markys_payments enable row level security;
alter table public.markys_admins enable row level security;
alter table public.markys_audit enable row level security;

-- Nenhuma policy direta: acesso apenas por RPCs security-definer autorizadas.
revoke all on table public.markys_products,public.markys_customers,public.markys_plans,
 public.markys_licenses,public.markys_devices,public.markys_payments,
 public.markys_admins,public.markys_audit from anon,authenticated;

create or replace function public.markys_is_admin()
returns boolean language sql stable security definer set search_path=''
as $$select auth.uid() is not null and exists(select 1 from public.markys_admins where user_id=auth.uid())$$;

create or replace function public.markys_admin_dashboard()
returns jsonb language plpgsql security definer set search_path='' as $$
declare answer jsonb;
begin
 if not public.markys_is_admin() then raise exception 'Acesso negado' using errcode='42501'; end if;
 select jsonb_build_object(
 'customers',(select count(*) from public.markys_customers),
 'products',(select count(*) from public.markys_products),
 'licenses',(select count(*) from public.markys_licenses),
 'active',(select count(*) from public.markys_licenses where status='active' and (expires_at is null or expires_at>now())),
 'blocked',(select count(*) from public.markys_licenses where status='blocked'),
 'expired',(select count(*) from public.markys_licenses where status='active' and expires_at<=now()),
 'pending',(select count(*) from public.markys_licenses where status='pending'),
 'due_cents',(select coalesce(sum(amount_cents),0) from public.markys_payments where status in ('pending','overdue'))
 ) into answer;
 return answer;
end $$;

create or replace function public.markys_admin_data()
returns jsonb language plpgsql security definer set search_path='' as $$
begin
 if not public.markys_is_admin() then raise exception 'Acesso negado' using errcode='42501'; end if;
 return jsonb_build_object(
 'products',coalesce((select jsonb_agg(to_jsonb(t) order by t.name) from public.markys_products t),'[]'::jsonb),
 'customers',coalesce((select jsonb_agg(to_jsonb(t) order by t.name) from public.markys_customers t),'[]'::jsonb),
 'plans',coalesce((select jsonb_agg(to_jsonb(t) order by t.name) from public.markys_plans t),'[]'::jsonb),
 'licenses',coalesce((select jsonb_agg(to_jsonb(t) order by t.created_at desc) from public.markys_licenses t),'[]'::jsonb),
 'devices',coalesce((select jsonb_agg(to_jsonb(t)) from public.markys_devices t),'[]'::jsonb),
 'payments',coalesce((select jsonb_agg(to_jsonb(t) order by t.due_at desc nulls last) from public.markys_payments t),'[]'::jsonb),
 'audit',coalesce((select jsonb_agg(to_jsonb(t) order by t.created_at desc) from (select * from public.markys_audit order by created_at desc limit 100) t),'[]'::jsonb)
 );
end $$;

create or replace function public.markys_admin_save(p_table text,p_data jsonb)
returns uuid language plpgsql security definer set search_path='' as $$
declare rid uuid; pid uuid; plan_product uuid; n integer;
begin
 if not public.markys_is_admin() then raise exception 'Acesso negado' using errcode='42501'; end if;
 if jsonb_typeof(p_data)<>'object' then raise exception 'Dados inválidos'; end if;
 rid:=coalesce(nullif(p_data->>'id','')::uuid,gen_random_uuid());
 if p_table='products' then
  insert into public.markys_products(id,name,slug,active) values(rid,trim(p_data->>'name'),trim(p_data->>'slug'),coalesce((p_data->>'active')::boolean,true))
  on conflict(id) do update set name=excluded.name,slug=excluded.slug,active=excluded.active;
 elsif p_table='customers' then
  insert into public.markys_customers(id,name,email,phone,document,notes)
  values(rid,trim(p_data->>'name'),nullif(p_data->>'email',''),nullif(p_data->>'phone',''),nullif(p_data->>'document',''),nullif(p_data->>'notes',''))
  on conflict(id) do update set name=excluded.name,email=excluded.email,phone=excluded.phone,document=excluded.document,notes=excluded.notes;
 elsif p_table='plans' then
  pid:=(p_data->>'product_id')::uuid;
  insert into public.markys_plans(id,product_id,name,code,duration_days,price_cents,active)
  values(rid,pid,trim(p_data->>'name'),trim(p_data->>'code'),nullif(p_data->>'duration_days','')::integer,(p_data->>'price_cents')::bigint,coalesce((p_data->>'active')::boolean,true))
  on conflict(id) do update set product_id=excluded.product_id,name=excluded.name,code=excluded.code,duration_days=excluded.duration_days,price_cents=excluded.price_cents,active=excluded.active;
 elsif p_table='licenses' then
  pid:=(p_data->>'product_id')::uuid;
  select product_id into plan_product from public.markys_plans where id=(p_data->>'plan_id')::uuid;
  if plan_product is distinct from pid then raise exception 'Plano pertence a outro sistema'; end if;
  insert into public.markys_licenses(id,product_id,customer_id,plan_id,external_user_id,status,starts_at,expires_at,device_limit)
  values(rid,pid,(p_data->>'customer_id')::uuid,(p_data->>'plan_id')::uuid,(p_data->>'external_user_id')::uuid,
    coalesce(p_data->>'status','pending'),nullif(p_data->>'starts_at','')::timestamptz,nullif(p_data->>'expires_at','')::timestamptz,coalesce((p_data->>'device_limit')::integer,1))
  on conflict(id) do update set product_id=excluded.product_id,customer_id=excluded.customer_id,plan_id=excluded.plan_id,external_user_id=excluded.external_user_id,status=excluded.status,starts_at=excluded.starts_at,expires_at=excluded.expires_at,device_limit=excluded.device_limit,updated_at=now();
 elsif p_table='payments' then
  insert into public.markys_payments(id,license_id,amount_cents,paid_at,due_at,status,method,notes)
  values(rid,(p_data->>'license_id')::uuid,(p_data->>'amount_cents')::bigint,nullif(p_data->>'paid_at','')::timestamptz,nullif(p_data->>'due_at','')::timestamptz,coalesce(p_data->>'status','pending'),nullif(p_data->>'method',''),nullif(p_data->>'notes',''))
  on conflict(id) do update set license_id=excluded.license_id,amount_cents=excluded.amount_cents,paid_at=excluded.paid_at,due_at=excluded.due_at,status=excluded.status,method=excluded.method,notes=excluded.notes;
 else raise exception 'Tipo de registro não permitido'; end if;
 insert into public.markys_audit(actor,event,details) values(auth.uid(),'save_'||p_table,jsonb_build_object('id',rid));
 return rid;
end $$;

create or replace function public.markys_admin_change_license(p_id uuid,p_status text)
returns void language plpgsql security definer set search_path='' as $$
begin
 if not public.markys_is_admin() then raise exception 'Acesso negado' using errcode='42501'; end if;
 if p_status not in ('pending','active','blocked') then raise exception 'Status inválido'; end if;
 update public.markys_licenses set status=p_status,updated_at=now() where id=p_id;
 if not found then raise exception 'Licença não encontrada'; end if;
 insert into public.markys_audit(actor,event,license_id,details)
 values(auth.uid(),'status',p_id,jsonb_build_object('status',p_status));
end $$;

create or replace function public.markys_admin_reset_devices(p_id uuid)
returns void language plpgsql security definer set search_path='' as $$
begin
 if not public.markys_is_admin() then raise exception 'Acesso negado' using errcode='42501'; end if;
 perform 1 from public.markys_licenses where id=p_id for update;
 if not found then raise exception 'Licença não encontrada'; end if;
 delete from public.markys_devices where license_id=p_id;
 insert into public.markys_audit(actor,event,license_id) values(auth.uid(),'reset_devices',p_id);
end $$;

revoke all on function public.markys_is_admin(),public.markys_admin_dashboard(),public.markys_admin_data(),public.markys_admin_save(text,jsonb),public.markys_admin_change_license(uuid,text),public.markys_admin_reset_devices(uuid) from public,anon,authenticated;
grant execute on function public.markys_is_admin(),public.markys_admin_dashboard(),public.markys_admin_data(),public.markys_admin_save(text,jsonb),public.markys_admin_change_license(uuid,text),public.markys_admin_reset_devices(uuid) to authenticated;

insert into public.markys_products(slug,name) values('markys-pdv-mobile','MARKYS PDV MOBILE') on conflict(slug) do nothing;
commit;
