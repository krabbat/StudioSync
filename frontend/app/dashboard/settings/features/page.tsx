'use client'

import { useEffect, useMemo, useState } from 'react'
import {
    BarChart3,
    CalendarDays,
    Check,
    CreditCard,
    FolderOpen,
    Loader2,
    MapPin,
    MessageSquare,
    Package,
    Target,
    Users,
    type LucideIcon,
} from 'lucide-react'
import { toast } from 'react-hot-toast'
import { useUser } from '@/contexts/UserContext'
import { useFeatureFlags } from '@/hooks/useFeatureFlags'
import api from '@/services/api'
import type { FeatureFlags } from '@/types/setup'

interface FeatureDefinition {
    key: keyof FeatureFlags
    name: string
    description: string
    icon: LucideIcon
}

const FEATURES: FeatureDefinition[] = [
    {
        key: 'billing_enabled',
        name: 'Rechnungen und Zahlungen',
        description: 'Rechnungen erstellen, Zahlungen verwalten und offene Beträge überblicken.',
        icon: CreditCard,
    },
    {
        key: 'inventory_enabled',
        name: 'Inventar',
        description: 'Instrumente, Zubehör und weitere Ausstattung verwalten.',
        icon: Package,
    },
    {
        key: 'messaging_enabled',
        name: 'Nachrichten',
        description: 'Kommunikation mit Schülern und Eltern im Nachrichtenbereich.',
        icon: MessageSquare,
    },
    {
        key: 'resources_enabled',
        name: 'Materialbibliothek',
        description: 'Noten, Aufnahmen und Unterrichtsmaterialien bereitstellen.',
        icon: FolderOpen,
    },
    {
        key: 'goals_enabled',
        name: 'Lernziele',
        description: 'Individuelle Lernziele und Fortschritte dokumentieren.',
        icon: Target,
    },
    {
        key: 'bands_enabled',
        name: 'Bands und Ensembles',
        description: 'Ensembles, Gruppen und deren Organisation verwalten.',
        icon: Users,
    },
    {
        key: 'gigs_enabled',
        name: 'Auftritte',
        description: 'Auftritte und Auftrittsorte verwalten – unabhängig von Bands.',
        icon: MapPin,
    },
    {
        key: 'analytics_enabled',
        name: 'Berichte',
        description: 'Berichte und Auswertungen im linken Menü ein- oder ausblenden.',
        icon: BarChart3,
    },
    {
        key: 'practice_rooms_enabled',
        name: 'Übungsräume',
        description: 'Übungsräume und deren Reservierungen verwalten.',
        icon: CalendarDays,
    },
]

export default function FeaturesPage() {
    const { currentUser, isLoading: userLoading } = useUser()
    const { flags, isLoading, refresh } = useFeatureFlags()
    const [draft, setDraft] = useState<FeatureFlags | null>(null)
    const [saving, setSaving] = useState(false)

    useEffect(() => {
        if (!isLoading) setDraft({ ...flags })
    }, [isLoading, flags])

    const changed = useMemo(
        () => draft != null && FEATURES.some(({ key }) => draft[key] !== flags[key]),
        [draft, flags],
    )

    const save = async () => {
        if (!draft || !changed || saving) return
        setSaving(true)
        try {
            // SetupStatus stores the same keys without the _enabled suffix.
            const features_enabled = Object.fromEntries(
                FEATURES.map(({ key }) => [key.replace(/_enabled$/, ''), draft[key]]),
            )
            await api.patch('/core/setup/features/', { features_enabled })
            await refresh()
            toast.success('Funktionseinstellungen gespeichert.')
        } catch (error: any) {
            toast.error(error?.response?.data?.detail || 'Funktionen konnten nicht gespeichert werden.')
        } finally {
            setSaving(false)
        }
    }

    if (userLoading || isLoading || !draft) {
        return (
            <div className="flex min-h-[40vh] items-center justify-center gap-3 text-gray-500">
                <Loader2 className="h-5 w-5 animate-spin" />
                Funktionseinstellungen werden geladen …
            </div>
        )
    }

    if (currentUser?.role !== 'admin') {
        return (
            <div className="mx-auto max-w-3xl px-6 py-12 text-gray-600">
                Nur Administratoren dürfen Funktionen verwalten.
            </div>
        )
    }

    return (
        <div className="mx-auto max-w-4xl px-4 py-8 sm:px-6">
            <header className="mb-7">
                <h1 className="text-3xl font-bold text-gray-900">Funktionen</h1>
                <p className="mt-2 text-sm leading-relaxed text-gray-600">
                    Wähle, welche Funktionen im StudioSync-Menü angezeigt werden sollen.
                    Ausgeblendete Bereiche können hier jederzeit wieder aktiviert werden.
                </p>
            </header>

            <div className="space-y-3">
                {FEATURES.map(({ key, name, description, icon: Icon }) => {
                    const active = draft[key]
                    return (
                        <div
                            key={key}
                            className="flex items-center gap-4 rounded-xl border border-gray-200 bg-white p-4 sm:p-5"
                        >
                            <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg bg-blue-50 text-blue-700">
                                <Icon className="h-5 w-5" aria-hidden="true" />
                            </div>
                            <div className="min-w-0 flex-1">
                                <h2 className="font-semibold text-gray-900">{name}</h2>
                                <p className="mt-0.5 text-sm leading-relaxed text-gray-500">{description}</p>
                            </div>
                            <div className="flex shrink-0 flex-col items-center gap-1.5">
                                <button
                                    type="button"
                                    role="switch"
                                    aria-label={`${name} ${active ? 'deaktivieren' : 'aktivieren'}`}
                                    aria-checked={active}
                                    disabled={saving}
                                    onClick={() => setDraft(previous => previous
                                        ? { ...previous, [key]: !previous[key] }
                                        : previous)}
                                    className={`relative h-7 w-12 rounded-full transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600 disabled:opacity-50 ${active ? 'bg-blue-600' : 'bg-gray-300'}`}
                                >
                                    <span className={`absolute left-1 top-1 h-5 w-5 rounded-full bg-white shadow-sm transition-transform ${active ? 'translate-x-5' : ''}`} />
                                </button>
                                <span className="text-xs font-medium text-gray-500">
                                    {active ? 'Aktiv' : 'Aus'}
                                </span>
                            </div>
                        </div>
                    )
                })}
            </div>

            <div className="mt-6 flex flex-wrap items-center justify-between gap-4 rounded-xl border border-gray-200 bg-gray-50 p-4">
                <p className="max-w-xl text-sm text-gray-600">
                    Die Auswahl betrifft die Navigation, nicht die gespeicherten Daten.
                    Änderungen werden erst mit „Speichern“ übernommen.
                </p>
                <div className="flex gap-2">
                    <button
                        type="button"
                        disabled={!changed || saving}
                        onClick={() => setDraft({ ...flags })}
                        className="rounded-lg border border-gray-300 bg-white px-4 py-2 text-sm font-semibold text-gray-700 disabled:opacity-40"
                    >
                        Verwerfen
                    </button>
                    <button
                        type="button"
                        disabled={!changed || saving}
                        onClick={() => void save()}
                        className="inline-flex items-center gap-2 rounded-lg bg-blue-600 px-5 py-2 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-40"
                    >
                        {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
                        Speichern
                    </button>
                </div>
            </div>
        </div>
    )
}
