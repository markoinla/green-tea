import { describe, it, expect, vi, afterEach } from 'vitest'
import { isValidCron, cronMatchesNow, getNextCronTime, describeCron } from './cron'

afterEach(() => {
  vi.useRealTimers()
})

describe('isValidCron', () => {
  it('accepts valid expressions', () => {
    expect(isValidCron('* * * * *')).toBe(true)
    expect(isValidCron('0 9 * * *')).toBe(true)
    expect(isValidCron('*/15 * * * *')).toBe(true)
    expect(isValidCron('0 0 1 1 *')).toBe(true)
    expect(isValidCron('0,30 * * * *')).toBe(true)
    expect(isValidCron('0 9 * * 1-5')).toBe(true)
  })

  it('rejects invalid field counts', () => {
    expect(isValidCron('* * *')).toBe(false)
    expect(isValidCron('* * * * * *')).toBe(false)
    expect(isValidCron('')).toBe(false)
  })

  it('rejects out-of-range values', () => {
    expect(isValidCron('60 * * * *')).toBe(false) // minute 60
    expect(isValidCron('* 24 * * *')).toBe(false) // hour 24
    expect(isValidCron('* * 0 * *')).toBe(false) // day 0
    expect(isValidCron('* * * 13 *')).toBe(false) // month 13
    expect(isValidCron('* * * * 7')).toBe(false) // dow 7
  })
})

describe('cronMatchesNow', () => {
  it('matches when expression covers current time', () => {
    vi.useFakeTimers()
    // Set to 2025-06-15 09:30 (Sunday = 0)
    vi.setSystemTime(new Date(2025, 5, 15, 9, 30, 0))

    expect(cronMatchesNow('30 9 * * *')).toBe(true) // 9:30 any day
    expect(cronMatchesNow('* * * * *')).toBe(true) // every minute
    expect(cronMatchesNow('30 9 15 6 *')).toBe(true) // 9:30 on June 15
  })

  it('does not match when expression does not cover current time', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date(2025, 5, 15, 9, 30, 0))

    expect(cronMatchesNow('0 10 * * *')).toBe(false) // 10:00
    expect(cronMatchesNow('30 9 * * 1')).toBe(false) // Monday only (June 15 2025 is Sunday)
  })

  it('returns false for invalid expression', () => {
    expect(cronMatchesNow('invalid')).toBe(false)
  })
})

describe('getNextCronTime', () => {
  it('finds next occurrence', () => {
    const after = new Date(2025, 0, 1, 8, 55, 0) // Jan 1 08:55
    const next = getNextCronTime('0 9 * * *', after) // Daily at 9:00
    expect(next).not.toBeNull()
    expect(next!.getHours()).toBe(9)
    expect(next!.getMinutes()).toBe(0)
  })

  it('handles midnight crossing', () => {
    const after = new Date(2025, 0, 1, 23, 55, 0) // Jan 1 23:55
    const next = getNextCronTime('30 0 * * *', after) // Daily at 00:30
    expect(next).not.toBeNull()
    expect(next!.getDate()).toBe(2) // Next day
    expect(next!.getHours()).toBe(0)
    expect(next!.getMinutes()).toBe(30)
  })

  it('finds specific day of week', () => {
    // Jan 1 2025 is a Wednesday (3)
    const after = new Date(2025, 0, 1, 0, 0, 0)
    const next = getNextCronTime('0 9 * * 5', after) // Friday at 9:00
    expect(next).not.toBeNull()
    expect(next!.getDay()).toBe(5) // Friday
    expect(next!.getHours()).toBe(9)
  })

  it('returns null for invalid expression', () => {
    expect(getNextCronTime('bad', new Date())).toBeNull()
  })

  it('starts from next minute after given time', () => {
    const after = new Date(2025, 0, 1, 9, 0, 0) // Exactly 9:00
    const next = getNextCronTime('0 9 * * *', after) // Daily at 9:00
    expect(next).not.toBeNull()
    // Should be next day's 9:00, not today's
    expect(next!.getDate()).toBe(2)
  })
})

describe('describeCron', () => {
  it('describes every N minutes', () => {
    expect(describeCron('*/15 * * * *')).toBe('Every 15 minutes')
    expect(describeCron('*/5 * * * *')).toBe('Every 5 minutes')
  })

  it('describes every N hours', () => {
    expect(describeCron('0 */2 * * *')).toBe('Every 2 hours')
  })

  it('describes daily at specific time', () => {
    expect(describeCron('0 9 * * *')).toBe('Daily at 9:00 AM')
    expect(describeCron('30 14 * * *')).toBe('Daily at 2:30 PM')
    expect(describeCron('0 0 * * *')).toBe('Daily at 12:00 AM')
  })

  it('describes weekdays', () => {
    expect(describeCron('0 9 * * 1-5')).toBe('Weekdays at 9:00 AM')
  })

  it('describes weekends', () => {
    expect(describeCron('0 10 * * 0,6')).toBe('Weekends at 10:00 AM')
  })

  it('describes specific day of week', () => {
    expect(describeCron('0 9 * * 1')).toBe('Every Monday at 9:00 AM')
    expect(describeCron('0 9 * * 5')).toBe('Every Friday at 9:00 AM')
  })

  it('returns raw expression for complex patterns', () => {
    expect(describeCron('0 9 1 * *')).toBe('0 9 1 * *')
  })

  it('returns raw expression for invalid input', () => {
    expect(describeCron('bad')).toBe('bad')
  })
})
