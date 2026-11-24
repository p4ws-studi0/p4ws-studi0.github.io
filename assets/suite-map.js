(() => {
  'use strict';

  const rooms = [...document.querySelectorAll('.map-room[data-room]')];
  const status = document.getElementById('map-status');
  const roomLegend = document.getElementById('map-room-legend');
  const tooltip = document.getElementById('map-tooltip');
  const dialog = document.getElementById('map-room-dialog');
  const dialogTitle = document.getElementById('map-room-title');
  const dialogState = document.getElementById('map-room-state');
  const dialogFields = document.getElementById('map-room-fields');
  const summary = document.getElementById('gingr-summary');
  const mapScroll = document.getElementById('map-scroll');

  let recordsByRoom = new Map();
  let sourceState = 'loading';
  let tooltipRoom = null;
  let selectedRoom = null;
  let requestVersion = 0;

  const normalizeRoomName = name => name.replace(/\s+/g, '').toUpperCase();
  const roomName = room => room.dataset.room.replace(/([A-Z])(?=\d)/, '$1 ');
  const roomRecord = room => recordsByRoom.get(normalizeRoomName(room.dataset.room));

  function roomStatus(record) {
    if (record) return 'Occupied';
    if (sourceState === 'ready') return 'Available';
    return sourceState === 'loading' ? 'Checking room status…' : 'Status unavailable';
  }

  function formatDate(unixDate) {
    if (!unixDate) return '—';
    const date = new Date(unixDate * 1000);
    return Number.isNaN(date.getTime()) ? '—' : date.toLocaleDateString();
  }

  function hideTooltip() {
    tooltipRoom = null;
    tooltip.hidden = true;
  }

  function showTooltip(room) {
    if (dialog.open) return;
    const record = roomRecord(room);
    const name = document.createElement('strong');
    name.textContent = roomName(room);
    const details = document.createElement('span');
    details.textContent = record?.a_first || roomStatus(record);
    tooltip.replaceChildren(name, details);
    tooltipRoom = room;
    tooltip.hidden = false;

    const roomRect = room.getBoundingClientRect();
    const tooltipRect = tooltip.getBoundingClientRect();
    const gap = 8;
    const inset = 12;
    const left = roomRect.left + (roomRect.width - tooltipRect.width) / 2;
    const above = roomRect.top - tooltipRect.height - gap;
    const top = above >= inset ? above : roomRect.bottom + gap;
    tooltip.style.left = `${Math.max(inset, Math.min(left, window.innerWidth - tooltipRect.width - inset))}px`;
    tooltip.style.top = `${Math.max(inset, Math.min(top, window.innerHeight - tooltipRect.height - inset))}px`;
  }

  function renderDetails(room) {
    const record = roomRecord(room);
    dialogTitle.textContent = roomName(room);
    dialogState.textContent = roomStatus(record);
    dialogState.dataset.state = record ? 'occupied' : sourceState;
    dialogFields.replaceChildren();
    dialogFields.hidden = !record;
    if (!record) return;

    const fields = [
      ['Pet', record.a_first],
      ['Breed', record.breed_name],
      ['Owner', record.o_last],
      ['Type', typeof record.type === 'string' ? record.type.trim() : ''],
      ['Check-in', formatDate(record.start_date)],
      ['Check-out', formatDate(record.end_date)]
    ];
    for (const [label, value] of fields) {
      const term = document.createElement('dt');
      const description = document.createElement('dd');
      term.textContent = label;
      description.textContent = value || '—';
      dialogFields.append(term, description);
    }
  }

  function renderMap() {
    const labels = {
      loading: 'Loading occupancy',
      ready: 'Occupancy up to date',
      unavailable: 'Occupancy unavailable'
    };
    status.dataset.state = sourceState;
    status.textContent = labels[sourceState];
    roomLegend.textContent = sourceState === 'ready' ? 'Available' : 'Room';
    for (const room of rooms) {
      const record = roomRecord(room);
      room.classList.toggle('is-occupied', Boolean(record));
      room.setAttribute('aria-label', `${roomName(room)}, ${roomStatus(record)}${record?.a_first ? `, ${record.a_first}` : ''}`);
    }
    if (tooltipRoom) showTooltip(tooltipRoom);
    if (selectedRoom && dialog.open) renderDetails(selectedRoom);
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

  async function fetchSummary() {
    try {
      const response = await fetch('http://localhost:8000/reservations?date=2026-01-31');
      if (!response.ok) return;
      const { gingr_response: { totals } } = await response.json();
      document.getElementById('checkins').textContent = totals.check_in_total;
      document.getElementById('checkouts').textContent = totals.check_out_total;
      document.getElementById('total').textContent = totals.active_total;
      summary.hidden = false;
    } catch {
      summary.hidden = true;
    }
  }

  for (const room of rooms) {
    room.addEventListener('pointerenter', event => {
      if (event.pointerType !== 'touch') showTooltip(room);
    });
    room.addEventListener('pointerleave', () => {
      if (tooltipRoom === room) hideTooltip();
    });
    room.addEventListener('focus', () => {
      if (room.matches(':focus-visible')) showTooltip(room);
    });
    room.addEventListener('blur', () => {
      if (tooltipRoom === room) hideTooltip();
    });
    room.addEventListener('click', () => {
      hideTooltip();
      selectedRoom = room;
      room.classList.add('is-selected');
      renderDetails(room);
      dialog.showModal();
    });
  }

  document.getElementById('map-room-close').addEventListener('click', () => dialog.close());
  dialog.addEventListener('close', () => {
    selectedRoom?.classList.remove('is-selected');
    selectedRoom = null;
  });
  document.addEventListener('keydown', event => {
    if (event.key === 'Escape') hideTooltip();
  });
  window.addEventListener('scroll', hideTooltip, { passive: true });
  window.addEventListener('resize', hideTooltip);
  mapScroll.addEventListener('scroll', hideTooltip, { passive: true });

  renderMap();
  void fetchRoomData();
  void fetchSummary();
  setInterval(fetchRoomData, 30000);
})();
