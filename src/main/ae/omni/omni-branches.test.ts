import { describe, expect, it } from 'vitest'
import { parseCreatedBranch, parseOmniBranches, parseOmniValidation } from './omni-branches'

// The stand-in CLI behind omni-service.test.ts answers in the CLI spec's shapes; these
// are the real-world shapes it does not produce.
describe('Omni output readers', () => {
  it("reads validate in the API docs' bare-array shape, so an invalid model is not reported valid", () => {
    expect(
      parseOmniValidation([
        {
          message: 'No view "blob_sales". Set base_view to a valid, existing view.',
          is_warning: false,
          yaml_path: 'blob_sales.topic',
          auto_fix: { description_short: 'Delete topic "blob_sales"' }
        }
      ])
    ).toEqual({
      valid: false,
      issues: [
        {
          message: 'No view "blob_sales". Set base_view to a valid, existing view.',
          severity: 'error',
          yamlPath: 'blob_sales.topic',
          autoFix: 'Delete topic "blob_sales"'
        }
      ]
    })
    expect(parseOmniValidation([{ message: 'No description', is_warning: true }]).valid).toBe(true)
  })

  it('fails create-branch with the API message when Omni answers 200 without a branch', () => {
    expect(() =>
      parseCreatedBranch({ success: false, message: 'Branch name already exists' }, 'feat')
    ).toThrow('Branch name already exists')
  })

  it("finds no branches when the answer does not carry the requested model, rather than another model's", () => {
    const json = {
      records: [{ id: 'other-model', branches: [{ id: 'b-other', name: 'opencx-tickets' }] }]
    }
    expect(parseOmniBranches(json, '11111111-1111-4111-8111-111111111111')).toEqual([])
  })
})
