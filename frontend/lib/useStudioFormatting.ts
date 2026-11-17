'use client'

import { useLocale } from 'next-intl'
import { useUser } from '@/contexts/UserContext'

// Format existing monetary values according to the studio currency.
// This does not perform foreign-exchange conversion.
export function useStudioFormatting() {
  const locale = useLocale()
  const { currentUser } = useUser()
  const configuredCurrency = currentUser?.studio?.currency
  const currency = typeof configuredCurrency === 'string' && /^[A-Z]{3}$/.test(configuredCurrency)
    ? configuredCurrency
    : 'EUR'

  const amountNumber = (value: number | string | null | undefined) => {
    if (typeof value === 'number') return Number.isFinite(value) ? value : 0
    const parsed = Number(String(value ?? 0).replace(/[^0-9.-]/g, ''))
    return Number.isFinite(parsed) ? parsed : 0
  }
  const money = (value: number | string | null | undefined) =>
    new Intl.NumberFormat(locale, { style: 'currency', currency }).format(amountNumber(value))
  const compactMoney = (value: number | string | null | undefined) =>
    new Intl.NumberFormat(locale, { style: 'currency', currency, notation: 'compact', maximumFractionDigits: 1 })
      .format(amountNumber(value))
  const monthLabel = (label: string) => {
    const match = /^([a-zA-Z]{3,9})(.*)$/.exec(label)
    if (!match) return label
    const months = ['jan','feb','mar','apr','may','jun','jul','aug','sep','oct','nov','dec']
    const index = months.indexOf(match[1].slice(0, 3).toLowerCase())
    if (index < 0) return label
    const translated = new Intl.DateTimeFormat(locale, { month: 'short', timeZone: 'UTC' })
      .format(new Date(Date.UTC(2024, index, 1)))
    return translated + match[2]
  }
  return { locale, currency, money, compactMoney, monthLabel }
}
