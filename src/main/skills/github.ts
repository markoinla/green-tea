import { downloadFromGitHub, parseGitHubUrl } from '../util/github-download'

export { parseGitHubUrl }
export type { ParsedGitHubUrl } from '../util/github-download'

/**
 * Download a skill directory from GitHub into `targetDir/<skillName>`. Thin
 * delegate over the generic `downloadFromGitHub` util; behavior is identical.
 */
export async function downloadSkillFromGitHub(url: string, targetDir: string): Promise<string> {
  return downloadFromGitHub(url, targetDir)
}
