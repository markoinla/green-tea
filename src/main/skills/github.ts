import { writeFileSync, mkdirSync } from 'fs'
import { join } from 'path'

interface ParsedGitHubUrl {
  owner: string
  repo: string
  branch: string
  path: string
}

export function parseGitHubUrl(url: string): ParsedGitHubUrl {
  // Match: github.com/{owner}/{repo}/tree/{branch}/{path}
  const treePath = url.match(/github\.com\/([^/]+)\/([^/]+)\/tree\/([^/]+)\/(.+?)\/?\s*$/)
  if (treePath) {
    return { owner: treePath[1], repo: treePath[2], branch: treePath[3], path: treePath[4] }
  }

  // Match: github.com/{owner}/{repo} (repo root — use default branch)
  const repoRoot = url.match(/github\.com\/([^/]+)\/([^/]+?)(\.git)?\/?\s*$/)
  if (repoRoot) {
    return { owner: repoRoot[1], repo: repoRoot[2], branch: '', path: '' }
  }

  throw new Error(
    'Invalid GitHub URL. Expected: https://github.com/{owner}/{repo} or https://github.com/{owner}/{repo}/tree/{branch}/{path}'
  )
}

interface GitHubContentEntry {
  name: string
  type: string
  download_url: string | null
  url: string
}

const defaultHeaders = { Accept: 'application/vnd.github.v3+json' }

async function downloadDirectory(
  apiUrl: string,
  localDir: string,
  headers: Record<string, string>
): Promise<void> {
  const response = await fetch(apiUrl, { headers })

  if (response.status === 403) {
    throw new Error('GitHub API rate limit exceeded. Try again later or use a token.')
  }
  if (!response.ok) {
    throw new Error(`GitHub API error: ${response.status} ${response.statusText}`)
  }

  const contents: GitHubContentEntry[] = await response.json()

  if (!Array.isArray(contents)) {
    throw new Error('Expected a directory URL, but got a single file.')
  }

  mkdirSync(localDir, { recursive: true })

  for (const entry of contents) {
    if (entry.type === 'file' && entry.download_url) {
      const fileResponse = await fetch(entry.download_url)
      if (!fileResponse.ok) {
        throw new Error(`Failed to download ${entry.name}: ${fileResponse.statusText}`)
      }
      const content = await fileResponse.text()
      writeFileSync(join(localDir, entry.name), content, 'utf-8')
    } else if (entry.type === 'dir') {
      await downloadDirectory(entry.url, join(localDir, entry.name), headers)
    }
  }
}

export async function downloadSkillFromGitHub(url: string, targetDir: string): Promise<string> {
  const { owner, repo, branch, path } = parseGitHubUrl(url)

  // For repo root URLs, the skill name is the repo name; for paths, it's the last segment
  const skillName = path ? path.split('/').pop()! : repo

  // Build API URL — omit ref param if no branch specified (uses default branch)
  const contentsPath = path || ''
  const refParam = branch ? `?ref=${branch}` : ''
  const apiUrl = `https://api.github.com/repos/${owner}/${repo}/contents/${contentsPath}${refParam}`
  const skillDir = join(targetDir, skillName)

  await downloadDirectory(apiUrl, skillDir, defaultHeaders)

  return skillName
}
