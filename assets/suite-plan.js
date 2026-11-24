/* Positions follow the reference map in plan units. The top entrance gap is
   condensed and the bathrooms, boiler, and storage bays are left empty. */
(() => {
  'use strict';

  const plan = document.getElementById('map-plan');
  const viewport = document.getElementById('map-scroll');
  const jump = document.getElementById('map-jump');
  const frame = {x: 76, y: 118, width: 2984, height: 2078};
  const floorOffset = 96;

  function bounds(x1, y1, x2, y2) {
    return {x: x1, y: y1, width: x2 - x1, height: y2 - y1};
  }

  function place(node, box, parent) {
    Object.assign(node.style, {
      left: `${(box.x - parent.x) / parent.width * 100}%`,
      top: `${(box.y - parent.y) / parent.height * 100}%`,
      width: `${box.width / parent.width * 100}%`,
      height: `${box.height / parent.height * 100}%`
    });
  }

  function area(id, title, box, label, vertical = false) {
    const section = document.createElement('section');
    section.className = `map-area map-area-${id}`;
    section.id = `map-area-${id}`;
    const heading = document.createElement('h2');
    heading.className = vertical ? 'map-area-title map-area-title-vertical' : 'map-area-title';
    heading.id = `${section.id}-title`;
    heading.textContent = title;
    section.setAttribute('aria-labelledby', heading.id);
    place(section, {...box, y: id === 'deck' ? box.y : box.y - floorOffset}, frame);
    place(heading, label, box);
    section.append(heading);
    plan.append(section);
    return {element: section, box};
  }

  function room(zone, id, box) {
    const button = document.createElement('button');
    button.className = 'map-room';
    button.type = 'button';
    button.dataset.room = id;
    const label = id.replace(/([A-Z])(?=\d)/, '$1 ');
    if (box.width < 100) {
      const compactLabel = document.createElement('span');
      compactLabel.className = 'map-compact-label';
      for (const part of label.split(' ')) {
        const text = document.createElement('span');
        text.textContent = part;
        compactLabel.append(text);
      }
      button.append(compactLabel);
    } else {
      button.textContent = label;
    }
    button.setAttribute('aria-label', `${label}, checking room status`);
    place(button, box, zone.box);
    zone.element.append(button);
  }

  function rooms(prefix, start, end) {
    const ascending = start <= end;
    const list = [];
    for (let number = Math.min(start, end); number <= Math.max(start, end); number++) {
      if (number !== 13) list.push(`${prefix}${number}`);
    }
    return ascending ? list : list.reverse();
  }

  function bank(zone, box, ids, axis = 'y', sizes = ids.map(() => 1)) {
    const dimension = axis === 'x' ? 'width' : 'height';
    const total = sizes.reduce((sum, size) => sum + size, 0);
    let next = box[axis];
    ids.forEach((id, index) => {
      const size = box[dimension] * sizes[index] / total;
      room(zone, id, {...box, [axis]: next, [dimension]: size});
      next += size;
    });
  }

  const deck = area('deck', 'X-terior Deck',
    bounds(1647, 118, 3049, 424), bounds(1647, 118, 3049, 185));
  bank(deck, bounds(1647, 185, 3049, 424), rooms('X', 1, 18), 'x');

  const luxTwo = area('lux-two', 'Lux Hall 2',
    bounds(113, 631, 593, 1767), bounds(317, 631, 424, 1767), true);
  bank(luxTwo, bounds(113, 631, 317, 1767), rooms('LQ', 12, 6));
  bank(luxTwo, bounds(424, 631, 593, 1767), rooms('LQ', 14, 20));

  const luxOne = area('lux-one', 'Lux Hall 1',
    bounds(593, 631, 1074, 1767), bounds(779, 631, 914, 1356), true);
  bank(luxOne, bounds(593, 631, 779, 1356), rooms('LK', 4, 1));
  bank(luxOne, bounds(914, 631, 1074, 1356), rooms('LQ', 5, 1));

  const outsideWest = area('outside-west', 'Outside West',
    bounds(1074, 579, 1427, 1767), bounds(1216, 579, 1301, 1767), true);
  const tdSizes = [97, 97, 78, 77, 73, 74, 74, 74, 78, 74, 73, 73, 73, 73];
  bank(outsideWest, bounds(1074, 674, 1145, 1767), rooms('TD', 12, 26), 'y', tdSizes);
  bank(outsideWest, bounds(1145, 674, 1216, 1767), [...rooms('LD', 11, 3), 'LD1'],
    'y', [97, 97, 102, 101, 101, 101, 102, 99, 95, 196]);

  const shortSizes = [98, 98, 97, 98, 97, 97, 98, 98, 97, 170];
  const longSizes = [98, 98, 97, 98, 97, 97, 98, 98, 97, 97, 108, 104];
  bank(outsideWest, bounds(1301, 579, 1427, 1629), rooms('OW', 10, 1), 'y', shortSizes);

  const west = area('west', 'West',
    bounds(1427, 579, 1858, 1767), bounds(1590, 579, 1689, 1767), true);
  bank(west, bounds(1427, 579, 1590, 1629), rooms('W', 10, 1), 'y', shortSizes);
  room(west, 'W11', bounds(1736, 579, 1858, 677));
  bank(west, bounds(1689, 677, 1858, 1767), rooms('W', 12, 23), 'y', longSizes.slice(1));

  const between = area('between', 'In Between',
    bounds(1858, 579, 2376, 1767), bounds(2027, 579, 2110, 1767), true);
  bank(between, bounds(1858, 579, 2027, 1767), rooms('OW', 11, 23), 'y', longSizes);
  bank(between, bounds(2110, 579, 2376, 1629), rooms('OE', 10, 1), 'y', shortSizes);

  const east = area('east', 'East',
    bounds(2376, 579, 3054, 1767), bounds(2544, 579, 2643, 1767), true);
  bank(east, bounds(2376, 579, 2544, 1629), rooms('E', 10, 1), 'y', shortSizes);
  room(east, 'E11', bounds(2690, 579, 2818, 677));
  bank(east, bounds(2643, 677, 2818, 1662), rooms('E', 12, 22), 'y', longSizes.slice(1, -1));
  room(east, 'E23', bounds(2690, 1662, 2818, 1767));
  bank(east, bounds(2818, 579, 3054, 1767), rooms('OE', 11, 23), 'y', longSizes);

  const north = area('north', 'North',
    bounds(76, 1885, 1448, 2283), bounds(76, 2205, 1448, 2283));
  const northBanks = [
    [76, 193, 33, 30], [302, 419, 26, 29], [419, 535, 25, 22],
    [645, 762, 18, 21], [762, 879, 17, 14], [989, 1105, 9, 12],
    [1105, 1222, 8, 5], [1331, 1448, 1, 4]
  ];
  for (const [left, right, start, end] of northBanks) {
    bank(north, bounds(left, 1927, right, 2196), rooms('N', start, end));
  }

  const mini = area('mini', 'Mini Mansions',
    bounds(1491, 1831, 2361, 2286), bounds(1491, 1940, 2361, 2145));
  bank(mini, bounds(1677, 1831, 2135, 1930), rooms('MM', 9, 12), 'x');
  bank(mini, bounds(2135, 1831, 2250, 1930), ['MM17', 'MM14']);
  bank(mini, bounds(2250, 1831, 2361, 1930), ['MM16', 'MM15']);
  bank(mini, bounds(1637, 2162, 1781, 2286), ['MM3', 'MM8']);
  bank(mini, bounds(1781, 2162, 1925, 2286), ['MM2', 'MM7']);
  bank(mini, bounds(1925, 2162, 2215, 2286), ['MM6', 'MM5'], 'x');
  bank(mini, bounds(2215, 2162, 2361, 2286), ['MM1', 'MM4']);

  const cats = area('cats', 'Cat Room',
    bounds(2421, 1837, 3059, 2286), bounds(2577, 1940, 2850, 2230));
  bank(cats, bounds(2424, 2075, 2597, 2281), rooms('CR', 9, 7));
  bank(cats, bounds(2850, 1885, 3054, 2056), ['CR5', 'CR3', 'CR1'], 'x');
  bank(cats, bounds(2850, 2056, 3054, 2227), ['CR6', 'CR4', 'CR2'], 'x');

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

  viewport.addEventListener('keydown', event => {
    if (event.target !== viewport || !['ArrowLeft', 'ArrowRight'].includes(event.key)) return;
    event.preventDefault();
    viewport.scrollBy({left: event.key === 'ArrowLeft' ? -160 : 160});
  });
})();
