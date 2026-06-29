export interface MarketplacePlugin {
  id: string
  name: string
  description: string
  author: string
  version: string
  path: string
}

const REGISTRY_URL =
  'https://raw.githubusercontent.com/markoinla/green-tea/main/plugins/registry.json'
const CACHE_TTL = 5 * 60 * 1000 // 5 minutes

let cachedRegistry: MarketplacePlugin[] | null = null
let cacheTimestamp = 0

export async function fetchPluginRegistry(forceRefresh?: boolean): Promise<MarketplacePlugin[]> {
  const now = Date.now()
  if (!forceRefresh && cachedRegistry && now - cacheTimestamp < CACHE_TTL) {
    return cachedRegistry
  }

  try {
    const response = await fetch(REGISTRY_URL)
    if (!response.ok) {
      throw new Error(`Failed to fetch registry: ${response.status}`)
    }
    const data: MarketplacePlugin[] = await response.json()
    cachedRegistry = data
    cacheTimestamp = now
    return data
  } catch (err) {
    // Return stale cache if available
    if (cachedRegistry) {
      return cachedRegistry
    }
    throw err
  }
}

export function pluginUrl(entry: MarketplacePlugin): string {
  return `https://github.com/markoinla/green-tea/tree/main/${entry.path}`
}
