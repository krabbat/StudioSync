'use client'

import {useEffect,useState} from 'react'
import {useTranslations} from 'next-intl'
import {toast} from 'react-hot-toast'
import {Button} from '@/components/ui/button'
import api from '@/services/api'

type Member={id:string;user_id:string;name:string;birth_date?:string|null}
type Contact={name:string;first_name?:string;last_name?:string;email:string}
type Grant={id:string;user_id:string;name:string;email:string;student_ids:string[];adult_review:string[];revoked:boolean;can_view_communication:boolean;login_enabled:boolean}
export default function FamilyAccessPanel({familyId,members,contacts}:{familyId:string;members:Member[];contacts:Contact[]}) {
    const t=useTranslations('FamilyAccess')
    const [grants,setGrants]=useState<Grant[]>([])
    const [person,setPerson]=useState('')
    const [editId,setEditId]=useState('')
    const [students,setStudents]=useState<string[]>([])
    const [communication,setCommunication]=useState(true)
    const [email,setEmail]=useState('')
    const [password,setPassword]=useState('')
    const [confirm,setConfirm]=useState('')
    const [busy,setBusy]=useState(false)
    const [loaded,setLoaded]=useState(false)
    const base='/core/family-access/'+familyId+'/'
    const load=async()=>{try{const {data}=await api.get(base);setGrants(data);setLoaded(true)}catch{setLoaded(false);toast.error(t('loadError'))}}
    useEffect(()=>{void load()},[familyId])
    const reset=()=>{setEditId('');setPerson('');setStudents([]);setCommunication(true);setEmail('');setPassword('');setConfirm('')}
    const edit=(g:Grant)=>{setEditId(g.id);setPerson('');setStudents(g.student_ids);setCommunication(g.can_view_communication);setEmail(g.email);setPassword('');setConfirm('')}
    const choose=(value:string)=>{setPerson(value);setPassword('');setConfirm('');setEmail(value.startsWith('contact:')?contacts[Number(value.slice(8))]?.email||'':'')}
    const save=async()=>{
        if(password!==confirm){toast.error(t('passwordMismatch'));return}
        setBusy(true)
        try {
            const data={student_ids:students,can_view_communication:communication,...(password?{login_email:email,password,confirm_password:confirm}:{}),...(!editId?(person.startsWith('student:')?{user_id:person.slice(8)}:{contact_index:Number(person.slice(8))}):{})}
            if(editId)await api.put(base+editId+'/',data);else await api.post(base,data)
            reset();await load();toast.success(t('saved'))
        } catch(e:any){const code=e?.response?.data?.code;toast.error(t('error'+(typeof code==='string'&&['password_mismatch','invalid_email','email_unavailable','weak_password','login_required','contact_names_required','grant_exists','invalid_permissions'].includes(code)?'.'+code:'.generic')))}
        finally{setBusy(false)}
    }
    const revoke=async(g:Grant)=>{
        if(!window.confirm(t('confirmRevoke',{name:g.name})))return
        setBusy(true)
        try{await api.delete(base+g.id+'/');reset();await load();toast.success(t('saved'))}catch{toast.error(t('error.generic'))}finally{setBusy(false)}
    }
    return <section className="space-y-4">
        <h3 className="font-semibold">{t('title')}</h3>
        <p className="text-sm text-gray-500">{t('hint')}</p>
        {grants.map(g=><div key={g.id} className="border rounded-lg p-3 space-y-2"><div className="flex flex-wrap justify-between gap-3"><div><strong>{g.name}</strong>{g.revoked&&<span className="ml-2 text-sm text-gray-500">{t('revoked')}</span>}<p className="text-sm">{g.email}</p></div><div className="flex gap-2"><Button variant="outline" onClick={()=>edit(g)}>{t(g.revoked?'reactivate':'edit')}</Button>{!g.revoked&&<Button variant="outline" disabled={busy} onClick={()=>void revoke(g)}>{t('revoke')}</Button>}</div></div><p className="text-sm">{g.student_ids.map(id=>members.find(m=>m.id===id)?.name).filter(Boolean).join(', ')}</p>{g.can_view_communication&&<p className="text-sm">{t('communication')}</p>}{g.adult_review.length>0&&<p className="text-sm text-amber-700">{t('adultReview',{names:g.adult_review.map(id=>members.find(m=>m.id===id)?.name).filter(Boolean).join(', ')})}</p>}</div>)}
        {!grants.length&&loaded&&<p className="text-sm text-gray-500">{t('empty')}</p>}
        <div className="border-t pt-4 space-y-3">
            <h4 className="font-semibold">{t(editId?'edit':'newGrant')}</h4>
            {!editId&&<label className="block text-sm">{t('person')}<select className="block border rounded-lg p-2 w-full" value={person} onChange={e=>choose(e.target.value)}><option value="">{t('choose')}</option><optgroup label={t('students')}>{members.filter(m=>m.user_id&&!grants.some(g=>g.user_id===m.user_id)).map(m=><option key={m.id} value={'student:'+m.user_id}>{m.name}</option>)}</optgroup><optgroup label={t('contacts')}>{contacts.map((c,i)=><option key={i} value={'contact:'+i}>{[c.first_name,c.last_name].filter(Boolean).join(' ')||c.name}</option>)}</optgroup></select></label>}
            {(person||editId)&&<>
                <fieldset className="space-y-2"><legend className="font-medium text-sm">{t('profiles')}</legend>{members.map(m=><label key={m.id} className="flex gap-2 items-center text-sm"><input type="checkbox" checked={students.includes(m.id)} onChange={e=>setStudents(old=>e.target.checked?[...old,m.id]:old.filter(id=>id!==m.id))}/>{m.name}</label>)}</fieldset>
                <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={communication} onChange={e=>setCommunication(e.target.checked)}/>{t('communication')}</label>
                <div className="grid sm:grid-cols-3 gap-3">
                    <label className="text-sm">{t('loginEmail')}<input type="text" inputMode="email" autoComplete="off" className="block border rounded-lg p-2 w-full" value={email} onChange={e=>setEmail(e.target.value)}/></label>
                    <label className="text-sm">{t('password')}<input type="password" autoComplete="new-password" className="block border rounded-lg p-2 w-full" value={password} onChange={e=>setPassword(e.target.value)}/></label>
                    <label className="text-sm">{t('confirmPassword')}<input type="password" autoComplete="new-password" className="block border rounded-lg p-2 w-full" value={confirm} onChange={e=>setConfirm(e.target.value)}/></label>
                </div><p className="text-xs text-gray-500">{t('passwordHint')}</p>
                <div className="flex gap-2"><Button disabled={busy||!loaded||(!students.length&&!communication)||(person.startsWith('contact:')&&(!password||!email))} onClick={()=>void save()}>{t('save')}</Button><Button variant="outline" onClick={reset}>{t('cancel')}</Button></div>
            </>}
        </div>
    </section>
}
