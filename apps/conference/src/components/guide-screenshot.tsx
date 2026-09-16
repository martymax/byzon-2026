'use client';

import { useId, useState } from 'react';
import {
  guideScreenshots,
  type GuideScreenshotId,
} from '../lib/guide-screenshots';
import styles from './guide-screenshot.module.css';

export function GuideScreenshot({
  screenshot,
}: {
  screenshot: GuideScreenshotId;
}) {
  const [device, setDevice] = useState<'laptop' | 'mobile'>('laptop');
  const id = useId();
  const shot = guideScreenshots[screenshot];
  const mobile = `/guides/${screenshot}-mobile.webp`;
  const laptop = `/guides/${screenshot}-laptop.webp`;
  return (
    <figure className={styles.figure} aria-labelledby={`${id}-caption`}>
      <div
        className={styles.switcher}
        role="group"
        aria-label={`Zobrazení ukázky: ${shot.title}`}
      >
        <button
          type="button"
          aria-pressed={device === 'laptop'}
          onClick={() => setDevice('laptop')}
        >
          Notebook
        </button>
        <button
          type="button"
          aria-pressed={device === 'mobile'}
          onClick={() => setDevice('mobile')}
        >
          Mobil
        </button>
      </div>
      <div className={styles.stage}>
        <div className={styles.device} data-device={device}>
          <picture>
            <source
              media="(max-width: 760px)"
              srcSet={mobile}
              width="390"
              height="844"
            />
            {/* Native picture selects only the mobile asset on phones, including before hydration. */}
            <img
              src={device === 'mobile' ? mobile : laptop}
              alt={shot.alt}
              width={device === 'mobile' ? 390 : 1280}
              height={device === 'mobile' ? 844 : 800}
              loading="lazy"
              decoding="async"
            />
          </picture>
        </div>
      </div>
      <figcaption id={`${id}-caption`} className={styles.caption}>
        <strong>{shot.title}</strong>
        <span>
          Ukázka s demonstračními údaji. Obsah vaší konference se může lišit.
        </span>
        <a
          className={styles.desktopLink}
          href={device === 'mobile' ? mobile : laptop}
          target="_blank"
          rel="noopener noreferrer"
        >
          Zvětšit snímek (nová karta)
        </a>
        <a
          className={styles.mobileLink}
          href={mobile}
          target="_blank"
          rel="noopener noreferrer"
        >
          Zvětšit snímek (nová karta)
        </a>
      </figcaption>
    </figure>
  );
}
