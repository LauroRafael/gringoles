import { Component, type ReactNode } from 'react';
import { STRINGS, type Lang } from '../lib/i18n';

interface Props {
  tabKey: string;
  lang: Lang;
  children: ReactNode;
}

interface State {
  error: Error | null;
}

/** Mostra o erro em vez de tela em branco — facilita diagnosticar. */
export default class TabErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidUpdate(prev: Props) {
    if (prev.tabKey !== this.props.tabKey && this.state.error) {
      this.setState({ error: null });
    }
  }

  render() {
    if (this.state.error) {
      const t = STRINGS[this.props.lang];
      return (
        <div className="max-w-md mx-auto text-center py-14">
          <p className="text-5xl mb-3">⚠️</p>
          <h2 className="font-black text-lg">{t.app_err}</h2>
          <p className="mt-2 text-xs font-mono px-4 py-2 rounded-xl bg-rose-500/10 text-rose-500 break-words">
            {String(this.state.error.message || this.state.error)}
          </p>
          <button
            onClick={() => this.setState({ error: null })}
            className="mt-4 px-5 py-2.5 rounded-2xl bg-sapphire text-white text-sm font-bold"
          >
            {t.app_retry}
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}
