import type { DocumentRecord } from '../../src/shared'

/** Physical topic grouping is presentation only; nested owners keep their identities. */
export function researchTopicDirectory(path: string): string {
  const parts = path.split('/')
  const root = parts.indexOf('research')
  return parts.slice(0, root + 2).join('/') + '/'
}

export function researchTopics(documents: readonly DocumentRecord[]) {
  const topics = new Map<string, DocumentRecord>()
  for (const document of documents) {
    if (document.metadata.kind !== 'research') continue
    const directory = researchTopicDirectory(document.path)
    if (!topics.has(directory) || document.path === `${directory}README.md`) topics.set(directory, document)
  }
  return [...topics].map(([directory, document]) => ({ directory, document,
    title: document.path === `${directory}README.md` ? document.metadata.title : directory.split('/').at(-2) ?? directory,
  }))
}
