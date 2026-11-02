import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';

const auth = { user: null, login: vi.fn(), register: vi.fn() };
vi.mock('../context/AuthContext', () => ({ useAuth: () => auth }));
import { LoginPage, RegisterPage } from './AuthPages';

const wrap = (ui) => render(<MemoryRouter>{ui}</MemoryRouter>);
beforeEach(() => vi.clearAllMocks());

describe('LoginPage', () => {
  it('disables submit until both fields are filled, then logs in', async () => {
    auth.login.mockResolvedValue({});
    wrap(<LoginPage />);
    const btn = screen.getByRole('button', { name: 'Log in' });
    expect(btn).toBeDisabled();
    await userEvent.type(screen.getByLabelText('Email'), 'priya@abc.test');
    await userEvent.type(screen.getByLabelText('Password'), 'Password123!');
    await userEvent.click(btn);
    expect(auth.login).toHaveBeenCalledWith('priya@abc.test', 'Password123!');
  });
  it('shows the server error message on failure', async () => {
    auth.login.mockRejectedValue({ response: { status: 401, data: { error: { code: 'INVALID_CREDENTIALS', message: 'Invalid email or password' } } } });
    wrap(<LoginPage />);
    await userEvent.type(screen.getByLabelText('Email'), 'a@b.co');
    await userEvent.type(screen.getByLabelText('Password'), 'wrongwrong');
    await userEvent.click(screen.getByRole('button', { name: 'Log in' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Invalid email or password');
  });
});

describe('RegisterPage', () => {
  it('validates password length and confirmation before calling the API', async () => {
    wrap(<RegisterPage />);
    await userEvent.type(screen.getByLabelText('Full name'), 'Test User');
    await userEvent.type(screen.getByLabelText('Email'), 'test@x.co');
    await userEvent.type(screen.getByLabelText('Password'), 'short');
    await userEvent.type(screen.getByLabelText('Confirm password'), 'short');
    await userEvent.click(screen.getByRole('button', { name: 'Create account' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('at least 8 characters');
    await userEvent.clear(screen.getByLabelText('Password')); await userEvent.type(screen.getByLabelText('Password'), 'longenough1');
    await userEvent.click(screen.getByRole('button', { name: 'Create account' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('do not match');
    expect(auth.register).not.toHaveBeenCalled();
  });
  it('registers with valid input', async () => {
    auth.register.mockResolvedValue({});
    wrap(<RegisterPage />);
    await userEvent.type(screen.getByLabelText('Full name'), 'Test User');
    await userEvent.type(screen.getByLabelText('Email'), 'test@x.co');
    await userEvent.type(screen.getByLabelText('Password'), 'longenough1');
    await userEvent.type(screen.getByLabelText('Confirm password'), 'longenough1');
    await userEvent.click(screen.getByRole('button', { name: 'Create account' }));
    await waitFor(() => expect(auth.register).toHaveBeenCalledWith('Test User', 'test@x.co', 'longenough1'));
  });
});
