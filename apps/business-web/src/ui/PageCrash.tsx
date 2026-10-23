import { Component, type ErrorInfo, type ReactNode } from 'react';
import { t } from '@lingui/core/macro';
import { EmptyState } from './EmptyState';
import { Icon } from './Icon';

/**
 * When a page breaks (§311): instead of a white screen, the unplugged drawing,
 * what to do, and the error itself folded away for our team. Around each page
 * inside the frame (the menu still works, and moving to another page starts
 * afresh), and around the whole app for anything that breaks the frame.
 */
export class PageCrash extends Component<{ children: ReactNode; whole?: boolean }, { error: Error | null }> {
  state: { error: Error | null } = { error: null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('A page stopped working', error, info.componentStack);
  }

  render() {
    const { error } = this.state;
    if (!error) return this.props.children;
    const whole = Boolean(this.props.whole);
    return (
      <div className={`crash${whole ? ' is-whole' : ''}`} role="alert">
        <EmptyState
          art="plug"
          framed={!whole}
          title={t`This page stopped working`}
          text={t`It is not something you did. Try it again — and if it keeps happening, tell us from Help and we will put it right.`}
          below={
            <details className="crash-details">
              <summary>{t`Details for our team`}</summary>
              <code>{error.message || String(error)}</code>
            </details>
          }
        >
          <button
            type="button"
            className="primary"
            onClick={() => (whole ? window.location.reload() : this.setState({ error: null }))}
          >
            <Icon name="refresh" size={18} />
            {t`Try again`}
          </button>
          <button type="button" onClick={() => window.location.assign('/')}>
            <Icon name="overview" size={18} />
            {t`Go to Overview`}
          </button>
        </EmptyState>
      </div>
    );
  }
}
