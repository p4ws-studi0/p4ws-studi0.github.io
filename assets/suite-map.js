(() => {
  'use strict';

  const rooms = [...document.querySelectorAll('.map-room[data-room]')];
  const status = document.getElementById('map-status');
  const tooltip = document.getElementById('map-tooltip');
  const mapScroll = document.getElementById('map-scroll');

  let recordsByRoom = new Map();
  let sourceState = 'loading';
  let activeRoom = null;
  let activation = null;
  let hideDelay;
  let requestVersion = 0;

  const normalizeRoomName = name => name.replace(/\s+/g, '').toUpperCase();
  const roomName = room => room.dataset.room.replace(/([A-Z])(?=\d)/, '$1 ');
  const roomRecord = room => recordsByRoom.get(normalizeRoomName(room.dataset.room));
  const cleanText = value => typeof value === 'string' ? value.trim() : '';

  function roomStatus(record) {
    if (record) return 'Occupied';
    if (sourceState === 'ready') return 'Available';
    return sourceState === 'loading' ? 'Checking room status…' : 'Status unavailable';
  }

  function hideTooltip() {
    clearTimeout(hideDelay);
    activeRoom?.classList.remove('is-selected');
    activeRoom?.removeAttribute('aria-describedby');
    activeRoom = null;
    activation = null;
    tooltip.hidden = true;
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

  function renderTooltip(room) {
    const record = roomRecord(room);

    const label = document.createElement('span');
    label.className = 'map-tooltip-label';
    label.textContent = roomName(room);

    const name = document.createElement('strong');
    name.className = 'map-tooltip-name';
    name.textContent = cleanText(record?.a_first) || roomStatus(record);
    tooltip.replaceChildren(label, name);

    if (record) {
      const breed = cleanText(record.breed_name);
      const owner = cleanText(record.o_last);
      const details = [breed, owner && `Owner ${owner}`].filter(Boolean);
      if (details.length) {
        const metadata = document.createElement('span');
        metadata.className = 'map-tooltip-meta';
        metadata.textContent = details.join(' · ');
        tooltip.append(metadata);
      }
    }

    tooltip.dataset.state = record ? 'occupied' : sourceState === 'ready' ? 'available' : sourceState;
  }

  function showTooltip(room, mode) {
    if (room !== activeRoom) hideTooltip();
    clearTimeout(hideDelay);
    activeRoom = room;
    activation = mode;
    renderTooltip(room);
    tooltip.hidden = false;
    room.classList.add('is-selected');
    room.setAttribute('aria-describedby', tooltip.id);
    placeTooltip(room);
  }

  function renderMap() {
    const labels = {
      loading: 'Loading occupancy',
      ready: 'Occupancy up to date',
      unavailable: 'Occupancy unavailable'
    };
    status.dataset.state = sourceState;
    status.textContent = labels[sourceState];
    for (const room of rooms) {
      const record = roomRecord(room);
      const pet = cleanText(record?.a_first);
      room.classList.toggle('is-occupied', Boolean(record));
      room.setAttribute('aria-label', [roomName(room), roomStatus(record), pet].filter(Boolean).join(', '));
    }
    if (activeRoom) {
      renderTooltip(activeRoom);
      placeTooltip(activeRoom);
    }
  }

  async function fetchRoomData() {
    const version = ++requestVersion;
    try {
      const response = await fetch('http://localhost:8000/api/rooms');
      if (!response.ok) throw new Error('Room status unavailable');
      const json = await response.json();
      const records = [...(json.data.checking_in || []), ...(json.data.checking_out || [])];
      const nextRecords = new Map();
      for (const record of records) {
        if (typeof record.run_name === 'string' && record.run_name) {
          nextRecords.set(normalizeRoomName(record.run_name), record);
        }
      }
      if (version !== requestVersion) return;
      recordsByRoom = nextRecords;
      sourceState = 'ready';
    } catch {
      if (version !== requestVersion) return;
      recordsByRoom = new Map();
      sourceState = 'unavailable';
    }
    renderMap();
  }

  for (const room of rooms) {
    room.addEventListener('pointerenter', event => {
      if (event.pointerType !== 'touch') showTooltip(room, 'hover');
    });
    room.addEventListener('pointerleave', () => {
      if (activeRoom === room && activation === 'hover') queueHide();
    });
    room.addEventListener('focus', () => {
      if (room.matches(':focus-visible')) showTooltip(room, 'focus');
    });
    room.addEventListener('blur', () => {
      if (activeRoom === room && activation !== 'hover') hideTooltip();
    });
    room.addEventListener('click', event => {
      if (activeRoom !== room) {
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
  document.addEventListener('pointerdown', event => {
    if (!activeRoom?.contains(event.target) && !tooltip.contains(event.target)) hideTooltip();
  });
  document.addEventListener('keydown', event => {
    if (event.key === 'Escape') hideTooltip();
  });
  window.addEventListener('scroll', hideTooltip, { passive: true });
  window.addEventListener('resize', hideTooltip);
  mapScroll.addEventListener('scroll', hideTooltip, { passive: true });

  renderMap();
  void fetchRoomData();
  setInterval(fetchRoomData, 30000);
})();
