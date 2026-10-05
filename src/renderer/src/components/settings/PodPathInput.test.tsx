// @vitest-environment happy-dom

import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { PodPathInput } from './PodPathInput'

afterEach(cleanup)

// Why: setup's repo fields start a whole setup run per commit; two runs at once added the
// same Omni repo twice.
describe('PodPathInput', () => {
  it('commits once when Enter is pressed', () => {
    const onCommit = vi.fn()
    render(
      <PodPathInput value="" placeholder="~/Projects/omni" pick="directory" onCommit={onCommit} />
    )
    const input = screen.getByPlaceholderText('~/Projects/omni')
    input.focus()
    fireEvent.change(input, { target: { value: '/repos/omni' } })
    fireEvent.keyDown(input, { key: 'Enter' })

    expect(onCommit).toHaveBeenCalledTimes(1)
    expect(onCommit).toHaveBeenCalledWith('/repos/omni')
  })

  it('commits on blur without Enter', () => {
    const onCommit = vi.fn()
    render(<PodPathInput value="" placeholder="path" pick="file" onCommit={onCommit} />)
    const input = screen.getByPlaceholderText('path')
    fireEvent.change(input, { target: { value: '/bin/dbt' } })
    fireEvent.blur(input)

    expect(onCommit).toHaveBeenCalledTimes(1)
  })
})
