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
const translations = {
    de: JSON.parse(source('messages/de.json')).FeatureSettings,
    en: JSON.parse(source('messages/en.json')).FeatureSettings,
}

test('feature settings are translated through next-intl and persist changes', () => {
    assert.match(page, /useTranslations\('FeatureSettings'\)/)
    assert.match(page, /<h1[^>]*>\{t\('title'\)\}<\/h1>/)
    assert.match(page, /role="switch"/)
    assert.match(page, /aria-checked=\{active\}/)
    assert.match(page, /api\.patch\('\/core\/setup\/features\/'/)
    assert.match(page, /await refresh\(\)/)
    assert.match(page, /\{t\('save'\)\}/)
    assert.match(page, /\{t\('discard'\)\}/)
    assert.doesNotMatch(page, /All features are now enabled by default/)
})

test('all feature options have German and English names and descriptions', () => {
    const features = [
        'billing', 'inventory', 'messaging', 'resources', 'goals',
        'bands', 'gigs', 'reports', 'practiceRooms', 'documentation',
    ]
    for (const language of ['de', 'en']) {
        for (const feature of features) {
            assert.ok(translations[language][feature + 'Name'], language + ': ' + feature + 'Name')
            assert.ok(translations[language][feature + 'Description'], language + ': ' + feature + 'Description')
        }
        for (const key of ['title', 'introduction', 'active', 'inactive', 'enableFeature',
            'disableFeature', 'save', 'discard', 'loading', 'adminOnly',
            'noteAboutVisibility', 'saveSuccess', 'saveError']) {
            assert.ok(translations[language][key], language + ': ' + key)
        }
    }
    assert.match(page, /documentation_enabled: \{ name: t\('documentationName'\), description: t\('documentationDescription'\) \}/)
})

test('bands, gigs, reports and docs start hidden independently', () => {
    assert.match(types, /bands_enabled: false/)
    assert.match(types, /gigs_enabled: false/)
    assert.match(types, /analytics_enabled: false/)
    assert.match(types, /documentation_enabled: false/)
    assert.match(types, /documentation_enabled: boolean/)
    assert.match(context, /'documentation_enabled'/)
    assert.match(sidebar, /href: '\/dashboard\/bands'.*featureFlag: 'bands_enabled'/)
    assert.match(sidebar, /href: '\/dashboard\/gigs'.*featureFlag: 'gigs_enabled'/)
    assert.match(sidebar, /href: '\/dashboard\/reports'.*featureFlag: 'analytics_enabled'/)
    assert.match(sidebar, /href: '\/docs'.*featureFlag: 'documentation_enabled'/)
})

test('studio builder is no longer linked from navigation', () => {
    assert.doesNotMatch(sidebar, /studioBuilder|\/dashboard\/studio-builder/)
    assert.match(sidebar, /href: '\/dashboard\/users'/)
})

test('reports visibility applies to the command palette', () => {
    assert.match(commands, /reports: flags\.analytics_enabled/)
    assert.match(commands, /visibleCommands\.filter/)
    assert.match(settings, /s\.href !== '\/dashboard\/settings\/gig-venues\/' \|\| flags\.gigs_enabled/)
})
