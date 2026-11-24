(() => {
  'use strict';

  const rooms = [...document.querySelectorAll('.map-room[data-room]')];
  const status = document.getElementById('map-status');
  const tooltip = document.getElementById('map-tooltip');
  const mapScroll = document.getElementById('map-scroll');
  const client = typeof supabaseClient === 'undefined' ? null : supabaseClient;
  const refreshInterval = 60000;
  const maxSnapshotAge = 120000;
  const cleanText = value => typeof value === 'string' ? value.trim() : '';
  const normalizeRoom = value => cleanText(value).replace(/\s+/g, '').toUpperCase();
  const roomName = room => room.dataset.room.replace(/([A-Z])(?=\d)/, '$1 ');
  const knownRooms = new Set(rooms.map(room => normalizeRoom(room.dataset.room)));
  const recordsFor = room => recordsByRoom.get(normalizeRoom(room.dataset.room)) || [];

  let recordsByRoom = new Map();
  let sourceState = 'loading';
  let activeRoom = null;
  let activation = null;
  let hideDelay;
  let rebuildingTooltip = false;
  let skipFocusRoom = null;
  let userId;
  let accessBlocked = false;
  let pageActive = true;
  let flight = null;
  let lastAttempt = -Infinity;
  let expiresAt = 0;

  function reservationUrl(record) {
    const id = record.reservationId;
    if (!/^[1-9]\d{0,19}$/.test(id)) return '';
    return `https://pawspet.gingrapp.com/reservations/edit/id/${id}`;
  }

  function roomStatus(records) {
    if (records.length) return 'Occupied';
    if (sourceState === 'ready') return 'Available';
    if (sourceState === 'partial') return 'Occupancy unconfirmed';
    return sourceState === 'loading' ? 'Checking room status…' : 'Status unavailable';
  }

  function hideTooltip({restoreFocus = false} = {}) {
    clearTimeout(hideDelay);
    const room = activeRoom;
    room?.classList.remove('is-selected');
    room?.removeAttribute('aria-describedby');
    if (room?.hasAttribute('aria-expanded')) room.setAttribute('aria-expanded', 'false');
    activeRoom = null;
    activation = null;
    tooltip.hidden = true;
    tooltip.replaceChildren();
    if (restoreFocus && room) {
      skipFocusRoom = room;
      room.focus({preventScroll: true});
      skipFocusRoom = null;
    }
  }

  function queueHide() {
    clearTimeout(hideDelay);
    hideDelay = setTimeout(hideTooltip, 140);
  }

  function placeTooltip(room) {
    const roomBounds = room.getBoundingClientRect();
    const tooltipBounds = tooltip.getBoundingClientRect();
    const gap = 6;
    const inset = 10;
    const center = roomBounds.left + (roomBounds.width - tooltipBounds.width) / 2;
    const above = roomBounds.top - tooltipBounds.height - gap;
    const top = above >= inset ? above : roomBounds.bottom + gap;
    const maxLeft = document.documentElement.clientWidth - tooltipBounds.width - inset;
    const maxTop = document.documentElement.clientHeight - tooltipBounds.height - inset;
    tooltip.style.left = `${Math.max(inset, Math.min(center, maxLeft))}px`;
    tooltip.style.top = `${Math.max(inset, Math.min(top, maxTop))}px`;
  }

  function textNode(tag, className, text) {
    const node = document.createElement(tag);
    node.className = className;
    node.textContent = text;
    return node;
  }

  function renderTooltip(room) {
    const records = recordsFor(room);
    const interactive = activation === 'shared';
    const previouslyFocused = tooltip.contains(document.activeElement) ? document.activeElement.href : '';
    tooltip.setAttribute('role', interactive ? 'dialog' : 'tooltip');
    if (interactive) tooltip.setAttribute('aria-label', `Reservations for ${roomName(room)}`);
    else tooltip.removeAttribute('aria-label');
    rebuildingTooltip = true;
    tooltip.replaceChildren(textNode('span', 'map-tooltip-label', roomName(room)));
    rebuildingTooltip = false;
    tooltip.dataset.state = records.length ? 'occupied' : sourceState;

    if (!records.length) {
      tooltip.append(textNode('strong', 'map-tooltip-name', roomStatus(records)));
      return;
    }

    for (const record of records) {
      const pet = record.pet || 'Pet';
      const row = document.createElement('div');
      row.className = 'map-tooltip-pet';
      row.append(textNode('strong', 'map-tooltip-name', pet));
      const details = [record.breed, record.owner && `Owner ${record.owner}`].filter(Boolean);
      if (details.length) row.append(textNode('span', 'map-tooltip-meta', details.join(' · ')));

      const url = reservationUrl(record);
      if (url && interactive) {
        const link = textNode('a', 'map-tooltip-edit', 'Edit in Gingr');
        link.href = url;
        link.target = '_blank';
        link.rel = 'noopener noreferrer';
        link.setAttribute('aria-label', `Edit ${pet}’s reservation in Gingr (opens in a new tab)`);
        link.addEventListener('click', event => {
          if (!snapshotIsCurrent() || !recordsFor(room).some(row => reservationUrl(row) === url)) event.preventDefault();
        });
        row.append(link);
      }
      tooltip.append(row);
    }

    if (!interactive && records.some(reservationUrl)) {
      const label = records.length === 1 ? 'Open reservation in Gingr' : 'Choose a reservation';
      tooltip.append(textNode('span', 'map-tooltip-action', label));
    }
    if (previouslyFocused) {
      const links = [...tooltip.querySelectorAll('a')];
      (links.find(link => link.href === previouslyFocused) || links[0])?.focus({preventScroll: true});
    }
  }

  function showTooltip(room, mode) {
    if (room !== activeRoom) hideTooltip();
    clearTimeout(hideDelay);
    activeRoom = room;
    activation = mode;
    tooltip.hidden = false;
    renderTooltip(room);
    room.classList.add('is-selected');
    if (mode === 'shared') {
      room.removeAttribute('aria-describedby');
      room.setAttribute('aria-expanded', 'true');
      tooltip.querySelector('a')?.focus({preventScroll: true});
    } else {
      room.setAttribute('aria-describedby', tooltip.id);
    }
    placeTooltip(room);
  }

  function renderMap() {
    const labels = {
      loading: 'Loading occupancy',
      ready: 'Occupancy up to date',
      partial: 'Some Gingr lodgings unmatched',
      unavailable: 'Occupancy unavailable',
      signedOut: 'Sign in to view occupancy',
      restricted: 'Occupancy access required'
    };
    status.dataset.state = sourceState;
    status.textContent = labels[sourceState];

    for (const room of rooms) {
      const records = recordsFor(room);
      const names = records.map(record => record.pet).filter(Boolean).join(', ');
      const hasLinks = records.some(reservationUrl);
      room.classList.toggle('is-occupied', Boolean(records.length));
      room.classList.toggle('has-reservation', hasLinks);
      room.setAttribute('aria-label', [roomName(room), roomStatus(records), names].filter(Boolean).join(', '));
      if (records.length > 1 && hasLinks) {
        room.setAttribute('aria-haspopup', 'dialog');
        room.setAttribute('aria-expanded', String(room === activeRoom && activation === 'shared'));
        room.setAttribute('aria-controls', tooltip.id);
      } else {
        room.removeAttribute('aria-haspopup');
        room.removeAttribute('aria-expanded');
        room.removeAttribute('aria-controls');
      }
    }
    if (!activeRoom) return;
    const activeRecords = recordsFor(activeRoom);
    if (activation === 'shared' && (activeRecords.length < 2 || !activeRecords.some(reservationUrl))) {
      hideTooltip({restoreFocus: tooltip.contains(document.activeElement)});
      return;
    }
    renderTooltip(activeRoom);
    placeTooltip(activeRoom);
  }

  function clearOccupancy(state) {
    recordsByRoom = new Map();
    expiresAt = 0;
    sourceState = state;
    hideTooltip();
    renderMap();
  }

  function resetRequest(state) {
    flight?.abort();
    flight = null;
    lastAttempt = -Infinity;
    clearOccupancy(state);
  }

  function snapshotIsCurrent() {
    if (expiresAt && Date.now() >= expiresAt) {
      clearOccupancy('unavailable');
      void refresh();
    }
    return pageActive && !accessBlocked && expiresAt > Date.now();
  }

  function readOccupancy(payload) {
    if (!Array.isArray(payload?.rooms) || typeof payload.complete !== 'boolean'
      || !Number.isFinite(Date.parse(payload.updatedAt)) || !Number.isSafeInteger(payload.unmappedCount)
      || payload.unmappedCount < 0) throw new Error('Invalid map occupancy');

    const nextRecords = new Map();
    let complete = payload.complete && !payload.unmappedCount;
    for (const entry of payload.rooms) {
      const room = normalizeRoom(entry?.room);
      if (!knownRooms.has(room)) {
        complete = false;
        continue;
      }
      const record = {
        reservationId: typeof entry.reservationId === 'number' && Number.isSafeInteger(entry.reservationId)
          ? String(entry.reservationId) : cleanText(entry.reservationId),
        pet: cleanText(entry.pet),
        breed: cleanText(entry.breed),
        owner: cleanText(entry.owner)
      };
      const records = nextRecords.get(room) || [];
      if (!record.reservationId || !records.some(existing => existing.reservationId === record.reservationId)) {
        records.push(record);
      }
      nextRecords.set(room, records);
    }
    return {records: nextRecords, state: complete ? 'ready' : 'partial'};
  }

  async function refresh() {
    if (!client || !pageActive || document.hidden || accessBlocked || userId === null || flight
      || Date.now() - lastAttempt < 10000) return;
    lastAttempt = Date.now();
    const request = new AbortController();
    flight = request;
    const deadline = setTimeout(() => request.abort(), 25000);
    const current = () => flight === request && pageActive && !accessBlocked;

    try {
      const {data: auth, error: sessionError} = await client.auth.getSession();
      if (!current()) return;
      if (sessionError) throw sessionError;
      const session = auth?.session;
      if (!session?.user?.id || !session.access_token) {
        userId = null;
        clearOccupancy('signedOut');
        return;
      }
      if (userId !== undefined && session.user.id !== userId) {
        userId = session.user.id;
        clearOccupancy('loading');
      }
      userId = session.user.id;
      if (typeof ensureHqWorkspaceAccess === 'function') await ensureHqWorkspaceAccess(session);
      if (!current()) return;
      if (request.signal.aborted) throw new Error('Occupancy request timed out');
      const {data, error} = await client.functions.invoke('hq-map-occupancy', {
        body: {},
        headers: {Authorization: `Bearer ${session.access_token}`},
        signal: request.signal
      });
      if (!current()) return;
      if (error || request.signal.aborted) throw error || new Error('Occupancy request timed out');

      const result = readOccupancy(data);
      recordsByRoom = result.records;
      sourceState = result.state;
      expiresAt = Date.now() + maxSnapshotAge;
      renderMap();
    } catch (error) {
      if (!current()) return;
      const statusCode = error?.context?.status;
      const denied = error?.code === 'ACCESS' || statusCode === 403;
      clearOccupancy(denied ? 'restricted' : statusCode === 401 ? 'signedOut' : 'unavailable');
    } finally {
      clearTimeout(deadline);
      if (flight === request) flight = null;
    }
  }

  for (const room of rooms) {
    room.addEventListener('pointerenter', event => {
      snapshotIsCurrent();
      if (event.pointerType !== 'touch' && activation !== 'shared') showTooltip(room, 'hover');
    });
    room.addEventListener('pointerleave', () => {
      if (activeRoom === room && activation === 'hover') queueHide();
    });
    room.addEventListener('focus', () => {
      snapshotIsCurrent();
      if (room !== skipFocusRoom && room.matches(':focus-visible')) showTooltip(room, 'focus');
    });
    room.addEventListener('blur', event => {
      if (activeRoom === room && activation !== 'hover' && !tooltip.contains(event.relatedTarget)) hideTooltip();
    });
    room.addEventListener('click', event => {
      const records = snapshotIsCurrent() ? recordsFor(room) : [];
      if (records.length === 1 && reservationUrl(records[0])) {
        window.open(reservationUrl(records[0]), '_blank', 'noopener,noreferrer');
      } else if (records.length > 1 && records.some(reservationUrl)) {
        if (room === activeRoom && activation === 'shared') hideTooltip();
        else showTooltip(room, 'shared');
      } else if (activeRoom !== room || activation !== 'activated') {
        showTooltip(room, 'activated');
      } else if (event.pointerType !== 'mouse') {
        hideTooltip();
      }
    });
  }

  tooltip.addEventListener('pointerenter', () => clearTimeout(hideDelay));
  tooltip.addEventListener('pointerleave', () => {
    if (activation === 'hover') queueHide();
  });
  tooltip.addEventListener('focusout', event => {
    if (!rebuildingTooltip && activation === 'shared' && event.relatedTarget !== activeRoom
      && !tooltip.contains(event.relatedTarget)) hideTooltip();
  });
  document.addEventListener('pointerdown', event => {
    if (!activeRoom?.contains(event.target) && !tooltip.contains(event.target)) hideTooltip();
  });
  document.addEventListener('keydown', event => {
    if (event.key === 'Escape' && activeRoom) hideTooltip({restoreFocus: tooltip.contains(document.activeElement)});
  });
  window.addEventListener('scroll', () => hideTooltip(), {passive: true});
  window.addEventListener('resize', () => hideTooltip());
  mapScroll.addEventListener('scroll', () => hideTooltip(), {passive: true});

  client?.auth.onAuthStateChange((event, session) => {
    const nextId = event === 'SIGNED_OUT' ? null : session?.user?.id || null;
    if (nextId === userId && event !== 'SIGNED_OUT') return;
    userId = nextId;
    accessBlocked = false;
    resetRequest(nextId ? 'loading' : 'signedOut');
    if (nextId) setTimeout(() => void refresh(), 0);
  });
  window.addEventListener('paws-access-revoked', () => {
    accessBlocked = true;
    resetRequest('restricted');
  });
  window.addEventListener('paws-access-restored', () => {
    accessBlocked = false;
    resetRequest('loading');
    void refresh();
  });
  window.addEventListener('pagehide', () => {
    pageActive = false;
    resetRequest('loading');
  });
  window.addEventListener('pageshow', event => {
    if (event.persisted) {
      pageActive = true;
      void refresh();
    }
  });

  function refreshVisible() {
    if (!document.hidden) {
      snapshotIsCurrent();
      void refresh();
    }
  }
  document.addEventListener('visibilitychange', refreshVisible);
  window.addEventListener('focus', refreshVisible);
  window.addEventListener('online', refreshVisible);
  setInterval(refreshVisible, refreshInterval);

  if (!client) sourceState = 'unavailable';
  renderMap();
  void refresh();
})();
