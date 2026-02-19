interface DiffLine {
  type: 'add' | 'remove' | 'context' | 'header'
  content: string
}

function parseDiffLines(diff: string): DiffLine[] {
  const lines = diff.split('\n')
  const result: DiffLine[] = []

  for (const line of lines) {
    if (line.startsWith('@@')) {
      result.push({ type: 'header', content: line })
    } else if (line.startsWith('+') && !line.startsWith('+++')) {
      result.push({ type: 'add', content: line.slice(1) })
    } else if (line.startsWith('-') && !line.startsWith('---')) {
      result.push({ type: 'remove', content: line.slice(1) })
    } else if (line.startsWith(' ')) {
      result.push({ type: 'context', content: line.slice(1) })
    }
  }

  return result
}

interface DiffPreviewProps {
  diff: string
}

export function DiffPreview({ diff }: DiffPreviewProps) {
  const lines = parseDiffLines(diff)

  if (lines.length === 0) {
    return (
      <div className="text-xs text-muted-foreground italic px-2 py-1">No changes to display.</div>
    )
  }

  return (
    <div className="text-xs font-mono">
      {lines.map((line, i) => {
        let bgClass = ''
        let textClass = 'text-foreground'
        let prefix = ' '

        switch (line.type) {
          case 'add':
            bgClass = 'bg-green-100 dark:bg-green-900/30'
            textClass = 'text-green-800 dark:text-green-300'
            prefix = '+'
            break
          case 'remove':
            bgClass = 'bg-red-100 dark:bg-red-900/30'
            textClass = 'text-red-800 dark:text-red-300'
            prefix = '-'
            break
          case 'header':
            bgClass = 'bg-blue-100 dark:bg-blue-900/20'
            textClass = 'text-blue-700 dark:text-blue-300'
            prefix = ''
            break
          case 'context':
            bgClass = ''
            textClass = 'text-muted-foreground'
            prefix = ' '
            break
        }

        return (
          <div key={i} className={`px-2 py-0 leading-5 ${bgClass} ${textClass}`}>
            {line.type === 'header' ? (
              <span>{line.content}</span>
            ) : (
              <>
                <span className="select-none opacity-50 mr-1">{prefix}</span>
                <span>{line.content}</span>
              </>
            )}
          </div>
        )
      })}
    </div>
  )
}
