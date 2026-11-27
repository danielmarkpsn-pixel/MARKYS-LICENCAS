begin;
create table public.markys_asaas_charges (
 id uuid primary key default gen_random_uuid(),
 license_id uuid not null references public.markys_licenses(id),
 plan_id uuid not null references public.markys_plans(id),
 environment text not null check(environment in ('sandbox','production')),
 amount_cents bigint not null check(amount_cents>0),
 provider_payment_id text,
 status text not null default 'creating' check(status in ('creating','pending','received','applied','review','cancelled')),
 created_at timestamptz not null default now(),
 received_at timestamptz,
 applied_at timestamptz,
 unique(environment,provider_payment_id)
);
alter table public.markys_asaas_charges enable row level security;
revoke all on public.markys_asaas_charges from public,anon,authenticated;
grant select,insert,update on public.markys_asaas_charges to service_role;
create index markys_asaas_charges_license_idx on public.markys_asaas_charges(license_id,created_at desc);
create unique index markys_asaas_one_open_charge on public.markys_asaas_charges(license_id,environment) where status in ('creating','pending','received');
create or replace function public.markys_asaas_prepare(p_user uuid,p_plan uuid,p_environment text)
returns jsonb language plpgsql security definer set search_path='' as $prepare$
declare l public.markys_licenses%rowtype; p public.markys_plans%rowtype; c public.markys_customers%rowtype; q public.markys_asaas_charges%rowtype;
begin
 if p_environment not in ('sandbox','production') or p_environment is null then raise exception 'Ambiente inválido'; end if;
 select x.* into strict l from public.markys_licenses x join public.markys_products s on s.id=x.product_id where x.external_user_id=p_user and s.slug='markys-pdv-mobile' and s.active for update of x;
 if l.status='blocked' or (l.status='active' and l.expires_at is null) then raise exception 'Licença indisponível para renovação'; end if;
 select * into strict p from public.markys_plans where id=p_plan and product_id=l.product_id and active and code in ('monthly','annual','lifetime') and price_cents>0;
 select * into strict c from public.markys_customers where id=l.customer_id;
 select * into q from public.markys_asaas_charges where license_id=l.id and environment=p_environment and status in ('creating','pending','received');
 if found then raise exception 'Já existe cobrança em aberto'; end if;
 insert into public.markys_asaas_charges(license_id,plan_id,environment,amount_cents) values(l.id,p.id,p_environment,p.price_cents) returning * into q;
 return jsonb_build_object('charge_id',q.id,'amount_cents',q.amount_cents,'name',c.name,'email',c.email,'document',c.document);
end $prepare$;
revoke all on function public.markys_asaas_prepare(uuid,uuid,text) from public,anon,authenticated;
grant execute on function public.markys_asaas_prepare(uuid,uuid,text) to service_role;
commit;
