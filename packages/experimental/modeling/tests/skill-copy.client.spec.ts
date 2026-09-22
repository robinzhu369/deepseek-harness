import { describe, expect, it } from 'vitest'
import { en, zh } from '../src/client/locales.ts'

describe('Skill Center localized guides', () => {
  it('provides Chinese names, descriptions, and guides for all five runtime Skills', () => {
    const names = ['data-analysis', 'data-cleaning', 'feature-engineering', 'model-training', 'model-evaluation'] as const
    const copy = names.map(name => ({
      name: zh[`skill.${name}`], description: zh[`skills.description.${name}`], guide: zh[`skills.guide.${name}`],
    }))
    for (const item of copy) {
      expect(item.name).toMatch(/[\u4e00-\u9fff]/u)
      expect(item.description).toMatch(/[\u4e00-\u9fff]/u)
      expect(item.guide).toContain('输入：')
      expect(item.guide).toContain('输出：')
    }
    expect({ copy, notice: zh['skills.guideNotice'], source: zh['skills.source'] }).toMatchSnapshot()
    expect(Object.keys(en).sort()).toEqual(Object.keys(zh).sort())
  })
})
