begin;
insert into public.markys_plans(product_id,name,code,duration_days,price_cents,active)
select p.id,v.name,v.code,v.days,v.price,true from public.markys_products p
cross join (values ('TESTE','trial',7,0),('MENSAL','monthly',30,3500),('ANUAL','annual',365,35000),('VITALÍCIO','lifetime',null::integer,100000)) v(name,code,days,price)
where p.slug='markys-pdv-mobile'
on conflict(product_id,code) do update set name=excluded.name,duration_days=excluded.duration_days,price_cents=excluded.price_cents,active=true;

create or replace function public.markys_start_trial(p_user uuid,p_name text,p_email text,p_phone text,p_document text)
returns uuid language plpgsql security definer set search_path='' as $trial$
declare pid uuid; planid uuid; cid uuid; lid uuid; doc text;
begin
 if p_user is null then raise exception 'Usuário inválido'; end if;
 select id into strict pid from public.markys_products where slug='markys-pdv-mobile' and active;
 perform pg_advisory_xact_lock(hashtextextended(p_user::text,0));
 select id into lid from public.markys_licenses where product_id=pid and external_user_id=p_user;
 if found then return lid; end if;
 doc:=regexp_replace(coalesce(p_document,''),'[^0-9]','','g');
 if length(doc) not in (11,14) or length(trim(coalesce(p_name,''))) not between 2 and 200 or length(trim(coalesce(p_phone,''))) not between 8 and 30 or length(coalesce(p_email,'')) not between 3 and 254 then raise exception 'Cadastro incompleto'; end if;
 perform pg_advisory_xact_lock(hashtextextended('document:'||doc,0));
 if exists(select 1 from public.markys_customers c join public.markys_licenses l on l.customer_id=c.id where l.product_id=pid and regexp_replace(coalesce(c.document,''),'[^0-9]','','g')=doc) then raise exception 'Documento já cadastrado'; end if;
 select id into strict planid from public.markys_plans where product_id=pid and code='trial' and active;
 insert into public.markys_customers(name,email,phone,document) values(trim(p_name),lower(trim(p_email)),trim(p_phone),doc) returning id into cid;
 insert into public.markys_licenses(product_id,customer_id,plan_id,external_user_id,status,starts_at,expires_at) values(pid,cid,planid,p_user,'active',now(),now()+interval '7 days') returning id into lid;
 insert into public.markys_audit(event,license_id) values('trial_started',lid);
 return lid;
end $trial$;
revoke all on function public.markys_start_trial(uuid,text,text,text,text) from public,anon,authenticated;
grant execute on function public.markys_start_trial(uuid,text,text,text,text) to service_role;

create or replace function public.markys_admin_confirm_payment(p_license uuid,p_plan uuid,p_paid_at timestamptz,p_method text,p_reference uuid)
returns uuid language plpgsql security definer set search_path='' as $billing$
declare l public.markys_licenses%rowtype; p public.markys_plans%rowtype; start_at timestamptz; end_at timestamptz; existing uuid;
begin
 if not public.markys_is_admin() then raise exception 'Acesso negado' using errcode='42501'; end if;
 if p_reference is null or p_paid_at is null or p_paid_at>now() then raise exception 'Pagamento inválido'; end if;
 select * into strict l from public.markys_licenses where id=p_license for update;
 select id into existing from public.markys_payments where id=p_reference and license_id=p_license and status='paid';
 if found then return existing; end if;
 select * into strict p from public.markys_plans where id=p_plan and product_id=l.product_id and active and code in ('monthly','annual','lifetime');
 if l.status='blocked' then raise exception 'Desbloqueie a licença manualmente antes de renovar'; end if;
 if l.status='active' and l.expires_at is null then raise exception 'Licença sem vencimento já ativa'; end if;
 start_at:=p_paid_at;
 if l.plan_id=p.id and l.expires_at>start_at then start_at:=l.expires_at; end if;
 end_at:=case p.code when 'monthly' then ((start_at at time zone 'America/Manaus')+interval '1 month') at time zone 'America/Manaus' when 'annual' then ((start_at at time zone 'America/Manaus')+interval '1 year') at time zone 'America/Manaus' else null end;
 insert into public.markys_payments(id,license_id,amount_cents,paid_at,due_at,status,method) values(p_reference,l.id,p.price_cents,p_paid_at,p_paid_at,'paid',p_method);
 update public.markys_licenses set plan_id=p.id,status='active',starts_at=case when l.plan_id=p.id and l.expires_at>p_paid_at then coalesce(l.starts_at,p_paid_at) else p_paid_at end,expires_at=end_at,updated_at=now() where id=l.id;
 insert into public.markys_audit(actor,event,license_id,details) values(auth.uid(),'payment_confirmed',l.id,jsonb_build_object('payment_id',p_reference,'expires_at',end_at));
 return p_reference;
end $billing$;
revoke all on function public.markys_admin_confirm_payment(uuid,uuid,timestamptz,text,uuid) from public,anon,authenticated;
grant execute on function public.markys_admin_confirm_payment(uuid,uuid,timestamptz,text,uuid) to authenticated;
commit;
