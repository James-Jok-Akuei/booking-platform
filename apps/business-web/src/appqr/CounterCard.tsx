import { Logo } from '../ui/Logo';
import { ShopLogo } from '../ui/ShopLogo';
import { AppQr } from './AppQr';
import type { CardWords } from './cardWords';

/**
 * The counter card (§309): what a customer sees beside the till, on the screen
 * and printed — the shop, what the code is for, the code, three steps. Its
 * words are in the language chosen for the card (`lang`), not the app's.
 */
export function CounterCard({
  words,
  shop,
  logoUrl,
  link,
  lang,
  live = false,
}: {
  words: CardWords;
  shop: string;
  logoUrl: string | null;
  /** Null until there is a link to give (lib/customerApp.ts): the place for the code is kept. */
  link: string | null;
  lang: string;
  /** The light that passes over the code on the screen; never on paper. */
  live?: boolean;
}) {
  return (
    <article className="aq-card" lang={lang}>
      <header className="aq-card-top">
        <ShopLogo logoUrl={logoUrl} name={shop} size={44} />
        <div>
          <strong>{shop}</strong>
          <span>BwanguReservations</span>
        </div>
      </header>
      <div className="aq-card-body">
        <h2>{words.headline}</h2>
        <p className="aq-card-lead">{words.lead}</p>
        <div className={`aq-card-code${live ? ' is-live' : ''}`}>
          {link ? <AppQr text={link} label={words.lead} /> : <span className="aq-code-empty" aria-hidden="true" />}
          {live && link && <span className="aq-scan" aria-hidden="true" />}
        </div>
        <ol className="aq-steps">
          {words.steps.map((step, i) => (
            <li key={i}>
              <b>{i + 1}</b>
              <span>{step}</span>
            </li>
          ))}
        </ol>
        <p className="aq-card-promise">{words.promise}</p>
      </div>
      <footer className="aq-card-foot">
        <Logo size={22} />
        {/* The name, never translated. */}
        <span>
          Bwangu<b>Reservations</b>
        </span>
      </footer>
    </article>
  );
}
