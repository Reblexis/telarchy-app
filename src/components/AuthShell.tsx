import type { ReactNode } from 'react';
import { PageTopBar } from './PageTopBar';

/**
 * The frame every door shares: log in, sign up, the waitlist.
 *
 * They used to render the console's `.login-page` card, which was the last
 * old-GUI surface a stranger could still reach (owner decision 2026-08-19:
 * get rid of the old GUI). Now they are posters like the floor itself: the
 * same top bar, the same narrow column, the same Fraunces headline, so
 * signing up does not feel like leaving the product to fill in a form.
 */
export function AuthShell({
  title,
  lead,
  children,
  foot,
}: {
  title: string;
  lead?: ReactNode;
  children: ReactNode;
  foot?: ReactNode;
}) {
  return (
    <div className="pubws">
      <PageTopBar />
      <main className="pubws-main pubws-auth">
        <header className="pubws-hero">
          <h1 className="pubws-name">{title}</h1>
          {lead && <p className="pubws-pitch">{lead}</p>}
        </header>
        <section className="pubws-act">{children}</section>
        {foot && <footer className="pubws-foot">{foot}</footer>}
      </main>
    </div>
  );
}

/** One labelled field in the door's language: a quiet label over a wide
 *  underline, the same register as the trade ticket's own lines. */
export function AuthField({
  id,
  label,
  hint,
  ...input
}: { id: string; label: string; hint?: string } & React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <label className="pubws-field" htmlFor={id}>
      <span className="pubws-field-label">{label}</span>
      <input id={id} className="pubws-field-line" {...input} />
      {hint && <span className="pubws-field-hint">{hint}</span>}
    </label>
  );
}

/** The "or" rule between OAuth and the email form. */
export function AuthOr() {
  return (
    <div className="pubws-or">
      <span>or</span>
    </div>
  );
}
