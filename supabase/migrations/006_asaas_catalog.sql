begin;
create or replace function public.markys_asaas_catalog(p_user uuid)
returns jsonb language plpgsql security definer set search_path='' as $catalog$
declare l public.markys_licenses%rowtype;
begin
 select x.* into strict l from public.markys_licenses x join public.markys_products s on s.id=x.product_id where x.external_user_id=p_user and s.slug='markys-pdv-mobile' and s.active;
 return jsonb_build_object('status',l.status,'expires_at',l.expires_at,'plan_code',(select code from public.markys_plans where id=l.plan_id),'plans',coalesce((select jsonb_agg(jsonb_build_object('id',p.id,'name',p.name,'code',p.code,'price_cents',p.price_cents) order by p.price_cents) from public.markys_plans p where p.product_id=l.product_id and p.active and p.code in ('monthly','annual','lifetime') and p.price_cents>0),'[]'::jsonb),'charges',coalesce((select jsonb_agg(to_jsonb(q)) from (select id,status,amount_cents,created_at,received_at from public.markys_asaas_charges where license_id=l.id and environment='sandbox' order by created_at desc limit 10) q),'[]'::jsonb));
end $catalog$;
revoke all on function public.markys_asaas_catalog(uuid) from public,anon,authenticated;
grant execute on function public.markys_asaas_catalog(uuid) to service_role;
commit;
