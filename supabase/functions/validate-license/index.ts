import { createClient } from "npm:@supabase/supabase-js@2";
const pdvUrl = "https://zdltbzwowkjevhigcgvr.supabase.co";
const pdvKey = "sb_publishable_SQpRVwEMwb3anc4tapXGdg_F_OLfYuZ";
const reply = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
 status, headers: {"Content-Type":"application/json","Cache-Control":"no-store"}
});
Deno.serve(async (req) => {
 if(req.method !== "POST") return reply({error:"method_not_allowed"},405);
 const auth = req.headers.get("Authorization");
 if(!auth || !/^Bearer [^\s]+$/.test(auth)) return reply({error:"unauthorized"},401);
 try {
  const body = await req.json();
  const device = body?.device_id;
  if(typeof device !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(device)) return reply({error:"invalid_device"},400);
  const userResponse = await fetch(pdvUrl+"/auth/v1/user", {headers:{apikey:pdvKey,Authorization:auth},signal:AbortSignal.timeout(10000)});
  if(userResponse.status===401 || userResponse.status===403) return reply({error:"unauthorized"},401);
  if(!userResponse.ok) return reply({error:"authentication_unavailable"},503);
  const user=await userResponse.json();
  if(typeof user.id !== "string") return reply({error:"unauthorized"},401);
  const url=Deno.env.get("SUPABASE_URL"), key=Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if(!url || !key) return reply({error:"server_configuration"},503);
  const central=createClient(url,key,{auth:{persistSession:false,autoRefreshToken:false}});
  const {data,error}=await central.rpc("markys_validate_license",{p_user:user.id,p_device:device});
  if(error) return reply({error:"validation_unavailable"},503);
  return reply(data);
 } catch { return reply({error:"request_failed"},400); }
});
