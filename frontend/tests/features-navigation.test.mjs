import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

const source = path => readFileSync(new URL('../' + path, import.meta.url), 'utf8')
const page = source('app/dashboard/settings/features/page.tsx')
const sidebar = source('components/Sidebar.tsx')
const context = source('contexts/FeatureFlagContext.tsx')
const types = source('types/setup.ts')
const settings = source('app/dashboard/settings/page.tsx')
const commands = source('components/CommandPalette.tsx')

test('feature settings are German and actually save selections', () => {
    assert.match(page, /<h1[^>]*>Funktionen<\/h1>/)
    assert.match(page, /Bands und Ensembles/)
    assert.match(page, /Auftritte/)
    assert.match(page, /Berichte/)
    assert.match(page, /role="switch"/)
    assert.match(page, /aria-checked=\{active\}/)
    assert.match(page, /api\.patch\('\/core\/setup\/features\/'/)
    assert.match(page, /await refresh\(\)/)
    assert.match(page, />\s*Speichern\s*</)
    assert.match(page, />\s*Verwerfen\s*</)
    assert.doesNotMatch(page, /All features are now enabled by default/)
})

test('bands, performances and reports start hidden independently', () => {
    assert.match(types, /bands_enabled: false/)
    assert.match(types, /gigs_enabled: false/)
    assert.match(types, /analytics_enabled: false/)
    assert.match(types, /gigs_enabled: boolean/)
    assert.match(context, /'gigs_enabled', 'analytics_enabled'/)
    assert.match(sidebar, /href: '\/dashboard\/bands'.*featureFlag: 'bands_enabled'/)
    assert.match(sidebar, /href: '\/dashboard\/gigs'.*featureFlag: 'gigs_enabled'/)
    assert.match(sidebar, /href: '\/dashboard\/reports'.*featureFlag: 'analytics_enabled'/)
})

test('studio builder is no longer linked from navigation', () => {
    assert.doesNotMatch(sidebar, /studioBuilder|\/dashboard\/studio-builder/)
    assert.match(sidebar, /href: '\/dashboard\/users'/)
})

test('hidden reports are also removed from the command palette', () => {
    assert.match(commands, /reports: flags\.analytics_enabled/)
    assert.match(commands, /visibleCommands\.filter/)
    assert.match(settings, /s\.href !== '\/dashboard\/settings\/gig-venues\/' \|\| flags\.gigs_enabled/)
})
