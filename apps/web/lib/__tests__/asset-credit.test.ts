import { describe, expect, it } from 'vitest'
import { assetDisplayCredit } from '../asset-credit'
import type { Asset, AssetVersion } from '@/types'

const asset = { created_by: 'owner-id' } as Asset & { latest_version?: AssetVersion | null }

describe('assetDisplayCredit', () => {
  it('shows a verified producer without replacing the uploader ID', () => {
    const credited = {
      ...asset,
      latest_version: { production_credit: 'Elastic 5090' } as AssetVersion,
    }
    expect(assetDisplayCredit(credited, { 'owner-id': 'Vladimir' })).toBe('Elastic 5090')
    expect(credited.created_by).toBe('owner-id')
  })

  it('falls back to the uploader for uncredited versions', () => {
    expect(assetDisplayCredit(asset, { 'owner-id': 'Vladimir' })).toBe('Vladimir')
  })
})
