'use client'

import { AlertTriangle, Loader2, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogFooter, DialogHeader } from '@/components/ui/dialog'

export type LessonDeleteScope = 'this' | 'future'

export interface LessonDeleteTarget {
  id: string
  label: string
  isRecurring: boolean
}

interface LessonDeleteDialogProps {
  target: LessonDeleteTarget | null
  busy: boolean
  onClose: () => void
  onConfirm: (scope: LessonDeleteScope) => void
}

export default function LessonDeleteDialog({
  target, busy, onClose, onConfirm,
}: LessonDeleteDialogProps) {
  return (
    <Dialog open={target !== null} onOpenChange={(open) => { if (!open && !busy) onClose() }} size="md">
      <DialogHeader title="Unterrichtstermin löschen" />
      <DialogContent>
        <div className="space-y-3 text-sm text-gray-700">
          <p><strong>{target?.label}</strong></p>
          <p className="flex gap-2 items-start">
            <AlertTriangle className="w-4 h-4 shrink-0 text-amber-600" />
            {target?.isRecurring
              ? 'Dieser Termin gehört zu einer wiederkehrenden iCloud-Serie. Wähle, welche Termine entfernt werden sollen.'
              : 'Soll dieser einzelne Termin wirklich dauerhaft gelöscht werden?'}
          </p>
          {target?.isRecurring && (
            <p className="text-xs text-gray-500">
              „Alle zukünftigen“ beendet die Wiederholung ab dem ausgewählten Termin auch in iCloud.
              Bereits erteilte oder bezahlte Unterrichtsstunden sind geschützt.
            </p>
          )}
        </div>
      </DialogContent>
      <DialogFooter className="!flex !flex-col !items-stretch gap-3">
        <Button type="button" variant="outline" disabled={busy}
          className="w-full min-w-0 h-auto min-h-11 py-3 px-4 gap-2 whitespace-normal text-center leading-snug border-red-200 text-red-700 hover:bg-red-50"
          onClick={() => onConfirm('this')}>
          {busy ? <Loader2 className="w-4 h-4 shrink-0 animate-spin" /> : <Trash2 className="w-4 h-4 shrink-0" />}
          <span className="min-w-0 break-words">{target?.isRecurring ? 'Nur diesen Termin löschen' : 'Termin löschen'}</span>
        </Button>
        {target?.isRecurring && (
          <Button type="button" variant="outline" disabled={busy}
            className="w-full min-w-0 h-auto min-h-11 py-3 px-4 gap-2 whitespace-normal text-center leading-snug border-red-300 bg-red-50 text-red-800 hover:bg-red-100"
            onClick={() => onConfirm('future')}>
            <Trash2 className="w-4 h-4 shrink-0" />
            <span className="min-w-0 break-words">Diesen und alle zukünftigen löschen</span>
          </Button>
        )}
        <Button type="button" variant="ghost" onClick={onClose} disabled={busy}
          className="w-full min-h-11 text-gray-600 hover:bg-gray-100">
          Abbrechen
        </Button>
      </DialogFooter>
    </Dialog>
  )
}
