// Fetch every DRF page using the existing authenticated relative API endpoint.
export async function fetchAllLibraryPages(getPage) {
    const items = new Map()
    for (let page = 1; ; page++) {
        const data = await getPage(page)
        const results = Array.isArray(data) ? data : data?.results
        if (!Array.isArray(results)) throw new Error('Invalid library response')
        for (const item of results) items.set(item.id, item)
        if (Array.isArray(data) || !data.next) return [...items.values()]
        if (!results.length) throw new Error('Empty intermediate library page')
    }
}

function normalize(value) {
    return String(value ?? '').normalize('NFKC').toLowerCase()
}

function filename(resource) {
    const value = resource.file_url || resource.file || ''
    const name = String(value).split(/[?#]/)[0].split('/').pop() || ''
    try { return decodeURIComponent(name) } catch { return name }
}

export function isGlobalLibraryView(folderId, type, query) {
    return folderId === 'root' || type !== 'all' || Boolean(query.trim())
}

export function filterLibraryResources(resources, folderId, type, query, getCategory) {
    const search = normalize(query.trim())
    const simplified = value => normalize(value).replace(/[_-]+/g, ' ').replace(/\s+/g, ' ')
    const global = isGlobalLibraryView(folderId, type, query)
    return resources.filter(resource => {
        if (!global && resource.folder !== folderId) return false
        if (type !== 'all' && getCategory(resource) !== type) return false
        if (!search) return true
        return [resource.title, resource.description, filename(resource)].some(value =>
            normalize(value).includes(search) || simplified(value).includes(simplified(search)))
    })
}
