import { createClient } from "npm:@supabase/supabase-js@2";
const pdvUrl = "https://zdltbzwowkjevhigcgvr.supabase.co";
const pdvKey = "sb_publishable_SQpRVwEMwb3anc4tapXGdg_F_OLfYuZ";
const reply = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
 status, headers: {"Content-Type":"application/json","Cache-Control":"no-store"}
});
const b64url = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes)).replace(/\+/g,"-").replace(/\//g,"_").replace(/=+$/g,"");
async function signLease(user: string, device: string, data: Record<string, unknown>) {
 const hours=Number(data.offline_hours);
 if(![2,6,12,24].includes(hours)) return null;
 const issued=Date.parse(String(data.server_time));
 const expires=data.expires_at===null?Infinity:Date.parse(String(data.expires_at));
 const until=Math.min(issued+hours*3600000,expires);
 if(!Number.isFinite(issued)||!Number.isFinite(until)||until<=issued) return null;
 const secret=Deno.env.get("MARKYS_LEASE_PRIVATE_JWK");
 if(!secret) return null;
 const key=await crypto.subtle.importKey("jwk",JSON.parse(secret),{name:"ECDSA",namedCurve:"P-256"},false,["sign"]);
 const encoder=new TextEncoder();
 const header=b64url(encoder.encode(JSON.stringify({alg:"ES256",typ:"JWT",kid:"markys-v1"})));
 const payload=b64url(encoder.encode(JSON.stringify({iss:"markys-licencas",aud:"markys-pdv-mobile",sub:user,device_id:device,iat:Math.floor(issued/1000),exp:Math.floor(until/1000)})));
 const input=header+"."+payload;
 const signature=await crypto.subtle.sign({name:"ECDSA",hash:"SHA-256"},key,encoder.encode(input));
 return input+"."+b64url(new Uint8Array(signature));
}
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
  if(data?.allowed===true){
   let lease=null;
   try {lease=await signLease(user.id,device,data);} catch {console.error("lease signing unavailable");}
   return reply({...data,offline_lease:lease});
  }
  return reply(data);
 } catch { return reply({error:"request_failed"},400); }
});
