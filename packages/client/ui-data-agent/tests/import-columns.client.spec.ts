import { describe, expect, it } from 'vitest'
import { csvColumns } from '../src/client/import-columns.ts'
describe('guided CSV import headers', () => {
  it('preserves quoted separators, escaped quotes, BOM and embedded line breaks', () => {
    expect(csvColumns('\uFEFFid,"claim,amount","say ""yes""","two\nlines"\r\n1,2,3,4', ',', true)).toEqual([
      'id',
      'claim,amount',
      'say "yes"',
      'two\nlines',
    ])
    expect(csvColumns('id;fraud', ';', true)).toEqual(['id', 'fraud'])
  })
  it('rejects incomplete or ambiguous headers before uploading', () => {
    for (const header of ['id,id\n', 'id,\n', 'id,"unfinished', 'id,"closed"extra\n', 'id,un"quoted\n', ''])
      expect(() => csvColumns(header, ',', true)).toThrow('CSV_HEADER_INVALID')
    expect(() => csvColumns('id,fraud', ',', false)).toThrow('CSV_HEADER_INVALID')
    expect(csvColumns('id,fraud\npartial', ',', false)).toEqual(['id', 'fraud'])
  })
})
