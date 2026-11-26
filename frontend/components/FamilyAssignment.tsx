'use client'
import { useEffect, useState } from 'react'
import api from '@/services/api'
import { Button } from '@/components/ui/button'
import { toast } from 'react-hot-toast'

export default function FamilyAssignment({studentId, familyId, onSaved}: {studentId:string; familyId:string|null; onSaved:(id:string|null,name:string|null)=>void}) {
    const [families,setFamilies] = useState<{id:string;display_name:string}[]>([])
    const [value,setValue] = useState(familyId || '')
    const [saving,setSaving] = useState(false)
    const [loaded,setLoaded] = useState(false)
    useEffect(()=>{setValue(familyId||'')},[familyId])
    useEffect(()=>{api.get('/students/families/').then(({data})=>{setFamilies(data.results||data);setLoaded(true)}).catch(()=>toast.error('Familien konnten nicht geladen werden.'))},[])
    const save = async ()=>{
        setSaving(true)
        try {
            await api.patch('/students/'+studentId+'/', {family:value||null})
            onSaved(value||null,families.find(f=>f.id===value)?.display_name||null)
            toast.success('Familienzugehörigkeit gespeichert.')
        } catch(e:any) {toast.error(e?.response?.data?.family?.[0]||'Familienzuordnung konnte nicht gespeichert werden.')}
        finally {setSaving(false)}
    }
    return <div className="rounded-xl border border-gray-200 bg-white p-4 flex flex-wrap gap-3 items-end">
        <label className="flex-1 min-w-[200px] text-sm font-semibold space-y-1"><span>Familienzugehörigkeit</span>
            <select disabled={!loaded||saving} className="block w-full rounded-lg border border-gray-200 p-2" value={value} onChange={e=>setValue(e.target.value)}>
                <option value="">Keine Familie</option>{families.map(f=><option key={f.id} value={f.id}>{f.display_name}</option>)}
            </select>
        </label>
        <Button disabled={!loaded||saving||value===(familyId||'')} onClick={()=>void save()}>Zuordnung speichern</Button>
    </div>
}
