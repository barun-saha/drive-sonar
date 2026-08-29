import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { MantineProvider } from '@mantine/core';
import { PathNav } from './PathNav';

function renderWithMantine(ui: React.ReactNode) {
  return render(<MantineProvider>{ui}</MantineProvider>);
}

describe('PathNav', () => {
  it('renders nothing when ancestors is empty or undefined', () => {
    const { container } = renderWithMantine(
      <PathNav ancestors={[]} onNavigate={vi.fn()} />
    );
    expect(container.querySelector('.mantine-Breadcrumbs-root')).toBeNull();
  });

  it('renders POSIX breadcrumbs and calls onRescan / onNavigate correctly', () => {
    const onNavigate = vi.fn();
    const onRescan = vi.fn();

    const ancestors = [
      { id: 0, name: '/home/user/projects' },
      { id: 1, name: 'drive-sonar' },
    ];

    renderWithMantine(
      <PathNav
        ancestors={ancestors}
        onNavigate={onNavigate}
        onRescan={onRescan}
        isWindows={false}
      />
    );

    // '/' and 'home' and 'user' should be unscanned anchors
    expect(screen.getByText('/')).toBeInTheDocument();
    expect(screen.getByText('home')).toBeInTheDocument();
    expect(screen.getByText('user')).toBeInTheDocument();
    expect(screen.getByText('projects')).toBeInTheDocument();
    // 'drive-sonar' is the last item
    expect(screen.getByText('drive-sonar')).toBeInTheDocument();

    // Click '/' (unscanned posix root)
    fireEvent.click(screen.getByText('/'));
    expect(onRescan).toHaveBeenCalledWith('/');

    // Click 'home' (unscanned path)
    fireEvent.click(screen.getByText('home'));
    expect(onRescan).toHaveBeenCalledWith('/home');

    // Click 'projects' (node 0)
    fireEvent.click(screen.getByText('projects'));
    expect(onNavigate).toHaveBeenCalledWith(0);
  });

  it('renders Windows breadcrumbs and UNC paths correctly', () => {
    const onNavigate = vi.fn();
    const onRescan = vi.fn();

    const winAncestors = [{ id: 10, name: 'C:\\Users\\barun\\Desktop' }];

    renderWithMantine(
      <PathNav
        ancestors={winAncestors}
        onNavigate={onNavigate}
        onRescan={onRescan}
        isWindows={true}
      />
    );

    expect(screen.getByText('C:')).toBeInTheDocument();
    expect(screen.getByText('Users')).toBeInTheDocument();
    expect(screen.getByText('barun')).toBeInTheDocument();
    expect(screen.getByText('Desktop')).toBeInTheDocument();

    fireEvent.click(screen.getByText('Users'));
    expect(onRescan).toHaveBeenCalledWith('C:\\Users');

    // Test UNC path
    const uncAncestors = [{ id: 20, name: '\\\\server\\share\\folder' }];

    renderWithMantine(
      <PathNav
        ancestors={uncAncestors}
        onNavigate={onNavigate}
        onRescan={onRescan}
        isWindows={true}
      />
    );

    expect(screen.getByText('server')).toBeInTheDocument();
    expect(screen.getByText('share')).toBeInTheDocument();
  });

  it('handles fallback single root path when parts splitting yields empty', () => {
    const ancestors = [{ id: 5, name: '' }];
    renderWithMantine(
      <PathNav ancestors={ancestors} onNavigate={vi.fn()} isWindows={false} />
    );
  });
});
