'use client'

import { AlertTriangle, Loader2, Trash2 } from 'lucide-react'
import { useEffect, useState } from 'react'
import { useTranslations } from 'next-intl'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogFooter, DialogHeader } from '@/components/ui/dialog'

export type LessonDeleteScope = 'this' | 'future' | 'permanent'
export type LessonCancellationKind = 'student_cancelled' | 'teacher_cancelled'

export interface LessonDeleteTarget {
  id: string
  label: string
  isRecurring: boolean
  canPermanentlyDelete: boolean
  requiresCancellationKind: boolean
}

interface LessonDeleteDialogProps {
  target: LessonDeleteTarget | null
  busy: boolean
  onClose: () => void
  onConfirm: (scope: LessonDeleteScope, cancellationKind?: LessonCancellationKind) => void
}

export default function LessonDeleteDialog({
  target, busy, onClose, onConfirm,
}: LessonDeleteDialogProps) {
  const t = useTranslations('LessonCancellation')
  const [cancellationKind, setCancellationKind] = useState<LessonCancellationKind | ''>('')

  useEffect(() => {
    setCancellationKind('')
  }, [target?.id])

  return (
    <Dialog open={target !== null} onOpenChange={(open) => { if (!open && !busy) onClose() }} size="md">
      <DialogHeader title={t('title')} />
      <DialogContent>
        <div className="space-y-3 text-sm text-gray-700">
          <p><strong>{target?.label}</strong></p>
          <p className="flex gap-2 items-start">
            <AlertTriangle className="w-4 h-4 shrink-0 text-amber-600" />
            {target?.isRecurring
              ? t('recurringExplanation')
              : t('singleExplanation')}
          </p>
          {target?.isRecurring && (
            <p className="text-xs text-gray-500">
              {t('seriesExplanation')}
            </p>
          )}
          {target?.canPermanentlyDelete && (
            <p className="text-xs text-red-700">
              {t('permanentExplanation')}
            </p>
          )}
          {target?.requiresCancellationKind && (
            <div className="space-y-2 rounded-lg border border-gray-200 p-3">
              <label htmlFor="delete-lesson-cancellation-kind" className="block text-sm font-semibold text-gray-800">
                {t('cancellationKind')}
              </label>
              <select
                id="delete-lesson-cancellation-kind"
                value={cancellationKind}
                onChange={e => setCancellationKind(e.target.value as LessonCancellationKind | '')}
                disabled={busy}
                className="w-full rounded-md border border-gray-300 p-2 text-sm"
              >
                <option value="">{t('chooseCancellationKind')}</option>
                <option value="student_cancelled">{t('studentCancelledCredited')}</option>
                <option value="teacher_cancelled">{t('teacherCancelledNotCredited')}</option>
              </select>
              {cancellationKind && (
                <p className="text-xs text-gray-600">
                  {t(cancellationKind === 'teacher_cancelled'
                    ? 'teacherCancellationQuotaNote' : 'studentCancellationQuotaNote')}
                </p>
              )}
              <p className="text-xs text-gray-500">{t('onlyForSingleCancellation')}</p>
            </div>
          )}
        </div>
      </DialogContent>
      <DialogFooter className="!flex !flex-col !items-stretch gap-3">
        <Button type="button" variant="outline" disabled={busy || (Boolean(target?.requiresCancellationKind) && !cancellationKind)}
          className="w-full min-w-0 h-auto min-h-11 py-3 px-4 gap-2 whitespace-normal text-center leading-snug border-red-200 text-red-700 hover:bg-red-50"
          onClick={() => onConfirm('this', cancellationKind || undefined)}>
          {busy ? <Loader2 className="w-4 h-4 shrink-0 animate-spin" /> : <Trash2 className="w-4 h-4 shrink-0" />}
          <span className="min-w-0 break-words">{target?.isRecurring ? t('deleteThis') : t('deleteSingle')}</span>
        </Button>
        {target?.isRecurring && target.canPermanentlyDelete && (
          <Button type="button" variant="outline" disabled={busy}
            className="w-full min-w-0 h-auto min-h-11 py-3 px-4 gap-2 whitespace-normal text-center leading-snug border-red-300 bg-red-50 text-red-800 hover:bg-red-100"
            onClick={() => onConfirm('future')}>
            <Trash2 className="w-4 h-4 shrink-0" />
            <span className="min-w-0 break-words">{t('deleteFuture')}</span>
          </Button>
        )}
        {target?.canPermanentlyDelete && (
          <Button type="button" variant="outline" disabled={busy}
            className="w-full min-w-0 h-auto min-h-11 py-3 px-4 gap-2 whitespace-normal text-center leading-snug border-red-400 text-red-800 hover:bg-red-100"
            onClick={() => onConfirm('permanent')}>
            <Trash2 className="w-4 h-4 shrink-0" />
            <span className="min-w-0 break-words">{t('deletePermanent')}</span>
          </Button>
        )}
        <Button type="button" variant="ghost" onClick={onClose} disabled={busy}
          className="w-full min-h-11 text-gray-600 hover:bg-gray-100">
          {t('cancel')}
        </Button>
      </DialogFooter>
    </Dialog>
  )
}
