import { createClient } from "npm:@supabase/supabase-js@2";
const reply=(body:unknown,status=200)=>new Response(JSON.stringify(body),{status,headers:{"Content-Type":"application/json","Cache-Control":"no-store"}});
Deno.serve(async req=>{
 if(req.method!=="POST")return reply({error:"method_not_allowed"},405);
 const auth=req.headers.get("Authorization");
 if(!auth||!/^Bearer [^\s]+$/.test(auth))return reply({error:"unauthorized"},401);
 try{
 const r=await fetch("https://zdltbzwowkjevhigcgvr.supabase.co/auth/v1/user",{headers:{Authorization:auth,apikey:"sb_publishable_SQpRVwEMwb3anc4tapXGdg_F_OLfYuZ"},signal:AbortSignal.timeout(10000)});
 if(!r.ok)return reply({error:"authentication_failed"},[401,403].includes(r.status)?401:503);
 const u=await r.json();
 if(typeof u.id!=="string"||!u.email_confirmed_at)return reply({error:"unauthorized"},401);
 const url=Deno.env.get("SUPABASE_URL"),key=Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
 if(!url||!key)return reply({error:"server_configuration"},503);
 const db=createClient(url,key,{auth:{persistSession:false,autoRefreshToken:false}});
 const {data,error}=await db.rpc("markys_asaas_catalog",{p_user:u.id});
 if(error)return reply({error:"catalog_unavailable"},error.code==="P0002"?404:503);
 return reply({...data,environment:"sandbox"});
 }catch{return reply({error:"request_failed"},503);}
});
