import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

const list = readFileSync(new URL('../app/dashboard/students/page.tsx', import.meta.url), 'utf8')
const profile = readFileSync(new URL('../app/dashboard/students/[id]/page.tsx', import.meta.url), 'utf8')

test('student names retain their original spelling instead of CSS uppercasing ß to SS', () => {
    const listName = list.match(/<span className="([^"]+)">\{student\.name\}<\/span>/)
    const profileName = profile.match(/<h1 className="([^"]+)">\s*\{fullName\}\s*<\/h1>/)
    assert.ok(listName)
    assert.ok(profileName)
    assert.doesNotMatch(listName[1], /\buppercase\b/)
    assert.doesNotMatch(profileName[1], /\buppercase\b/)
})


test('student email is displayed without forced uppercase', () => {
    const email = list.match(/<span className="([^"]+)">\{student\.email\}<\/span>/)
    assert.ok(email)
    assert.doesNotMatch(email[1], /\buppercase\b/)
})
