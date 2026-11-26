import {useEffect,useMemo,useRef,useState} from 'react';
import type {FormEvent} from 'react';
import {supabase,configured} from './client';
import type {Session} from '@supabase/supabase-js';
import {LayoutDashboard,Boxes,Users,KeyRound,Smartphone,Wallet,ScrollText,Settings,LogOut,RefreshCcw,ShieldCheck,Plus,Lock,Unlock} from 'lucide-react';
type RecordData=Record<string,unknown>;
type Section='Início'|'Sistemas'|'Clientes'|'Planos'|'Licenças'|'Dispositivos'|'Financeiro'|'Auditoria'|'Configurações';
const sections:Section[]=['Início','Sistemas','Clientes','Planos','Licenças','Dispositivos','Financeiro','Auditoria','Configurações'];
const icons=[LayoutDashboard,Boxes,Users,KeyRound,ShieldCheck,Smartphone,Wallet,ScrollText,Settings];
const money=(v:unknown)=>(Number(v||0)/100).toLocaleString('pt-BR',{style:'currency',currency:'BRL'});
const date=(v:unknown)=>v?new Date(String(v)).toLocaleDateString('pt-BR'):'—';
const str=(v:unknown)=>String(v??'');
const short=(v:unknown)=>str(v).slice(0,8);
const sectionKey:Record<string,string>={'Sistemas':'products','Clientes':'customers','Planos':'plans','Licenças':'licenses','Dispositivos':'devices','Financeiro':'payments','Auditoria':'audit'};
const fields:Record<string,Array<[string,string,string]>>={
 products:[['name','Nome do sistema','text'],['slug','Identificador (ex.: markys-pdv-mobile)','text'],['active','Ativo','boolean']],
 customers:[['name','Nome do cliente','text'],['email','E-mail','email'],['phone','Telefone','text'],['document','CPF/CNPJ','text'],['notes','Observações','text']],
 plans:[['product_id','Sistema','products'],['name','Nome do plano','text'],['code','Código','text'],['duration_days','Duração em dias (vazio = vitalício)','number'],['price_cents','Preço em centavos','number'],['active','Ativo','boolean']],
 licenses:[['product_id','Sistema','products'],['customer_id','Cliente','customers'],['plan_id','Plano','plans'],['external_user_id','UUID do login no aplicativo','text'],['status','Situação','status'],['starts_at','Início (data ISO)','text'],['expires_at','Vencimento (data ISO; vazio = vitalício)','text'],['device_limit','Limite de dispositivos','number']],
 payments:[['license_id','Licença','licenses'],['amount_cents','Valor em centavos','number'],['due_at','Vencimento (data ISO)','text'],['paid_at','Pago em (data ISO)','text'],['status','Situação','payment_status'],['method','Forma de pagamento','text'],['notes','Observações','text']]
};
const initial:Record<string,RecordData>={products:{active:true},customers:{},plans:{active:true,price_cents:0},licenses:{status:'pending',device_limit:1},payments:{status:'pending',amount_cents:0}};
function description(t:string,row:RecordData){if(t==='products'||t==='customers'||t==='plans')return str(row.name);if(t==='licenses')return short(row.id)+' · '+str(row.status);if(t==='payments')return money(row.amount_cents)+' · '+str(row.status);return short(row.id);}
export default function App(){
 const [session,setSession]=useState<Session|null>(null);
 const activeUser=useRef<string|null>(null);
 const [ready,setReady]=useState(false);
 const [allowed,setAllowed]=useState(false);
 const [email,setEmail]=useState('');
 const [password,setPassword]=useState('');
 const [busy,setBusy]=useState(false);
 const [notice,setNotice]=useState('');
 const [section,setSection]=useState<Section>('Início');
 const [data,setData]=useState<Record<string,RecordData[]>>({});
 const [summary,setSummary]=useState<RecordData>({});
 const [editing,setEditing]=useState<{table:string;value:RecordData}|null>(null);
 const [menu,setMenu]=useState(false);
 const [search,setSearch]=useState('');
 useEffect(()=>{
   supabase.auth.getSession().then(({data})=>{activeUser.current=data.session?.user.id??null;setSession(data.session);setReady(true);}).catch(()=>setReady(true));
   const {data:listener}=supabase.auth.onAuthStateChange((_event,next)=>{const id=next?.user.id??null;if(activeUser.current!==id){activeUser.current=id;setAllowed(false);setData({});}setSession(next);});
   return ()=>listener.subscription.unsubscribe();
 },[]);
 useEffect(()=>{if(session)void refresh();},[session?.user.id]);
 async function refresh(){
   setBusy(true);setNotice('');
   try {
     const admin=await supabase.rpc('markys_is_admin');
     if(admin.error)throw admin.error;
     setAllowed(admin.data===true);
     if(admin.data!==true){setNotice('Conta autenticada, mas sem permissão de administrador.');return;}
     const [d,s]=await Promise.all([supabase.rpc('markys_admin_data'),supabase.rpc('markys_admin_dashboard')]);
     if(d.error)throw d.error;if(s.error)throw s.error;
     setData(d.data as Record<string,RecordData[]>);setSummary(s.data as RecordData);
   } catch(e){setNotice('Falha ao consultar o banco: '+(e instanceof Error?e.message:String(e)));}
   finally{setBusy(false);}
 }
 async function login(e:FormEvent){
   e.preventDefault();setBusy(true);setNotice('');
   const {error}=await supabase.auth.signInWithPassword({email,password});
   if(error)setNotice(error.message);
   setBusy(false);
 }
 async function save(){
   if(!editing)return;setBusy(true);setNotice('');
   try{
     const payload={...editing.value};
     for(const f of fields[editing.table]||[]){
       if(f[2]==='number')payload[f[0]]=payload[f[0]]===''||payload[f[0]]==null?null:Number(payload[f[0]]);
       if(f[2]==='text'&&typeof payload[f[0]]==='string')payload[f[0]]=(payload[f[0]] as string).trim();
     }
     const {error}=await supabase.rpc('markys_admin_save',{p_table:editing.table,p_data:payload});
     if(error)throw error;
     setEditing(null);await refresh();
   }catch(e){setNotice(e instanceof Error?e.message:String(e));}finally{setBusy(false);}
 }
 async function action(id:string,method:'activate'|'block'|'pending'|'reset'){
   const message=method==='reset'?'Remover os vínculos de dispositivos desta licença?':method==='block'?'Bloquear esta licença?':'Alterar a situação da licença?';
   if(!window.confirm(message))return;
   setBusy(true);
   const result=method==='reset'?await supabase.rpc('markys_admin_reset_devices',{p_id:id}):await supabase.rpc('markys_admin_change_license',{p_id:id,p_status:method==='activate'?'active':method==='block'?'blocked':'pending'});
   if(result.error)setNotice(result.error.message);else await refresh();
   setBusy(false);
 }
 const key=sectionKey[section],rows=data[key]||[];
 const filtered=useMemo(()=>rows.filter(row=>(JSON.stringify(row)??'').toLocaleLowerCase('pt-BR').includes(search.toLocaleLowerCase('pt-BR'))),[rows,search]);
 const display=(table:string,id:unknown)=>{const r=(data[table]||[]).find(x=>x.id===id);return r?description(table,r):short(id);};
 if(!configured)return <main className="center"><section className="auth"><h1>MARKYS LICENÇAS</h1><p>Configure as variáveis VITE_SUPABASE_URL e VITE_SUPABASE_PUBLISHABLE_KEY antes de acessar.</p></section></main>;
 if(!ready)return <main className="center">Iniciando MARKYS LICENÇAS…</main>;
 if(!session)return <main className="center"><form className="auth" onSubmit={login}><ShieldCheck size={40}/><h1>MARKYS LICENÇAS</h1><p>Central administrativa privada</p><label>E-mail<input required type="email" value={email} onChange={e=>setEmail(e.target.value)}/></label><label>Senha<input required type="password" value={password} onChange={e=>setPassword(e.target.value)}/></label><button disabled={busy} type="submit">Entrar</button>{notice&&<p className="error">{notice}</p>}</form></main>;
 return <div className="shell">
 <aside className={menu?'sidebar visible':'sidebar'}><div className="logo"><ShieldCheck/><span>MARKYS <b>LICENÇAS</b></span></div><p className="navlabel">ADMINISTRAÇÃO</p><nav>{sections.map((s,i)=>{const Icon=icons[i];return <button key={s} className={section===s?'selected':''} onClick={()=>{setSection(s);setSearch('');setMenu(false);}}><Icon size={19}/>{s}</button>;})}</nav><div className="asidefooter"><span>{session.user.email}</span><button onClick={()=>supabase.auth.signOut()}><LogOut size={17}/>Sair</button></div></aside>
 <div className="workspace"><header><button className="hamburger" onClick={()=>setMenu(!menu)}>☰</button><div><small>PAINEL DE ADMINISTRAÇÃO</small><h1>{section}</h1></div><button className="refresh" onClick={()=>void refresh()} disabled={busy}><RefreshCcw size={17}/>{busy?'Atualizando':'Atualizar'}</button></header>
 <main className="content">
 {notice&&<div className="alert">{notice}</div>}
 {!allowed?<div className="empty"><Lock size={30}/><h3>Acesso restrito</h3><p>Seu usuário ainda não foi habilitado como administrador.</p></div>:
 section==='Início'?<><div className="metrics">{[['Clientes','customers'],['Sistemas','products'],['Licenças','licenses'],['Ativas','active'],['Bloqueadas','blocked'],['Expiradas','expired'],['Pendentes','pending']].map(([label,col])=><div className="metric" key={col}><small>{label}</small><strong>{str(summary[col]||0)}</strong></div>)}<div className="metric"><small>Recebimentos pendentes</small><strong>{money(summary.due_cents)}</strong></div></div><section className="panel"><h2>Central de controle</h2><p>Gerencie sistemas, clientes, planos e licenças em um único ambiente. O bloqueio do aplicativo depende da integração da API com cada produto.</p></section></>:
 section==='Configurações'?<section className="panel"><h2>Segurança administrativa</h2><p>Somente contas incluídas na tabela de administradores podem executar as operações. A chave privilegiada do Supabase nunca deve ser exposta no navegador.</p><p>O login atual: <b>{session.user.email}</b></p></section>:
 <section className="panel"><div className="paneltop"><div><h2>{section}</h2><p>{filtered.length} registro(s)</p></div>{fields[key]&&<button className="primary" onClick={()=>setEditing({table:key,value:{...initial[key]}})}><Plus size={16}/>Novo cadastro</button>}</div><input className="search" placeholder="Pesquisar registros…" value={search} onChange={e=>setSearch(e.target.value)}/><div className="tablewrap"><table><thead><tr><th>Registro</th><th>Detalhes</th><th>Situação</th><th>Ações</th></tr></thead><tbody>{filtered.map((row,i)=><tr key={str(row.id||i)}><td><b>{description(key,row)}</b><small>{short(row.id)}</small></td><td>{key==='licenses'?display('customers',row.customer_id)+' · '+display('products',row.product_id):key==='plans'?display('products',row.product_id):key==='payments'?display('licenses',row.license_id):key==='devices'?display('licenses',row.license_id):key==='audit'?str(row.event):str(row.email||row.code||row.phone||'—')}</td><td><span className={'status '+(str(row.status)==='active'||str(row.status)==='paid'?'green':str(row.status)==='blocked'?'red':'')}>{str(row.status??(row.active===false?'Inativo':'Ativo'))}</span>{Boolean(row.expires_at)&&<small>Até {date(row.expires_at)}</small>}</td><td className="actions">{fields[key]&&<button onClick={()=>setEditing({table:key,value:{...row}})}>Editar</button>}{key==='licenses'&&<><button title="Ativar" onClick={()=>action(str(row.id),'activate')}><Unlock size={15}/></button><button title="Bloquear" onClick={()=>action(str(row.id),'block')}><Lock size={15}/></button><button title="Liberar dispositivos" onClick={()=>action(str(row.id),'reset')}><Smartphone size={15}/></button></>}</td></tr>)}</tbody></table>{filtered.length===0&&<p className="empty">Nenhum registro encontrado.</p>}</div></section>}
 </main></div>
 {editing&&<div className="modalback"><div className="modal"><h2>{editing.value.id?'Editar':'Cadastrar'} {section.toLowerCase()}</h2><div className="formgrid">{fields[editing.table].map(([k,label,type])=><label key={k}>{label}{type==='boolean'?<input type="checkbox" checked={editing.value[k]===true} onChange={e=>setEditing({...editing,value:{...editing.value,[k]:e.target.checked}})}/>:type==='status'||type==='payment_status'?<select value={str(editing.value[k]||'pending')} onChange={e=>setEditing({...editing,value:{...editing.value,[k]:e.target.value}})}>{(type==='status'?['pending','active','blocked']:['pending','paid','overdue','cancelled']).map(v=><option key={v}>{v}</option>)}</select>:['products','customers','plans','licenses'].includes(type)?<select value={str(editing.value[k])} onChange={e=>setEditing({...editing,value:{...editing.value,[k]:e.target.value}})}><option value="">Selecione…</option>{(data[type]||[]).filter(x=>type!=='plans'||!editing.value.product_id||x.product_id===editing.value.product_id).map(r=><option key={str(r.id)} value={str(r.id)}>{description(type,r)}</option>)}</select>:<input type={type} value={str(editing.value[k])} onChange={e=>setEditing({...editing,value:{...editing.value,[k]:e.target.value}})}/>}</label>)}</div><div className="modalactions"><button onClick={()=>setEditing(null)}>Cancelar</button><button className="primary" onClick={save} disabled={busy}>Salvar</button></div></div></div>}
 </div>;
}
