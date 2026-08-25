import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, test } from 'vitest';
import discordButtonSrc from '../../components/DiscordButton.tsx?raw';
import { AboutPage } from '../AboutPage';
// Raw sources, for the invariants that are about the words themselves.
import aboutSrc from '../AboutPage.tsx?raw';
import { ContactPage } from '../ContactPage';
import contactSrc from '../ContactPage.tsx?raw';

/**
 * /about and /contact (owner ask 2026-08-21). What matters is not that prose
 * renders: it is that the copy keeps the commitments it was written under
 * (docs/about-page.md), and that the contact channels are the real ones.
 */

describe('AboutPage', () => {
  test('the approval wedge never appears without the calibrated-number clause', () => {
    render(
      <MemoryRouter>
        <AboutPage />
      </MemoryRouter>,
    );
    // AGENTS.md, confirmed 2026-07-12: "approval layer" spoken bare collides
    // with the HITL-approval-queue category. The same sentence must say the
    // approval is priced.
    const pitch = screen.getByText(/approval layer/i);
    expect(pitch.textContent).toMatch(/calibrated number/i);
  });

  test('participant symmetry: the wedge covers humans and AI in the same breath', () => {
    render(
      <MemoryRouter>
        <AboutPage />
      </MemoryRouter>,
    );
    expect(screen.getByText(/approval layer/i).textContent).toMatch(/human or AI/i);
  });

  test('metrics are plural: the handful that decide the most, never "one number"', () => {
    // Owner revision 2026-08-22: "one number is deceiving". A workspace is
    // the metrics that affect decisions the most, not a single number.
    render(
      <MemoryRouter>
        <AboutPage />
      </MemoryRouter>,
    );
    expect(screen.getByText(/handful of metrics that decide the most/i)).toBeTruthy();
    expect(screen.queryByText(/one number/i)).toBeNull();
  });

  test('the vision is present, in the canonical vision.md wording, after the mechanism', () => {
    render(
      <MemoryRouter>
        <AboutPage />
      </MemoryRouter>,
    );
    expect(screen.getByText(/you define what matters and AI does the rest/i)).toBeTruthy();
  });

  test('points at /contact', () => {
    render(
      <MemoryRouter>
        <AboutPage />
      </MemoryRouter>,
    );
    const links = screen.getAllByRole('link').map(a => a.getAttribute('href'));
    expect(links).toContain('/contact');
  });
});

describe('ContactPage', () => {
  test('the email is the one that actually receives mail', () => {
    render(
      <MemoryRouter>
        <ContactPage />
      </MemoryRouter>,
    );
    // support@telarchy.com sends AND receives (agent-economy
    // notes/email-hosting.md, 2026-08-10). floor@telarchy.com only sends.
    const email = screen.getByRole('link', { name: 'support@telarchy.com' });
    expect(email.getAttribute('href')).toBe('mailto:support@telarchy.com');
  });

  test('the Discord invite is the same one the market pages carry', () => {
    const invite = (src: string) => src.match(/https:\/\/discord\.gg\/[A-Za-z0-9]+/)?.[0];
    expect(invite(contactSrc)).toBeDefined();
    expect(invite(contactSrc)).toBe(invite(discordButtonSrc));
  });
});

describe('copy rules', () => {
  test('no em or en dashes in the public prose', () => {
    // Owner style rule: dashes are banned in every file we write.
    expect(aboutSrc).not.toMatch(/[–—]/);
    expect(contactSrc).not.toMatch(/[–—]/);
  });

  test('no "startup", no "floor", no open-source claim shown to a visitor', () => {
    // AGENTS.md canonical positioning + the no-old-UI vocabulary rule.
    for (const src of [aboutSrc, contactSrc]) {
      expect(src).not.toMatch(/startup/i);
      expect(src).not.toMatch(/open[- ]source/i);
    }
    // "floor" is fine in code comments (it names files); never in rendered text.
    render(
      <MemoryRouter>
        <AboutPage />
      </MemoryRouter>,
    );
    expect(screen.queryByText(/floor/i)).toBeNull();
  });
});
