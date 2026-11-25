'use client'

import { useEffect, useMemo, useState } from 'react'
import { useTranslations } from 'next-intl'
import {
    BarChart3,
    CalendarDays,
    Check,
    CreditCard,
    FolderOpen,
    FileText,
    Loader2,
    MapPin,
    MessageSquare,
    Package,
    Target,
    Users,
    UserCheck,
    type LucideIcon,
} from 'lucide-react'
import { toast } from 'react-hot-toast'
import { useUser } from '@/contexts/UserContext'
import { useFeatureFlags } from '@/hooks/useFeatureFlags'
import api from '@/services/api'
import type { FeatureFlags } from '@/types/setup'

interface FeatureDefinition {
    key: keyof FeatureFlags
    icon: LucideIcon
}

// Keep feature IDs independent of the selected UI language.
const FEATURES: FeatureDefinition[] = [
    { key: 'billing_enabled', icon: CreditCard },
    { key: 'inventory_enabled', icon: Package },
    { key: 'messaging_enabled', icon: MessageSquare },
    { key: 'resources_enabled', icon: FolderOpen },
    { key: 'goals_enabled', icon: Target },
    { key: 'bands_enabled', icon: Users },
    { key: 'gigs_enabled', icon: MapPin },
    { key: 'analytics_enabled', icon: BarChart3 },
    { key: 'practice_rooms_enabled', icon: CalendarDays },
    { key: 'documentation_enabled', icon: FileText },
    { key: 'teachers_enabled', icon: UserCheck },
]

export default function FeaturesPage() {
    const t = useTranslations('FeatureSettings')
    const featureText: Record<keyof FeatureFlags, { name: string, description: string }> = {
        billing_enabled: { name: t('billingName'), description: t('billingDescription') },
        inventory_enabled: { name: t('inventoryName'), description: t('inventoryDescription') },
        messaging_enabled: { name: t('messagingName'), description: t('messagingDescription') },
        resources_enabled: { name: t('resourcesName'), description: t('resourcesDescription') },
        goals_enabled: { name: t('goalsName'), description: t('goalsDescription') },
        bands_enabled: { name: t('bandsName'), description: t('bandsDescription') },
        gigs_enabled: { name: t('gigsName'), description: t('gigsDescription') },
        analytics_enabled: { name: t('reportsName'), description: t('reportsDescription') },
        practice_rooms_enabled: { name: t('practiceRoomsName'), description: t('practiceRoomsDescription') },
        documentation_enabled: { name: t('documentationName'), description: t('documentationDescription') },
        teachers_enabled: { name: t('teachersName'), description: t('teachersDescription') },
    }
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
            toast.success(t('saveSuccess'))
        } catch (error: any) {
            toast.error(t('saveError'))
        } finally {
            setSaving(false)
        }
    }

    if (userLoading || isLoading || !draft) {
        return (
            <div className="flex min-h-[40vh] items-center justify-center gap-3 text-gray-500">
                <Loader2 className="h-5 w-5 animate-spin" />
                {t('loading')}
            </div>
        )
    }

    if (currentUser?.role !== 'admin') {
        return (
            <div className="mx-auto max-w-3xl px-6 py-12 text-gray-600">
                {t('adminOnly')}
            </div>
        )
    }

    return (
        <div className="mx-auto max-w-4xl px-4 py-8 sm:px-6">
            <header className="mb-7">
                <h1 className="text-3xl font-bold text-gray-900">{t('title')}</h1>
                <p className="mt-2 text-sm leading-relaxed text-gray-600">
                    {t('introduction')}
                </p>
            </header>

            <div className="space-y-3">
                {FEATURES.map(({ key, icon: Icon }) => {
                    const { name, description } = featureText[key]
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
                                    aria-label={t(active ? 'disableFeature' : 'enableFeature', { name })}
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
                                    {active ? t('active') : t('inactive')}
                                </span>
                            </div>
                        </div>
                    )
                })}
            </div>

            <div className="mt-6 flex flex-wrap items-center justify-between gap-4 rounded-xl border border-gray-200 bg-gray-50 p-4">
                <p className="max-w-xl text-sm text-gray-600">
                    {t('noteAboutVisibility')}
                </p>
                <div className="flex gap-2">
                    <button
                        type="button"
                        disabled={!changed || saving}
                        onClick={() => setDraft({ ...flags })}
                        className="rounded-lg border border-gray-300 bg-white px-4 py-2 text-sm font-semibold text-gray-700 disabled:opacity-40"
                    >
                        {t('discard')}
                    </button>
                    <button
                        type="button"
                        disabled={!changed || saving}
                        onClick={() => void save()}
                        className="inline-flex items-center gap-2 rounded-lg bg-blue-600 px-5 py-2 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-40"
                    >
                        {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
                        {t('save')}
                    </button>
                </div>
            </div>
        </div>
    )
}
