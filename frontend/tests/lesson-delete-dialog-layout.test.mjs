import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

const dialog = readFileSync(
    new URL('../components/LessonDeleteDialog.tsx', import.meta.url),
    'utf8',
)

test('delete dialog preserves the full explanatory texts', () => {
    assert.match(dialog, /Dieser Termin gehört zu einer wiederkehrenden iCloud-Serie/)
    assert.match(dialog, /Wähle, welche Termine entfernt werden sollen/)
    assert.match(dialog, /„Alle zukünftigen“ beendet die Wiederholung/)
    assert.match(dialog, /Bereits erteilte oder bezahlte Unterrichtsstunden sind geschützt/)
})

test('destructive buttons never overflow narrow dialog and are stacked', () => {
    assert.match(dialog, /<DialogFooter className="!flex !flex-col !items-stretch gap-3">/)
    assert.equal((dialog.match(/className="w-full min-w-0 h-auto min-h-11/g) || []).length, 3)
    assert.match(dialog, /whitespace-normal text-center leading-snug/)
    assert.match(dialog, /break-words/)
})

test('deletion always requires a deliberate choice, including cancel', () => {
    assert.match(dialog, /Nur diesen Termin löschen/)
    assert.match(dialog, /Diesen und alle zukünftigen löschen/)
    assert.match(dialog, /onConfirm\('this'\)/)
    assert.match(dialog, /onConfirm\('future'\)/)
    assert.match(dialog, /onConfirm\('permanent'\)/)
    assert.match(dialog, /target\?\.canPermanentlyDelete/)
    assert.match(dialog, /Diesen Termin endgültig löschen \(Administrator\)/)
    assert.match(dialog, /onClick=\{onClose\} disabled=\{busy\}/)
    assert.match(dialog, />\s*Abbrechen\s*</)
})
