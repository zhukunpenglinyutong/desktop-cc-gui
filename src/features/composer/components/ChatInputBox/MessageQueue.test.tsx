// @vitest-environment jsdom
import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { MessageQueue } from './MessageQueue';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => key,
  }),
}));

describe('MessageQueue', () => {
  it('truncates long queued content while preserving the full text in the tooltip', () => {
    const longMessage = '1234567890'.repeat(24);

    render(
      <MessageQueue
        queue={[
          {
            id: 'queued-1',
            content: longMessage,
            queuedAt: Date.now(),
          },
        ]}
        onRemove={() => {}}
      />,
    );

    const previewNode = screen.getByTitle(longMessage);
    expect(previewNode.textContent).not.toBe(longMessage);
    expect(previewNode.textContent?.endsWith('…')).toBe(true);
    expect(previewNode.textContent?.length).toBe(120);
    expect(previewNode.getAttribute('aria-label')).toBe(longMessage);
  });

  it('keeps short queued content unchanged', () => {
    render(
      <MessageQueue
        queue={[
          {
            id: 'queued-2',
            content: 'short message',
            queuedAt: Date.now(),
          },
        ]}
        onRemove={() => {}}
      />,
    );

    expect(screen.getByText('short message')).toBeTruthy();
  });
});
