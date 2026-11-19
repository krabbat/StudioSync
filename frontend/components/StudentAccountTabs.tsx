'use client'

import { useTranslations } from 'next-intl'
import { CalendarDays, FileText, UserRound } from 'lucide-react'

export type AccountSection = 'personal' | 'contract' | 'lessons'

export default function StudentAccountTabs({
    section, onChange, allowed = ['personal', 'contract', 'lessons']
}: {
    section: AccountSection
    onChange: (section: AccountSection) => void
    allowed?: AccountSection[]
}) {
    const t = useTranslations('MyAccount')
    const sections = [
        { id: 'personal' as const, label: t('personal'), icon: UserRound },
        { id: 'contract' as const, label: t('contract'), icon: FileText },
        { id: 'lessons' as const, label: t('lessons'), icon: CalendarDays },
    ].filter(item => allowed.includes(item.id))

    return (
        <nav aria-label={t('title')} className="flex flex-wrap gap-2">
            {sections.map(({ id, label, icon: Icon }) => (
                <button key={id} type="button" aria-pressed={section === id}
                    onClick={() => onChange(id)}
                    className={section === id
                        ? 'inline-flex items-center gap-2 rounded-xl bg-primary px-5 py-3 font-bold text-primary-foreground'
                        : 'inline-flex items-center gap-2 rounded-xl border border-border bg-card px-5 py-3 font-bold text-card-foreground'}>
                    <Icon className="h-4 w-4" />{label}
                </button>
            ))}
        </nav>
    )
}
