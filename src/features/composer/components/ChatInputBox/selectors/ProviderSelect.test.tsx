// @vitest-environment jsdom
import { fireEvent, render } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { ProviderSelect } from './ProviderSelect';

vi.mock('@lobehub/icons', () => ({
  Claude: { Color: () => <span data-testid="mock-claude-icon" /> },
  Gemini: { Color: () => <span data-testid="mock-gemini-icon" /> },
}));

vi.mock('../../../../../assets/model-icons/openai.svg', () => ({
  default: 'mock-openai-icon.svg',
}));

describe('ProviderSelect', () => {
  it('renders an icon-only quick selector trigger', () => {
    const { container } = render(
      <ProviderSelect
        value="codex"
        onChange={vi.fn()}
        iconOnly
      />,
    );

    const trigger = container.querySelector('.selector-provider-button');
    expect(trigger).toBeTruthy();
    expect(container.querySelector('.selector-provider-button .selector-button-text')).toBeFalsy();
  });

  it('shows provider version in quick selector title and dropdown item', () => {
    const { container } = render(
      <ProviderSelect
        value="codex"
        onChange={vi.fn()}
        iconOnly
        providerVersions={{ codex: '0.114.0' }}
      />,
    );

    const trigger = container.querySelector('.selector-provider-button') as HTMLElement;
    expect(trigger.getAttribute('title')).toContain('(0.114.0)');

    fireEvent.click(trigger);

    const dropdown = container.querySelector('.selector-dropdown');
    expect(dropdown?.textContent).toContain('0.114.0');
  });

  it('switches provider from quick selector dropdown', () => {
    const onChange = vi.fn();
    const { container } = render(
      <ProviderSelect
        value="claude"
        onChange={onChange}
        iconOnly
      />,
    );

    const trigger = container.querySelector('.selector-provider-button') as HTMLElement;
    fireEvent.click(trigger);

    const options = container.querySelectorAll('.selector-option');
    fireEvent.click(options[1] as HTMLElement);

    expect(onChange).toHaveBeenCalledWith('codex');
  });
});
