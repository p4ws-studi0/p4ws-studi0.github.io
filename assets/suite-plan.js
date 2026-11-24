/* Room banks are ordered as seen from the top of the lodging plan. */
(() => {
  'use strict';

  const plan = document.getElementById('map-plan');
  const viewport = document.getElementById('map-scroll');
  const jump = document.getElementById('map-jump');

  function element(tag, className, label) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (label) node.textContent = label;
    return node;
  }

  function sequence(prefix, start, end) {
    const step = start <= end ? 1 : -1;
    const rooms = [];
    for (let number = start; number !== end + step; number += step) {
      if (number !== 13) rooms.push(`${prefix}${number}`);
    }
    return rooms;
  }

  function room(id) {
    const label = id.replace(/([A-Z])(?=\d)/, '$1 ');
    const button = element('button', 'map-room', label);
    button.type = 'button';
    button.dataset.room = id;
    button.setAttribute('aria-label', `${label}, checking room status`);
    return button;
  }

  // A nested array places two smaller rooms in one column, as in Mini Mansions.
  function bank(rooms, className = '') {
    const group = element('div', `map-bank ${className}`.trim());
    group.append(...rooms.map(id => Array.isArray(id) ? bank(id, 'map-stack') : room(id)));
    return group;
  }

  function aisle() {
    const path = element('div', 'map-aisle');
    path.setAttribute('aria-hidden', 'true');
    return path;
  }

  function area(id, name, className, content) {
    const zone = element('section', `map-area ${className}`);
    const heading = element('h2', 'map-area-title', name);
    zone.id = `map-area-${id}`;
    heading.id = `${zone.id}-title`;
    zone.setAttribute('aria-labelledby', heading.id);
    zone.append(heading, content);
    return zone;
  }

  function wing(id, title, className, before, after) {
    const layout = element('div', 'map-wing-layout');
    layout.append(...before, aisle(), ...after);
    return area(id, title, `map-wing ${className}`, layout);
  }

  const deck = area('deck', 'X-terior Deck', 'map-deck map-tone-teal',
    bank(sequence('X', 1, 18), 'map-deck-bank'));

  const main = element('div', 'map-main-wing');
  main.append(
    wing('lux-two', 'Lux Hall 2', 'map-tone-violet map-lux-two',
      [bank(sequence('LQ', 12, 6))], [bank(sequence('LQ', 14, 20))]),
    wing('lux-one', 'Lux Hall 1', 'map-tone-violet map-lux-one',
      [bank(sequence('LK', 4, 1))], [bank(sequence('LQ', 5, 1))]),
    wing('outside-west', 'Outside West', 'map-tone-teal map-outside-west',
      [bank(sequence('TD', 12, 26), 'map-service-bank'),
        // The reference shows LD 1 across two bays. Keep one room target.
        bank([...sequence('LD', 11, 3), 'LD1'], 'map-service-bank map-ld-bank')],
      [bank(sequence('OW', 10, 1), 'map-short-bank')]),
    wing('west', 'West', 'map-tone-blue map-west',
      [bank(sequence('W', 10, 1), 'map-short-bank')], [bank(sequence('W', 11, 23))]),
    wing('between', 'In Between', 'map-tone-teal map-between',
      [bank(sequence('OW', 11, 23))], [bank(sequence('OE', 10, 1), 'map-short-bank')]),
    wing('east', 'East', 'map-tone-blue map-east',
      [bank(sequence('E', 10, 1), 'map-short-bank')],
      [bank(sequence('E', 11, 23)), bank(sequence('OE', 11, 23), 'map-east-outside')])
  );

  const north = element('div', 'map-north-layout');
  north.append(
    bank(sequence('N', 33, 30)),
    bank([sequence('N', 26, 29), sequence('N', 25, 22)], 'map-paired-bank'),
    bank([sequence('N', 18, 21), sequence('N', 17, 14)], 'map-paired-bank'),
    bank([sequence('N', 9, 12), sequence('N', 8, 5)], 'map-paired-bank'),
    bank(sequence('N', 1, 4))
  );

  const mini = element('div', 'map-mini-layout');
  mini.append(
    bank(['MM9', 'MM10', 'MM11', 'MM12', ['MM17', 'MM14'], ['MM16', 'MM15']], 'map-mini-top'),
    bank([['MM3', 'MM8'], ['MM2', 'MM7'], 'MM6', 'MM5', ['MM1', 'MM4']], 'map-mini-bottom')
  );

  const cats = element('div', 'map-cat-layout');
  cats.append(
    bank(sequence('CR', 9, 7), 'map-cat-left'),
    aisle(),
    bank(['CR5', 'CR3', 'CR1', 'CR6', 'CR4', 'CR2'], 'map-cat-right')
  );

  const lower = element('div', 'map-lower-wing');
  lower.append(
    area('north', 'North', 'map-tone-blue', north),
    area('mini', 'Mini Mansions', 'map-tone-violet', mini),
    area('cats', 'Cat Room', 'map-tone-rose', cats)
  );

  plan.append(deck, main, lower);

  jump.addEventListener('change', () => {
    const zone = document.getElementById(`map-area-${jump.value}`);
    if (!zone) return;
    zone.scrollIntoView({
      block: 'nearest',
      inline: 'center',
      behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth'
    });
    jump.value = '';
  });

  // The dedicated horizontal scroll region keeps the rest of HQ at normal scale.
  viewport.addEventListener('keydown', event => {
    if (event.target !== viewport || !['ArrowLeft', 'ArrowRight'].includes(event.key)) return;
    event.preventDefault();
    viewport.scrollBy({left: event.key === 'ArrowLeft' ? -160 : 160});
  });
})();
