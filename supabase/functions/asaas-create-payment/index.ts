import { createClient } from "npm:@supabase/supabase-js@2";
const reply=(body:unknown,status=200)=>new Response(JSON.stringify(body),{status,headers:{"Content-Type":"application/json","Cache-Control":"no-store"}});
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
Deno.serve(async req=>{
 if(req.method!=="POST")return reply({error:"method_not_allowed"},405);
 const auth=req.headers.get("Authorization");
 if(!auth||!/^Bearer [^\s]+$/.test(auth))return reply({error:"unauthorized"},401);
 try{
 const body=await req.json();
 if(typeof body?.plan_id!=="string"||!uuid.test(body.plan_id))return reply({error:"invalid_plan"},400);
 const u=await fetch("https://zdltbzwowkjevhigcgvr.supabase.co/auth/v1/user",{headers:{Authorization:auth,apikey:"sb_publishable_SQpRVwEMwb3anc4tapXGdg_F_OLfYuZ"},signal:AbortSignal.timeout(10000)});
 if(!u.ok)return reply({error:"authentication_failed"},u.status===401||u.status===403?401:503);
 const user=await u.json();
 if(!uuid.test(user.id)||!user.email_confirmed_at)return reply({error:"unauthorized"},401);
 const base=Deno.env.get("ASAAS_API_URL"),key=Deno.env.get("ASAAS_API_KEY");
 if(base!=="https://api-sandbox.asaas.com/v3"||!key)return reply({error:"sandbox_configuration_required"},503);
 const db=createClient(Deno.env.get("SUPABASE_URL")!,Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,{auth:{persistSession:false,autoRefreshToken:false}});
 const {data:q,error}=await db.rpc("markys_asaas_prepare",{p_user:user.id,p_plan:body.plan_id,p_environment:"sandbox"});
 if(error||!q)return reply({error:"charge_unavailable"},409);
 const call=async(path:string,payload?:unknown)=>{
 const r=await fetch(base+path,{method:payload?"POST":"GET",headers:{access_token:key,"Content-Type":"application/json","User-Agent":"MARKYS-LICENCAS"},body:payload?JSON.stringify(payload):undefined,signal:AbortSignal.timeout(15000)});
 if(!r.ok)throw new Error("provider_error");
 return await r.json();
 };
 try{
 const customer=await call("/customers",{name:q.name,email:q.email,cpfCnpj:q.document,externalReference:q.charge_id,notificationDisabled:true});
 if(typeof customer.id!=="string")throw new Error("customer_invalid");
 const dueDate=new Date(Date.now()+86400000).toISOString().slice(0,10);
 const payment=await call("/payments",{customer:customer.id,billingType:"PIX",value:q.amount_cents/100,dueDate,externalReference:q.charge_id,description:"MARKYS PDV MOBILE - TESTE SANDBOX"});
 if(typeof payment.id!=="string")throw new Error("payment_invalid");
 const saved=await db.from("markys_asaas_charges").update({provider_payment_id:payment.id,status:"pending"}).eq("id",q.charge_id).eq("status","creating").select("id").single();
 if(saved.error)throw new Error("storage_error");
 const pix=await call("/payments/"+encodeURIComponent(payment.id)+"/pixQrCode");
 return reply({charge_id:q.charge_id,environment:"sandbox",amount_cents:q.amount_cents,payload:pix.payload,encoded_image:pix.encodedImage,expiration_date:pix.expirationDate});
 }catch{
 // Preserve the open charge on ambiguous failures; reconcile before retrying.
 return reply({error:"charge_requires_reconciliation",charge_id:q.charge_id},503);
 }
 }catch{return reply({error:"request_failed"},503);}
});
