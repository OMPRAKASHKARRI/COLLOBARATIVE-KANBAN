import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { ConfirmDialog, ConnectionBadge, PresenceBar, EmptyState } from './ui';
import { CardBody } from './TaskCard';

describe('ConfirmDialog', () => {
  it('requires explicit confirmation and supports Escape/cancel', async () => {
    const onConfirm = vi.fn(); const onCancel = vi.fn();
    render(<ConfirmDialog title="Delete this task?" message="It will be removed." onConfirm={onConfirm} onCancel={onCancel} />);
    expect(screen.getByRole('dialog', { name: 'Delete this task?' })).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Delete' }));
    expect(onConfirm).toHaveBeenCalledTimes(1);
    await userEvent.keyboard('{Escape}');
    expect(onCancel).toHaveBeenCalled();
  });
});

describe('ConnectionBadge', () => {
  it.each([['connected', 'Live'], ['reconnecting', 'Reconnecting…'], ['denied', 'No access'], ['connecting', 'Connecting…']])('shows %s state', (s, text) => {
    render(<ConnectionBadge status={s} />);
    expect(screen.getByRole('status')).toHaveTextContent(text);
  });
});

describe('PresenceBar', () => {
  it('shows who is online and collapses overflow', () => {
    const online = Array.from({ length: 7 }, (_, i) => ({ id: `u${i}`, name: `User ${i}` }));
    render(<PresenceBar online={online} meId="u0" />);
    expect(screen.getByLabelText('7 online')).toBeInTheDocument();
    expect(screen.getByText('+2')).toBeInTheDocument();
    expect(screen.getByTitle('User 0 (you)')).toBeInTheDocument();
  });
});

describe('TaskCard', () => {
  const base = { id: 't1', title: 'Fix API validation', description: 'Return 422', priority: 'HIGH', dueDate: '2020-01-01T00:00:00.000Z', assignee: { id: 'u1', name: 'Arjun Rao' }, columnId: 'c', position: 0, version: 1 };
  it('shows title, priority, overdue state and assignee; opens on click', async () => {
    const onOpen = vi.fn();
    render(<CardBody task={base} onOpen={onOpen} handleProps={{}} />);
    expect(screen.getByText('High')).toBeInTheDocument();
    expect(screen.getByText(/Overdue/)).toBeInTheDocument();
    expect(screen.getByTitle('Arjun Rao')).toHaveTextContent('AR');
    await userEvent.click(screen.getByRole('button', { name: 'Open task Fix API validation' }));
    expect(onOpen).toHaveBeenCalledWith(base);
  });
  it('hides the drag handle when dragging is disabled and shows unassigned marker', () => {
    render(<CardBody task={{ ...base, assignee: null, dueDate: null }} disabled />);
    expect(screen.queryByRole('button', { name: /^Drag/ })).toBeNull();
    expect(screen.getByTitle('Unassigned')).toBeInTheDocument();
  });
});

describe('EmptyState', () => {
  it('renders guidance and an action', () => {
    render(<EmptyState title="No boards yet" action={<button>Create board</button>}>Create a board to start.</EmptyState>);
    expect(screen.getByText('No boards yet')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Create board' })).toBeInTheDocument();
  });
});
