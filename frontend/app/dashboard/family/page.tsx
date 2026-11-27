'use client'

import {useEffect,useState} from 'react'
import {useLocale,useTranslations} from 'next-intl'
import {Button} from '@/components/ui/button'
import api from '@/services/api'

type Family={id:string;name:string;communication:boolean;students:{id:string;name:string}[]}
type Detail={name:string;instrument:string;birth_date:string|null;email:string;phone:string;address:string[];contract:{contract_start_date:string;lesson_minutes:number;monthly_amount:string;special_agreements:string}|null;summary:{quota?:number;credited?:number;delivered?:number;remaining?:number}|null;lessons:{id:string;start:string;end:string;status:string}[];invoices:{id:string;number:string;month:string;amount:string;paid:string;status:string}[];resources:{id:string;title:string;has_file:boolean;url:string}[]}
type Message={id:number;subject:string;date:string;from:string;preview:string}
export default function FamilyPortalPage() {
    const t=useTranslations('FamilyAccess')
    const locale=useLocale()
    const [families,setFamilies]=useState<Family[]>([])
    const [familyId,setFamilyId]=useState('')
    const [studentId,setStudentId]=useState('')
    const [detail,setDetail]=useState<Detail|null>(null)
    const [messages,setMessages]=useState<Message[]>([])
    const [message,setMessage]=useState<{subject:string;body:string}|null>(null)
    const [hasMore,setHasMore]=useState(false)
    const [tab,setTab]=useState('profiles')
    const [loading,setLoading]=useState(true)
    const [error,setError]=useState(false)
    const [actionError,setActionError]=useState(false)
    const family=families.find(f=>f.id===familyId)
    const base='/core/family-portal/'+familyId+'/'
    const studentBase=base+'students/'+studentId+'/'
    const money=(v:string|number)=>Number(v).toLocaleString(locale,{style:'currency',currency:'EUR'})
    const date=(v:string)=>v?new Date(v).toLocaleString(locale,{dateStyle:'short',timeStyle:'short'}):'–'
    useEffect(()=>{let alive=true;api.get('/core/family-portal/').then(({data})=>{if(alive){setFamilies(data);setFamilyId(data[0]?.id||'');setStudentId(data[0]?.students[0]?.id||'')}}).catch(()=>{if(alive)setError(true)}).finally(()=>{if(alive)setLoading(false)});return()=>{alive=false}},[])
    useEffect(()=>{if(!familyId||!studentId||tab!=='profiles')return;let alive=true;setDetail(null);setError(false);setLoading(true);api.get(studentBase).then(({data})=>{if(alive)setDetail(data)}).catch(()=>{if(alive)setError(true)}).finally(()=>{if(alive)setLoading(false)});return()=>{alive=false}},[familyId,studentId,tab])
    useEffect(()=>{if(!familyId||tab!=='mail')return;let alive=true;setMessages([]);setMessage(null);setError(false);setLoading(true);api.get(base+'mail/').then(({data})=>{if(alive){setMessages(data.messages);setHasMore(data.has_more)}}).catch(()=>{if(alive)setError(true)}).finally(()=>{if(alive)setLoading(false)});return()=>{alive=false}},[familyId,tab])
    const more=async()=>{try{const {data}=await api.get(base+'mail/',{params:{offset:messages.length}});setMessages(old=>[...old,...data.messages]);setHasMore(data.has_more)}catch{setActionError(true)}}
    const read=async(id:number)=>{setActionError(false);try{const {data}=await api.get(base+'mail/'+id+'/');setMessage(data)}catch{setActionError(true)}}
    const download=async(url:string,name:string)=>{setActionError(false);try{const {data}=await api.get(url,{responseType:'blob'});const src=URL.createObjectURL(data);const a=document.createElement('a');a.href=src;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(src),1000)}catch{setActionError(true)}}
    return <main className="mx-auto max-w-5xl p-4 sm:p-6 space-y-4">
        <h1 className="text-2xl font-bold">{t('portal')}</h1>
        {loading&&!family&&<p>{t('loading')}</p>}{error&&<p role="alert" className="text-red-600">{t('loadError')}</p>}
        {!loading&&!families.length&&!error&&<p>{t('noAccess')}</p>}
        {family&&<>
            <label className="block text-sm">{t('family')}<select className="block border rounded-lg p-2" value={familyId} onChange={e=>{setFamilyId(e.target.value);setStudentId(families.find(f=>f.id===e.target.value)?.students[0]?.id||'');setDetail(null);setMessage(null);setTab('profiles')}}>{families.map(f=><option key={f.id} value={f.id}>{f.name}</option>)}</select></label>
            <nav className="flex gap-3"><Button variant={tab==='profiles'?'default':'outline'} onClick={()=>setTab('profiles')}>{t('profiles')}</Button>{family.communication&&<Button variant={tab==='mail'?'default':'outline'} onClick={()=>setTab('mail')}>{t('communication')}</Button>}</nav>
            {tab==='profiles'&&<><label className="block text-sm">{t('students')}<select className="block border rounded-lg p-2" value={studentId} onChange={e=>{setStudentId(e.target.value);setDetail(null)}}>{family.students.map(s=><option key={s.id} value={s.id}>{s.name}</option>)}</select></label>
                {loading&&<p>{t('loading')}</p>}{!studentId&&<p>{t('noProfiles')}</p>}
                {detail&&<div className="space-y-4">
                    <section className="rounded-xl border p-4"><h2 className="text-lg font-semibold">{detail.name}</h2><p>{detail.instrument}</p><p>{detail.address.filter(Boolean).join(' · ')}</p><p>{detail.email} {detail.phone}</p>{detail.birth_date&&<p>{new Date(detail.birth_date+'T12:00:00').toLocaleDateString(locale)}</p>}</section>
                    <section className="rounded-xl border p-4"><h2 className="font-semibold">{t('contract')}</h2>{detail.contract?<><p>{money(detail.contract.monthly_amount)} / {t('perMonth')} · {detail.contract.lesson_minutes} {t('minutes')}</p><p>{detail.contract.special_agreements}</p></>:<p>{t('noContract')}</p>}{detail.summary&&<p>{t('quotaSummary',{credited:detail.summary.credited??0,quota:detail.summary.quota??0})}</p>}</section>
                    <section className="rounded-xl border p-4"><h2 className="font-semibold">{t('lessons')}</h2>{detail.lessons.map(l=><div key={l.id} className="flex justify-between border-b py-2 text-sm"><span>{date(l.start)}</span><span>{t('lessonStatus.'+(['scheduled','in_progress','completed','cancelled','no_show'].includes(l.status)?l.status:'scheduled'))}</span></div>)}</section>
                    <section className="rounded-xl border p-4"><h2 className="font-semibold">{t('invoices')}</h2>{detail.invoices.map(i=><div key={i.id} className="flex flex-wrap gap-3 items-center justify-between border-b py-2 text-sm"><span>{i.number} · {i.month?.slice(0,7)}</span><span>{money(i.amount)} · {t('paidAmount')}: {money(i.paid)}</span><Button variant="outline" onClick={()=>void download(studentBase+'invoices/'+i.id+'/',i.number+'.pdf')}>PDF</Button></div>)}</section>
                    <section className="rounded-xl border p-4"><h2 className="font-semibold">{t('materials')}</h2>{detail.resources.map(r=><div key={r.id} className="flex justify-between border-b py-2 text-sm"><span>{r.title}</span>{r.has_file?<Button variant="outline" onClick={()=>void download(studentBase+'resources/'+r.id+'/',r.title)}>{t('download')}</Button>:r.url&&/^https?:\/\//i.test(r.url)?<a href={r.url} target="_blank" rel="noopener noreferrer">{t('open')}</a>:null}</div>)}</section>
                </div>}
            </>}
            {tab==='mail'&&family.communication&&<section className="space-y-3">{loading&&<p>{t('loading')}</p>}{message&&<div className="rounded-xl border p-4"><Button variant="outline" onClick={()=>setMessage(null)}>{t('close')}</Button><h2 className="font-bold py-2">{message.subject}</h2><p className="whitespace-pre-wrap break-words">{message.body}</p></div>}{messages.map(m=><button key={m.id} type="button" className="block w-full text-left border rounded-lg p-3" onClick={()=>void read(m.id)}><strong>{m.subject}</strong><p className="text-sm text-gray-500">{m.from} · {date(m.date)}</p><p className="text-sm">{m.preview}</p></button>)}{hasMore&&<Button variant="outline" onClick={()=>void more()}>{t('more')}</Button>}</section>}
            {actionError&&<p role="alert" className="text-red-600">{t('actionError')}</p>}
        </>}
    </main>
}
