import test from 'node:test'
import assert from 'node:assert/strict'
import { fetchAllLibraryPages, filterLibraryResources } from './materialLibrary.mjs'

const files = [
    { id: '1', folder: null, title: 'Etüde', resource_type: 'pdf' },
    { id: '2', folder: 'piano', title: 'Sonate 1', file_url: '/media/Sonate_1.pdf', resource_type: 'pdf' },
    { id: '3', folder: 'nested', title: 'Hörbeispiel', file_url: '/media/H%C3%B6rbeispiel.mp3', resource_type: 'audio' },
]
const filter = (folder, type, query = '') =>
    filterLibraryResources(files, folder, type, query, r => r.resource_type).map(r => r.id)

test('root lists files in every folder; explicit folder navigation remains scoped', () => {
    assert.deepEqual(filter('root', 'all'), ['1', '2', '3'])
    assert.deepEqual(filter('piano', 'all'), ['2'])
})

test('file type filters search all folders', () => {
    assert.deepEqual(filter('root', 'pdf'), ['1', '2'])
    assert.deepEqual(filter('piano', 'audio'), ['3'])
})

test('search uses title, original stored filename and decoded URL basename', () => {
    assert.deepEqual(filter('piano', 'all', 'Hörbeispiel.mp3'), ['3'])
    assert.deepEqual(filter('root', 'all', 'SONATE_1.PDF'), ['2'])
    assert.deepEqual(filter('root', 'all', 'Sonate_1'), ['2'])
    assert.deepEqual(filter('root', 'audio', 'Sonate'), [])
})

test('loads all pages, even when total exceeds 20', async () => {
    const calls = []
    const result = await fetchAllLibraryPages(async page => {
        calls.push(page)
        return { results: Array.from({ length: page === 1 ? 20 : 3 }, (_, i) => ({ id: (page-1)*20+i })), next: page === 1 ? '/next' : null }
    })
    assert.deepEqual(calls, [1, 2])
    assert.equal(result.length, 23)
})

test('supports unpaginated library response and rejects invalid responses', async () => {
    assert.deepEqual(await fetchAllLibraryPages(async () => files), files)
    await assert.rejects(fetchAllLibraryPages(async () => ({})))
})
