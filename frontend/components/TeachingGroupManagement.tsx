'use client'

import {useEffect,useState} from 'react'
import {useTranslations} from 'next-intl'
import {Button} from '@/components/ui/button'
import api from '@/services/api'
import {fetchAllLibraryPages} from '@/lib/materialLibrary.mjs'
import {toast} from 'react-hot-toast'

type Student={id:string;name:string;is_active?:boolean}
type Group={id:string;name:string;members:Student[]}
export default function TeachingGroupManagement(){
    const t=useTranslations('TeachingGroups')
    const [groups,setGroups]=useState<Group[]>([])
    const [students,setStudents]=useState<Student[]>([])
    const [draft,setDraft]=useState<{id?:string;name:string;student_ids:string[]}|null>(null)
    const [search,setSearch]=useState('')
    const [busy,setBusy]=useState(false)
    const [loading,setLoading]=useState(true)
    const [failed,setFailed]=useState(false)
    const load=async()=>{
        setLoading(true);setFailed(false)
        try{
            const [g,s]=await Promise.all([api.get('/students/groups/'),fetchAllLibraryPages(async(page:number)=>(await api.get('/students/',{params:{page}})).data)])
            setGroups(g.data);setStudents(s)
        }catch{setFailed(true)}finally{setLoading(false)}
    }
    useEffect(()=>{void load()},[])
    const save=async()=>{
        if(!draft?.name.trim())return
        setBusy(true)
        try{
            const payload={name:draft.name.trim(),student_ids:draft.student_ids}
            if(draft.id)await api.patch('/students/groups/'+draft.id+'/',payload)
            else await api.post('/students/groups/',payload)
            setDraft(null);await load();toast.success(t('saved'))
        }catch{toast.error(t('saveError'))}finally{setBusy(false)}
    }
    const archive=async()=>{
        if(!draft?.id||!window.confirm(t('confirmArchive',{name:draft.name})))return
        setBusy(true)
        try{await api.delete('/students/groups/'+draft.id+'/');setDraft(null);await load();toast.success(t('saved'))}
        catch{toast.error(t('saveError'))}finally{setBusy(false)}
    }
    return <section className="space-y-5">
        <div className="flex flex-wrap items-center justify-between gap-3"><h1 className="text-xl font-semibold">{t('title')}</h1><Button onClick={()=>{setDraft({name:'',student_ids:[]});setSearch('')}}>{t('new')}</Button></div>
        {loading?<p>{t('loading')}</p>:failed?<div><p>{t('loadError')}</p><Button variant="outline" onClick={()=>void load()}>{t('retry')}</Button></div>:draft?<div className="space-y-4 border rounded-xl p-4">
            <label className="block space-y-1 text-sm">{t('name')}<input className="block w-full rounded-lg border px-3 py-2" value={draft.name} maxLength={200} onChange={e=>setDraft(old=>old?{...old,name:e.target.value}:null)}/></label>
            <h3 className="font-semibold">{t('members')}</h3>
            <div className="divide-y">{draft.student_ids.map(id=><div key={id} className="flex justify-between py-2"><span>{students.find(s=>s.id===id)?.name||groups.find(g=>g.id===draft.id)?.members.find(s=>s.id===id)?.name||id}</span><button className="text-sm underline" onClick={()=>setDraft(old=>old?{...old,student_ids:old.student_ids.filter(x=>x!==id)}:null)}>{t('remove')}</button></div>)}</div>
            <label className="block text-sm">{t('addMembers')}<input className="block w-full rounded-lg border px-3 py-2 mt-1" value={search} placeholder={t('search')} onChange={e=>setSearch(e.target.value)}/></label>
            <div className="max-h-60 overflow-y-auto border rounded-lg p-2">{students.filter(s=>s.is_active&&!draft.student_ids.includes(s.id)&&s.name.toLocaleLowerCase().includes(search.toLocaleLowerCase())).map(s=><label key={s.id} className="flex gap-2 p-2 text-sm"><input type="checkbox" checked={false} onChange={()=>setDraft(old=>old?{...old,student_ids:[...old.student_ids,s.id]}:null)}/>{s.name}</label>)}</div>
            <div className="flex flex-wrap gap-2"><Button disabled={busy||!draft.name.trim()} onClick={()=>void save()}>{t('save')}</Button><Button variant="outline" onClick={()=>setDraft(null)}>{t('cancel')}</Button>{draft.id&&<Button variant="outline" disabled={busy} onClick={()=>void archive()}>{t('archive')}</Button>}</div>
        </div>:<div className="divide-y border rounded-xl">{groups.length?groups.map(g=><button type="button" key={g.id} className="block w-full text-left p-4 hover:bg-muted" onClick={()=>{setDraft({id:g.id,name:g.name,student_ids:g.members.map(s=>s.id)});setSearch('')}}><strong>{g.name}</strong><p className="text-sm text-gray-500">{g.members.map(s=>s.name).join(', ')}</p></button>):<p className="p-4 text-sm text-gray-500">{t('empty')}</p>}</div>}
    </section>
}
