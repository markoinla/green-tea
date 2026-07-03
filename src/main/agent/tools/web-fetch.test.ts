import { describe, expect, it } from 'vitest'
import { isBlockedIp, validateFetchUrl } from './web-fetch'

describe('isBlockedIp', () => {
  it('blocks loopback IPv4', () => {
    expect(isBlockedIp('127.0.0.1')).toBe(true)
    expect(isBlockedIp('127.255.255.255')).toBe(true)
  })

  it('blocks private IPv4 ranges', () => {
    expect(isBlockedIp('10.0.0.1')).toBe(true)
    expect(isBlockedIp('10.255.255.255')).toBe(true)
    expect(isBlockedIp('172.16.0.1')).toBe(true)
    expect(isBlockedIp('172.31.255.255')).toBe(true)
    expect(isBlockedIp('192.168.1.1')).toBe(true)
  })

  it('blocks link-local / cloud metadata', () => {
    expect(isBlockedIp('169.254.169.254')).toBe(true)
    expect(isBlockedIp('169.254.0.1')).toBe(true)
  })

  it('blocks the unspecified address', () => {
    expect(isBlockedIp('0.0.0.0')).toBe(true)
  })

  it('allows public IPv4', () => {
    expect(isBlockedIp('8.8.8.8')).toBe(false)
    expect(isBlockedIp('1.1.1.1')).toBe(false)
    expect(isBlockedIp('172.32.0.1')).toBe(false) // just outside 172.16/12
    expect(isBlockedIp('11.0.0.1')).toBe(false) // just outside 10/8
    expect(isBlockedIp('128.0.0.1')).toBe(false) // just outside 127/8
    expect(isBlockedIp('169.255.0.1')).toBe(false) // just outside 169.254/16
  })

  it('blocks loopback and unspecified IPv6', () => {
    expect(isBlockedIp('::1')).toBe(true)
    expect(isBlockedIp('::')).toBe(true)
    expect(isBlockedIp('0:0:0:0:0:0:0:1')).toBe(true)
  })

  it('blocks link-local IPv6 (fe80::/10)', () => {
    expect(isBlockedIp('fe80::1')).toBe(true)
    expect(isBlockedIp('fe80::1%en0')).toBe(true)
    expect(isBlockedIp('febf::1')).toBe(true)
    expect(isBlockedIp('fec0::1')).toBe(false) // outside fe80::/10
  })

  it('blocks unique-local IPv6 (fc00::/7)', () => {
    expect(isBlockedIp('fc00::1')).toBe(true)
    expect(isBlockedIp('fd12:3456::1')).toBe(true)
    expect(isBlockedIp('fe00::1')).toBe(false) // outside fc00::/7
  })

  it('applies IPv4 rules to IPv4-mapped IPv6', () => {
    expect(isBlockedIp('::ffff:127.0.0.1')).toBe(true)
    expect(isBlockedIp('::ffff:169.254.169.254')).toBe(true)
    expect(isBlockedIp('::ffff:8.8.8.8')).toBe(false)
  })

  it('allows public IPv6', () => {
    expect(isBlockedIp('2606:4700::1111')).toBe(false)
  })

  it('fails closed on non-IP input', () => {
    expect(isBlockedIp('not-an-ip')).toBe(true)
    expect(isBlockedIp('')).toBe(true)
  })
})

describe('validateFetchUrl', () => {
  it('allows http and https URLs to public hosts', () => {
    expect(validateFetchUrl('https://example.com/page').ok).toBe(true)
    expect(validateFetchUrl('http://example.com').ok).toBe(true)
    expect(validateFetchUrl('http://8.8.8.8/x').ok).toBe(true)
  })

  it('rejects non-http(s) schemes', () => {
    for (const url of ['file:///etc/passwd', 'ftp://example.com', 'chrome://settings']) {
      const result = validateFetchUrl(url)
      expect(result.ok).toBe(false)
      if (!result.ok) expect(result.error).toContain('scheme')
    }
  })

  it('rejects malformed URLs', () => {
    expect(validateFetchUrl('not a url').ok).toBe(false)
  })

  it('rejects literal internal IPv4 hosts', () => {
    for (const url of [
      'http://127.0.0.1:8080/admin',
      'http://10.0.0.5/',
      'http://172.16.1.1/',
      'http://192.168.0.1/',
      'http://169.254.169.254/latest/meta-data/',
      'http://0.0.0.0:3000/'
    ]) {
      expect(validateFetchUrl(url).ok).toBe(false)
    }
  })

  it('rejects literal internal IPv6 hosts', () => {
    expect(validateFetchUrl('http://[::1]:8080/').ok).toBe(false)
    expect(validateFetchUrl('http://[fe80::1]/').ok).toBe(false)
    expect(validateFetchUrl('http://[fd00::1]/').ok).toBe(false)
  })

  it('allows literal public IP hosts', () => {
    expect(validateFetchUrl('http://[2606:4700::1111]/').ok).toBe(true)
    expect(validateFetchUrl('http://1.1.1.1/').ok).toBe(true)
  })

  it('resolves relative redirect targets against a base and re-validates', () => {
    const base = new URL('https://example.com/a/b')
    const relative = validateFetchUrl('/next', base)
    expect(relative.ok).toBe(true)
    if (relative.ok) expect(relative.url.href).toBe('https://example.com/next')

    expect(validateFetchUrl('http://127.0.0.1/steal', base).ok).toBe(false)
    expect(validateFetchUrl('file:///etc/passwd', base).ok).toBe(false)
  })
})
