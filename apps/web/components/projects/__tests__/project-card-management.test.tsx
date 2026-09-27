import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ProjectCard } from '../project-card'
import type { Project } from '@/types'

vi.mock('../project-settings-dialog', () => ({
  ProjectSettingsDialog: ({ open }: { open: boolean }) => open ? <div role="dialog">Edit project name</div> : null,
}))
const project = {
  id: 'p1', name: 'Echo Citadel', created_by: 'owner1',
  created_at: '2026-09-27T00:00:00Z', asset_count: 0,
} as Project
afterEach(cleanup)

describe('project management controls', () => {
  it.each([{ isOwner: true }, { project: { ...project, role: 'owner' as const } }])('provides a labelled owner menu without requiring hover', (props) => {
    render(<ProjectCard project={project} {...props} />)
    const trigger = screen.getByRole('button', { name: 'Manage Echo Citadel' })
    expect(trigger).toBeVisible()
    expect(trigger).toHaveAttribute('title', 'Manage project')
    expect(trigger.className).not.toMatch(/opacity-0|group-hover:/)
    expect(trigger.closest('a')).toBeNull()
  })
  it('does not expose management to a viewer or editor', () => {
    const { rerender } = render(<ProjectCard project={{ ...project, role: 'viewer' }} />)
    expect(screen.queryByRole('button', { name: /Manage/ })).not.toBeInTheDocument()
    rerender(<ProjectCard project={{ ...project, role: 'editor' }} />)
    expect(screen.queryByRole('button', { name: /Manage/ })).not.toBeInTheDocument()
  })
  it('opens settings from the menu without navigating into the project', async () => {
    render(<ProjectCard project={project} isOwner />)
    const trigger = screen.getByRole('button', { name: 'Manage Echo Citadel' })
    fireEvent.keyDown(trigger, { key: 'ArrowDown' })
    const settings = await screen.findByRole('menuitem', { name: 'Project Settings' })
    expect(screen.getByRole('menuitem', { name: 'Delete' })).toBeInTheDocument()
    fireEvent.click(settings)
    expect(await screen.findByRole('dialog')).toHaveTextContent('Edit project name')
    expect(screen.getByRole('link', { name: /Echo Citadel/ })).toHaveAttribute('href', '/projects/p1')
  })
})
