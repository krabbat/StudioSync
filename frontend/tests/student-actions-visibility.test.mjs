import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

const page = readFileSync(new URL('../app/dashboard/students/page.tsx', import.meta.url), 'utf8')

test('student row actions are visible without mouse hover, including on tablets', () => {
    assert.match(page, /<div className="flex items-center justify-end gap-2 opacity-100">/)
    assert.doesNotMatch(page, /opacity-0 group-hover:opacity-100 focus-within:opacity-100/)
    assert.match(page, /aria-label=\{t\('viewProfile'\)\}/)
    assert.match(page, /<Eye className="w-5 h-5" \/>/)
    assert.match(page, /<Edit className="w-4 h-4" \/>/)
})
