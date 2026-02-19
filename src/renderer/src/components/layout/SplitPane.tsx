import { type ReactNode } from 'react'

interface SplitPaneProps {
  left: ReactNode
  right: ReactNode
  leftWidth?: string
  rightWidth?: string
  className?: string
}

export function SplitPane({
  left,
  right,
  leftWidth = 'flex-1',
  rightWidth = 'w-80',
  className = ''
}: SplitPaneProps) {
  return (
    <div className={`flex h-full overflow-hidden ${className}`}>
      <div className={`${leftWidth} min-w-0 overflow-hidden`}>{left}</div>
      <div
        className={`${rightWidth} flex-shrink-0 border-l border-[var(--bg-tertiary)] overflow-hidden`}
      >
        {right}
      </div>
    </div>
  )
}
