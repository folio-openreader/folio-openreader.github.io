(() => {
  'use strict';
  const excerpt = document.querySelector('.excerpt');
  const word = document.querySelector('#example-word');
  const gloss = document.querySelector('#example-gloss');
  const announcement = document.querySelector('#demo-announcement');
  if (excerpt && word && gloss && announcement) {
    let selected;
    for (const label of excerpt.querySelectorAll('[data-gloss]')) {
      const button = document.createElement('button');
      const text = label.textContent, meaning = label.dataset.gloss;
      button.type = 'button';
      button.className = 'word';
      button.textContent = text;
      button.setAttribute('aria-controls', 'demo-note');
      const featured = label.hasAttribute('data-featured');
      if (featured) selected = button;
      button.setAttribute('aria-pressed', String(featured));
      button.addEventListener('click', () => {
        selected?.setAttribute('aria-pressed', 'false');
        selected = button;
        button.setAttribute('aria-pressed', 'true');
        word.textContent = text;
        gloss.textContent = meaning;
        announcement.textContent = text + ': ' + meaning + '.';
      });
      label.replaceWith(button);
    }
  }

  const stage = document.querySelector('.book-stage');
  const replay = document.querySelector('.book-replay');
  const preference = window.matchMedia('(prefers-reduced-motion: reduce)');
  if (!stage || !replay || !('IntersectionObserver' in window)) return;

  let inView = false, played = false;
  function play(manual = false) {
    if (preference.matches || document.hidden || (!manual && !inView)) return;
    played = true;
    if (stage.classList.contains('book-playing')) {
      stage.classList.remove('book-playing');
      // Restart the bounded CSS sequence on an explicit replay.
      void stage.offsetWidth;
    }
    stage.classList.add('book-playing');
  }
  function synchronize() {
    replay.hidden = preference.matches;
    if (preference.matches) {
      stage.classList.remove('book-ready', 'book-playing');
      return;
    }
    if (!played) {
      stage.classList.add('book-ready');
      play();
    }
  }
  const observer = new IntersectionObserver(([entry]) => {
    inView = entry.isIntersecting && entry.intersectionRatio >= .42;
    if (inView && !played) play();
  }, {threshold: [0, .42]});
  observer.observe(stage);
  synchronize();
  replay.addEventListener('click', () => play(true));
  document.addEventListener('visibilitychange', () => {
    if (!played) play();
  });
  preference.addEventListener?.('change', synchronize);
})();
