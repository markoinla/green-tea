// Minimal 5-field cron parser. No dependencies.
// Fields: minute hour dayOfMonth month dayOfWeek
// Supports: *, exact values, ranges (1-5), steps (star/15), comma lists (1,3,5)

function parseField(field: string, min: number, max: number): Set<number> {
  const result = new Set<number>()

  for (const part of field.split(',')) {
    const trimmed = part.trim()

    if (trimmed === '*') {
      for (let i = min; i <= max; i++) result.add(i)
      continue
    }

    // Step: */n or range/n
    const stepMatch = trimmed.match(/^(.+)\/(\d+)$/)
    if (stepMatch) {
      const step = parseInt(stepMatch[2], 10)
      let rangeStart = min
      let rangeEnd = max

      if (stepMatch[1] !== '*') {
        const rangeParts = stepMatch[1].split('-')
        rangeStart = parseInt(rangeParts[0], 10)
        if (rangeParts.length === 2) {
          rangeEnd = parseInt(rangeParts[1], 10)
        }
      }

      for (let i = rangeStart; i <= rangeEnd; i += step) {
        result.add(i)
      }
      continue
    }

    // Range: n-m
    const rangeMatch = trimmed.match(/^(\d+)-(\d+)$/)
    if (rangeMatch) {
      const start = parseInt(rangeMatch[1], 10)
      const end = parseInt(rangeMatch[2], 10)
      for (let i = start; i <= end; i++) {
        result.add(i)
      }
      continue
    }

    // Exact value
    const num = parseInt(trimmed, 10)
    if (!isNaN(num)) {
      result.add(num)
    }
  }

  return result
}

export function isValidCron(expression: string): boolean {
  const fields = expression.trim().split(/\s+/)
  if (fields.length !== 5) return false

  const ranges: [number, number][] = [
    [0, 59],
    [0, 23],
    [1, 31],
    [1, 12],
    [0, 6]
  ]

  for (let i = 0; i < 5; i++) {
    try {
      const values = parseField(fields[i], ranges[i][0], ranges[i][1])
      if (values.size === 0) return false
      for (const v of values) {
        if (v < ranges[i][0] || v > ranges[i][1]) return false
      }
    } catch {
      return false
    }
  }

  return true
}

export function cronMatchesNow(expression: string): boolean {
  const now = new Date()
  const fields = expression.trim().split(/\s+/)
  if (fields.length !== 5) return false

  const minute = parseField(fields[0], 0, 59)
  const hour = parseField(fields[1], 0, 23)
  const dayOfMonth = parseField(fields[2], 1, 31)
  const month = parseField(fields[3], 1, 12)
  const dayOfWeek = parseField(fields[4], 0, 6)

  return (
    minute.has(now.getMinutes()) &&
    hour.has(now.getHours()) &&
    dayOfMonth.has(now.getDate()) &&
    month.has(now.getMonth() + 1) &&
    dayOfWeek.has(now.getDay())
  )
}

export function getNextCronTime(expression: string, after: Date): Date | null {
  const fields = expression.trim().split(/\s+/)
  if (fields.length !== 5) return null

  const minute = parseField(fields[0], 0, 59)
  const hour = parseField(fields[1], 0, 23)
  const dayOfMonth = parseField(fields[2], 1, 31)
  const month = parseField(fields[3], 1, 12)
  const dayOfWeek = parseField(fields[4], 0, 6)

  // Start from the next minute after `after`
  const candidate = new Date(after)
  candidate.setSeconds(0, 0)
  candidate.setMinutes(candidate.getMinutes() + 1)

  // Cap search at 1 year (525960 minutes) to avoid infinite loops
  const maxIterations = 525960
  for (let i = 0; i < maxIterations; i++) {
    if (
      minute.has(candidate.getMinutes()) &&
      hour.has(candidate.getHours()) &&
      dayOfMonth.has(candidate.getDate()) &&
      month.has(candidate.getMonth() + 1) &&
      dayOfWeek.has(candidate.getDay())
    ) {
      return candidate
    }
    candidate.setMinutes(candidate.getMinutes() + 1)
  }

  return null
}

export function describeCron(expression: string): string {
  const fields = expression.trim().split(/\s+/)
  if (fields.length !== 5) return expression

  const [minuteF, hourF, domF, monthF, dowF] = fields

  const formatTime = (h: string, m: string): string => {
    const hour = parseInt(h, 10)
    const minute = parseInt(m, 10)
    const ampm = hour >= 12 ? 'PM' : 'AM'
    const h12 = hour === 0 ? 12 : hour > 12 ? hour - 12 : hour
    return `${h12}:${minute.toString().padStart(2, '0')} ${ampm}`
  }

  const dayNames = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']

  // Every N minutes: */N * * * *
  const everyMinMatch = minuteF.match(/^\*\/(\d+)$/)
  if (everyMinMatch && hourF === '*' && domF === '*' && monthF === '*' && dowF === '*') {
    return `Every ${everyMinMatch[1]} minutes`
  }

  // Every N hours: 0 */N * * *
  const everyHourMatch = hourF.match(/^\*\/(\d+)$/)
  if (minuteF.match(/^\d+$/) && everyHourMatch && domF === '*' && monthF === '*' && dowF === '*') {
    return `Every ${everyHourMatch[1]} hours`
  }

  // Specific time patterns
  if (minuteF.match(/^\d+$/) && hourF.match(/^\d+$/)) {
    const time = formatTime(hourF, minuteF)

    // Daily: M H * * *
    if (domF === '*' && monthF === '*' && dowF === '*') {
      return `Daily at ${time}`
    }

    // Specific day of week: M H * * D
    if (domF === '*' && monthF === '*') {
      // Range like 1-5 (weekdays)
      if (dowF === '1-5') return `Weekdays at ${time}`
      if (dowF === '0,6') return `Weekends at ${time}`

      const dayNum = parseInt(dowF, 10)
      if (!isNaN(dayNum) && dayNum >= 0 && dayNum <= 6) {
        return `Every ${dayNames[dayNum]} at ${time}`
      }

      // Comma-separated days
      if (dowF.includes(',')) {
        const days = dowF.split(',').map((d) => {
          const n = parseInt(d.trim(), 10)
          return dayNames[n] || d
        })
        return `${days.join(', ')} at ${time}`
      }
    }
  }

  return expression
}
