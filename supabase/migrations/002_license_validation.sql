begin;
create or replace function public.markys_validate_license(p_user uuid,p_device uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare l public.markys_licenses%rowtype; n integer;
begin
 if p_user is null or p_device is null then raise exception 'Identificação inválida'; end if;
 select x.* into l from public.markys_licenses x
 join public.markys_products p on p.id=x.product_id
 where p.slug='markys-pdv-mobile' and p.active and x.external_user_id=p_user
 for update of x;
 if not found then return jsonb_build_object('allowed',false,'reason','not_registered'); end if;
 if l.status<>'active' then return jsonb_build_object('allowed',false,'reason',l.status); end if;
 if l.starts_at>now() then return jsonb_build_object('allowed',false,'reason','not_started'); end if;
 if l.expires_at<=now() then return jsonb_build_object('allowed',false,'reason','expired'); end if;
 if l.expires_at is null and exists(select 1 from public.markys_plans where id=l.plan_id and duration_days is not null) then
 return jsonb_build_object('allowed',false,'reason','missing_expiration'); end if;
 if not exists(select 1 from public.markys_plans where id=l.plan_id and product_id=l.product_id) then
 return jsonb_build_object('allowed',false,'reason','invalid_plan'); end if;
 if not exists(select 1 from public.markys_devices where license_id=l.id and device_id=p_device) then
 select count(*) into n from public.markys_devices where license_id=l.id;
 if n>=l.device_limit then return jsonb_build_object('allowed',false,'reason','device_limit'); end if;
 insert into public.markys_devices(license_id,device_id) values(l.id,p_device);
 insert into public.markys_audit(event,license_id,details) values('device_registered',l.id,jsonb_build_object('device_id',p_device));
 else
 update public.markys_devices set last_seen_at=now() where license_id=l.id and device_id=p_device;
 end if;
 return jsonb_build_object('allowed',true,'reason','active','expires_at',l.expires_at,'server_time',now());
end $$;
revoke all on function public.markys_validate_license(uuid,uuid) from public,anon,authenticated;
grant execute on function public.markys_validate_license(uuid,uuid) to service_role;
commit;
