import { createClient } from "npm:@supabase/supabase-js@2";
const reply=(body:unknown,status=200)=>new Response(JSON.stringify(body),{status,headers:{"Content-Type":"application/json","Cache-Control":"no-store"}});
async function equal(a:string,b:string){
 const e=new TextEncoder();
 const x=new Uint8Array(await crypto.subtle.digest("SHA-256",e.encode(a)));
 const y=new Uint8Array(await crypto.subtle.digest("SHA-256",e.encode(b)));
 let diff=0;for(let i=0;i<x.length;i++)diff|=x[i]^y[i];return diff===0;
}
Deno.serve(async req=>{
 if(req.method!=="POST")return reply({error:"method_not_allowed"},405);
 const token=Deno.env.get("ASAAS_WEBHOOK_TOKEN");
 if(!token||!await equal(req.headers.get("asaas-access-token")??"",token))return reply({error:"unauthorized"},401);
 const base=Deno.env.get("ASAAS_API_URL"),key=Deno.env.get("ASAAS_API_KEY");
 if(base!=="https://api-sandbox.asaas.com/v3"||!key)return reply({error:"sandbox_configuration_required"},503);
 try{
 const event=await req.json();
 if(event.event!=="PAYMENT_RECEIVED")return reply({ignored:true});
 const id=event.payment?.id;
 if(typeof id!=="string"||!/^pay_[a-zA-Z0-9_-]{1,128}$/.test(id)){console.warn("Webhook rejected: invalid payment identifier");return reply({error:"invalid_payment"},400);}
 const db=createClient(Deno.env.get("SUPABASE_URL")!,Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,{auth:{persistSession:false,autoRefreshToken:false}});
 const {data:q,error}=await db.from("markys_asaas_charges").select("id,status,amount_cents,provider_payment_id").eq("environment","sandbox").eq("provider_payment_id",id).maybeSingle();
 if(error)return reply({error:"database_unavailable"},503);
 if(!q)return reply({error:"charge_not_linked"},503);
 if(q.status==="received"||q.status==="applied")return reply({ok:true,duplicate:true});
 const r=await fetch(base+"/payments/"+encodeURIComponent(id),{headers:{access_token:key,"User-Agent":"MARKYS-LICENCAS"},signal:AbortSignal.timeout(15000)});
 if(!r.ok)return reply({error:"provider_unavailable"},503);
 const p=await r.json();
 if(p.id!==id||p.externalReference!==q.id||p.billingType!=="PIX"||Math.round(Number(p.value)*100)!==Number(q.amount_cents)||p.status!=="RECEIVED"){console.warn("Payment verification mismatch",{idMatches:p.id===id,referenceMatches:p.externalReference===q.id,billingTypeMatches:p.billingType==="PIX",amountMatches:Math.round(Number(p.value)*100)===Number(q.amount_cents),status:p.status});return reply({error:"payment_not_verified"},409);}
 const saved=await db.from("markys_asaas_charges").update({status:"received",received_at:new Date().toISOString()}).eq("id",q.id).eq("environment","sandbox").eq("status","pending").select("id").maybeSingle();
 if(saved.error||!saved.data)return reply({error:"storage_error"},503);
 return reply({ok:true,environment:"sandbox",license_renewed:false});
 }catch{return reply({error:"processing_failed"},503);}
});
