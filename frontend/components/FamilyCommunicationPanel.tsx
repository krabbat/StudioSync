'use client'

import { useState } from 'react'
import { useTranslations } from 'next-intl'
import StudentCommunicationPanel from '@/components/StudentCommunicationPanel'

type Member={id:string;name:string;is_active?:boolean}
type Contact={name:string;first_name?:string;last_name?:string;email:string}
export default function FamilyCommunicationPanel({familyId,members,contacts}:{familyId:string;members:Member[];contacts:Contact[]}) {
    const t=useTranslations('FamilyCommunication')
    const [filter,setFilter]=useState('all')
    const member=members.find(m=>'student:'+m.id===filter)
    const index=filter.startsWith('contact:')?Number(filter.slice(8)):undefined
    const contact=index===undefined?undefined:contacts[index]
    const query=new URLSearchParams({compose:'1'})
    if(member)query.set('student',member.id)
    else if(contact?.email)query.set('recipient',contact.email)
    else if(index===undefined)query.set('students',members.filter(m=>m.is_active).map(m=>m.id).join(','))
    return <section className="space-y-4">
        <label className="block text-sm font-semibold">{t('filter')}
            <select className="block w-full max-w-md border rounded-lg px-3 py-2 font-normal mt-1" value={filter} onChange={e=>setFilter(e.target.value)}>
                <option value="all">{t('wholeFamily')}</option>
                <optgroup label={t('students')}>{members.map(m=><option key={m.id} value={'student:'+m.id}>{m.name}</option>)}</optgroup>
                <optgroup label={t('contacts')}>{contacts.map((c,i)=><option key={i} value={'contact:'+i}>{[c.first_name,c.last_name].filter(Boolean).join(' ')||c.name}</option>)}</optgroup>
            </select>
        </label>
        <StudentCommunicationPanel key={filter} studentId={member?.id} familyId={member?undefined:familyId} contactIndex={index} composeUrl={'/dashboard/messages?'+query.toString()}/>
    </section>
}
