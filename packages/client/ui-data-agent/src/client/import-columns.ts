/** CSV header discovery for the guided import; data rows remain in the Worker. */
/** Read one complete CSV header from a bounded, decoded prefix.
 * @param prefix Decoded file prefix (up to 64 KiB).
 * @param delimiter Single-character CSV separator.
 * @param complete Whether the prefix contains the entire file.
 * @returns Unique, nonempty column names, preserving spaces and escaped quotes.
 */
export function csvColumns(prefix: string, delimiter: string, complete: boolean): string[] {
  if (delimiter.length !== 1 || /["\r\n]/.test(delimiter)) throw new Error('CSV_HEADER_INVALID')
  const columns: string[] = []
  let value = '',
    quoted = false,
    closed = false,
    ended = false
  const text = prefix.replace(/^\uFEFF/, '')
  for (let i = 0; i < text.length; i++) {
    const c = text.charAt(i)
    if (quoted) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          value += '"'
          i++
        } else {
          quoted = false
          closed = true
        }
      } else value += c
    } else if (c === delimiter) {
      columns.push(value)
      value = ''
      closed = false
    } else if (c === '\r' || c === '\n') {
      columns.push(value)
      ended = true
      break
    } else if (c === '"' && value === '' && !closed) quoted = true
    else {
      if (closed || c === '"') throw new Error('CSV_HEADER_INVALID')
      value += c
    }
  }
  if (!ended) {
    if (!complete || quoted) throw new Error('CSV_HEADER_INVALID')
    columns.push(value)
  }
  if (columns.some(column => !column || column === '__row_id') || new Set(columns).size !== columns.length)
    throw new Error('CSV_HEADER_INVALID')
  return columns
}
