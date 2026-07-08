/* Nourish — vanilla JS PWA. Data comes from data.js (RECIPES, WEEK_PLANS). */
'use strict';

/* ── Constants & helpers ───────────────────────────────── */

const DAY_KEYS  = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'];
const DAY_NAMES = { mon:'Monday', tue:'Tuesday', wed:'Wednesday', thu:'Thursday', fri:'Friday', sat:'Saturday', sun:'Sunday' };
const DAY_SHORT = { mon:'Mon', tue:'Tue', wed:'Wed', thu:'Thu', fri:'Fri', sat:'Sat', sun:'Sun' };
// Plan data still uses R (refuel) slot keys — they render as plain Lunch
const SLOT_LABELS = { B:'Breakfast', R:'Lunch', L:'Lunch', D:'Dinner' };
const SLOT_SHORT  = { B:'Bfast', R:'Lunch', L:'Lunch', D:'Dinner' };
const CYCLE_DAYS = 30;

const RECIPE_BY_ID = {};
RECIPES.forEach(r => { RECIPE_BY_ID[r.id] = r; });

const $ = sel => document.querySelector(sel);

function esc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function todayKey() {
  return DAY_KEYS[(new Date().getDay() + 6) % 7];
}

function fmtLongDate(d) {
  return d.toLocaleDateString('en-GB', { weekday:'long', day:'numeric', month:'long' });
}

function totalTime(r) { return (r.prep || 0) + (r.cook || 0); }

/* ── Settings store ────────────────────────────────────── */

const STORE_KEY = 'nourish';

const DEFAULTS = {
  onboarded: false,
  cycle: 1,                                   // 1–3, or 0 = custom week
  startDate: new Date().toISOString().slice(0, 10),
  customWeekEntries: {},                      // { mon: {B:'recipeId', L:'…', D:'…'}, … }
};

let settings = loadSettings();

function loadSettings() {
  try {
    const raw = JSON.parse(localStorage.getItem(STORE_KEY));
    if (raw && typeof raw === 'object') {
      // Migrate custom-week entries saved when refuel was a slot type
      for (const day of Object.values(raw.customWeekEntries || {})) {
        if (day.R) { if (!day.L) day.L = day.R; delete day.R; }
      }
      return Object.assign({}, DEFAULTS, raw);
    }
  } catch (e) { /* corrupted state — fall back to defaults */ }
  return Object.assign({}, DEFAULTS);
}

function saveSettings() {
  localStorage.setItem(STORE_KEY, JSON.stringify(settings));
}

function daysIntoCycle() {
  const start = new Date(settings.startDate + 'T00:00:00');
  const now = new Date(); now.setHours(0, 0, 0, 0);
  return Math.max(0, Math.round((now - start) / 86400000));
}

function currentWeek() { return Math.min(4, Math.floor(daysIntoCycle() / 7) + 1); }

/* ── Plan logic ────────────────────────────────────────── */

// Normalised slot: { type, label, recipeId|null, isBatch, batchFrom }
function daySlots(planDay) {
  const slots = [];
  for (const key of ['B', 'R', 'L', 'D']) {
    const v = planDay[key];
    if (!v) continue;
    if (Array.isArray(v)) slots.push({ type:key, label:SLOT_LABELS[key], recipeId:v[0], isBatch:true, batchFrom:v[1] });
    else slots.push({ type:key, label:SLOT_LABELS[key], recipeId:v, isBatch:false, batchFrom:null });
  }
  return slots;
}

function customWeekDays() {
  return DAY_KEYS.map(day => {
    const entry = settings.customWeekEntries[day] || {};
    const slots = ['B', 'L', 'D'].map(t => ({
      type:t, label:SLOT_LABELS[t], recipeId:entry[t] || null, isBatch:false, batchFrom:null,
    }));
    return { day, slots, snacks:'Mixed nuts · Fresh fruit' };
  });
}

// Returns [{day, slots, snacks}] for the given cycle/week
function weekDays(cycle, week) {
  if (cycle === 0) return customWeekDays();
  const plan = WEEK_PLANS.find(p => p.cycle === cycle && p.week === week);
  if (!plan) return [];
  return plan.days.map(d => ({ day:d.day, slots:daySlots(d), snacks:d.snacks }));
}

/* ── Navigation ────────────────────────────────────────── */

const RENDERERS = {
  today:    renderToday,
  week:     renderWeek,
  recipes:  renderRecipes,
  build:    renderBuild,
  settings: renderSettings,
};

function switchView(name) {
  document.querySelectorAll('.view').forEach(v => v.classList.toggle('active', v.id === 'view-' + name));
  document.querySelectorAll('.nav-btn').forEach(b => b.classList.toggle('active', b.dataset.view === name));
  RENDERERS[name]();
}

document.querySelectorAll('.nav-btn').forEach(btn => {
  btn.addEventListener('click', () => switchView(btn.dataset.view));
});

/* ── Shared meal rendering ─────────────────────────────── */

function slotBadge(slot) {
  if (!slot.recipeId) return '';
  if (slot.isBatch) return `<span class="meal-slot-badge batch-badge">Batch · ${DAY_SHORT[slot.batchFrom]}</span>`;
  return '<span class="meal-slot-badge cook-badge">Cook fresh</span>';
}

function tagChips(r) {
  const chips = [];
  if (r.mealTypes.includes('refuel')) chips.push('<span class="tag tag-refuel">Refuel</span>');
  if (r.free) chips.push('<span class="tag tag-free">Naturally free</span>');
  if (r.tags.includes('batch'))  chips.push('<span class="tag tag-batch">Batch</span>');
  if (r.tags.includes('quick'))  chips.push('<span class="tag tag-quick">Quick</span>');
  if (r.tags.includes('otg'))    chips.push('<span class="tag tag-otg">On-the-go</span>');
  if (r.tags.includes('family')) chips.push('<span class="tag tag-family">Family</span>');
  if (r.gfCheck && r.gfCheck.length) chips.push('<span class="tag tag-gf">GF check</span>');
  return chips.join('');
}

/* ── Today view ────────────────────────────────────────── */

function renderToday() {
  const day = todayKey();
  $('#today-date').textContent = fmtLongDate(new Date());

  const days = weekDays(settings.cycle, currentWeek());
  const dayPlan = days.find(d => d.day === day);

  let html = '';

  if (!dayPlan) {
    html += '<div class="empty-state"><h3>No plan for today</h3><p>Check your cycle in Settings.</p></div>';
  } else {
    for (const slot of dayPlan.slots) {
      const r = slot.recipeId ? RECIPE_BY_ID[slot.recipeId] : null;
      html += `
        <div class="meal-slot" data-slot="${slot.type}" data-id="${esc(slot.recipeId || '')}">
          <div class="meal-slot-header">
            <span class="meal-slot-label">${slot.label}</span>
            ${slotBadge(slot)}
          </div>
          <div class="meal-slot-body">
            ${r
              ? `<div class="meal-slot-name">${esc(r.name)}</div>
                 <div class="meal-slot-time">${r.prep} min prep${r.cook ? ` · ${r.cook} min cook` : ''}</div>`
              : '<div class="meal-slot-name text-muted">Tap to choose a recipe</div>'}
          </div>
        </div>`;
    }
    html += `
      <div class="snacks-card">
        <div class="snacks-label">Snacks</div>
        ${esc(dayPlan.snacks)}
      </div>`;
  }

  if (settings.cycle > 0) {
    const dayNum = Math.min(daysIntoCycle() + 1, CYCLE_DAYS);
    const pct = Math.min(100, Math.round((dayNum / CYCLE_DAYS) * 100));
    html += `
      <div class="card">
        <div class="progress-label"><span>Cycle ${settings.cycle} · Day ${dayNum} of ${CYCLE_DAYS}</span><span>Week ${currentWeek()}</span></div>
        <div class="progress-bar-track"><div class="progress-bar-fill" style="width:${pct}%"></div></div>
      </div>`;
  }

  const el = $('#today-content');
  el.innerHTML = html;
  el.onclick = e => {
    const card = e.target.closest('.meal-slot');
    if (!card) return;
    if (card.dataset.id) openRecipeDrawer(card.dataset.id);
    else openChooser(day, card.dataset.slot);
  };
}

/* ── Week view ─────────────────────────────────────────── */

let viewedWeek = null;   // 1–4; null = follow current week

function renderWeek() {
  const custom = settings.cycle === 0;
  const week = custom ? 1 : (viewedWeek || currentWeek());
  $('#week-label').textContent = custom ? 'Custom Week' : `Cycle ${settings.cycle} · Week ${week}`;

  const days = weekDays(settings.cycle, week);
  const today = todayKey();
  let html = '';

  if (!custom) {
    html += `
      <div class="week-nav">
        <button class="week-nav-btn" data-nav="-1" ${week <= 1 ? 'style="visibility:hidden"' : ''}>
          <svg viewBox="0 0 24 24"><polyline points="15 18 9 12 15 6"/></svg>
        </button>
        <span class="week-nav-label">Week ${week} of 4${week === currentWeek() ? ' · now' : ''}</span>
        <button class="week-nav-btn" data-nav="1" ${week >= 4 ? 'style="visibility:hidden"' : ''}>
          <svg viewBox="0 0 24 24"><polyline points="9 18 15 12 9 6"/></svg>
        </button>
      </div>`;
  }

  for (const d of days) {
    const isToday = d.day === today;
    html += `
      <div class="day-row${isToday ? ' open' : ''}" data-day="${d.day}">
        <div class="day-row-header">
          <span class="day-row-name">${DAY_NAMES[d.day]}${isToday ? ' · Today' : ''}</span>
          <svg class="day-row-chevron" viewBox="0 0 24 24"><polyline points="9 18 15 12 9 6"/></svg>
        </div>
        <div class="day-row-meals">
          ${d.slots.map(slot => {
            const r = slot.recipeId ? RECIPE_BY_ID[slot.recipeId] : null;
            return `
              <div class="day-meal-line" data-slot="${slot.type}" data-id="${esc(slot.recipeId || '')}">
                <span class="day-meal-type">${SLOT_SHORT[slot.type]}</span>
                <span class="day-meal-name">
                  ${r ? esc(r.name) : '<span class="text-muted">Tap to choose…</span>'}
                  ${slot.isBatch ? `<div class="day-meal-batch">Batch — cooked ${DAY_SHORT[slot.batchFrom]}</div>` : ''}
                </span>
                ${custom ? '<span class="text-muted" data-swap="1">✎</span>' : ''}
              </div>`;
          }).join('')}
          <div class="day-meal-line" style="cursor:default">
            <span class="day-meal-type">Snacks</span>
            <span class="day-meal-name text-muted">${esc(d.snacks)}</span>
          </div>
        </div>
      </div>`;
  }

  html += '<button class="shopping-btn" id="week-shopping-btn">Shopping list for this week</button>';

  const el = $('#week-content');
  el.innerHTML = html;
  el.onclick = e => {
    const nav = e.target.closest('[data-nav]');
    if (nav) {
      viewedWeek = Math.min(4, Math.max(1, week + Number(nav.dataset.nav)));
      renderWeek();
      return;
    }
    if (e.target.closest('#week-shopping-btn')) { openShopping(settings.cycle, week); return; }

    const header = e.target.closest('.day-row-header');
    if (header) { header.parentElement.classList.toggle('open'); return; }

    const line = e.target.closest('.day-meal-line[data-slot]');
    if (line) {
      const dayKey = line.closest('.day-row').dataset.day;
      if (e.target.closest('[data-swap]') || !line.dataset.id) openChooser(dayKey, line.dataset.slot);
      else openRecipeDrawer(line.dataset.id);
    }
  };
}

/* ── Recipes view ──────────────────────────────────────── */

const FILTERS = [
  { id:'all',       label:'All',          fn:() => true },
  { id:'c1',        label:'Cycle 1',      fn:r => r.cycle === 1 },
  { id:'c2',        label:'Cycle 2',      fn:r => r.cycle === 2 },
  { id:'c3',        label:'Cycle 3',      fn:r => r.cycle === 3 },
  { id:'breakfast', label:'Breakfast',    fn:r => r.mealTypes.includes('breakfast') },
  { id:'refuel',    label:'Refuel',       fn:r => r.mealTypes.includes('refuel') },
  { id:'mains',     label:'Lunch/Dinner', fn:r => r.mealTypes.includes('lunch') || r.mealTypes.includes('dinner') },
  { id:'free',      label:'Naturally free', fn:r => r.free },
  { id:'batch',     label:'Batch',        fn:r => r.tags.includes('batch') },
  { id:'quick',     label:'Quick',        fn:r => r.tags.includes('quick') },
  { id:'otg',       label:'On-the-go',    fn:r => r.tags.includes('otg') },
];

let activeFilter = 'all';
let recipesInit = false;

function renderRecipes() {
  if (!recipesInit) {
    recipesInit = true;
    $('#recipes-filters').innerHTML = FILTERS.map(f =>
      `<button class="filter-chip${f.id === activeFilter ? ' active' : ''}" data-filter="${f.id}">${f.label}</button>`
    ).join('');
    $('#recipes-filters').onclick = e => {
      const chip = e.target.closest('.filter-chip');
      if (!chip) return;
      activeFilter = chip.dataset.filter;
      document.querySelectorAll('#recipes-filters .filter-chip')
        .forEach(c => c.classList.toggle('active', c.dataset.filter === activeFilter));
      renderRecipeList();
    };
    $('#recipe-search').addEventListener('input', renderRecipeList);
    $('#recipes-content').onclick = e => {
      const card = e.target.closest('[data-id]');
      if (card) openRecipeDrawer(card.dataset.id);
    };
  }
  renderRecipeList();
}

function renderRecipeList() {
  const q = $('#recipe-search').value.trim().toLowerCase();
  const filter = FILTERS.find(f => f.id === activeFilter) || FILTERS[0];
  const matches = RECIPES.filter(r =>
    filter.fn(r) &&
    (!q || r.name.toLowerCase().includes(q) || r.ingredients.some(i => i.n.toLowerCase().includes(q)))
  );

  if (!matches.length) {
    $('#recipes-content').innerHTML = '<div class="empty-state"><h3>No recipes found</h3><p>Try a different search or filter.</p></div>';
    return;
  }
  $('#recipes-content').innerHTML = matches.map(r => `
    <div class="card card-tap" data-id="${r.id}">
      <div class="recipe-card-name">${esc(r.name)}</div>
      <div class="recipe-card-meta">
        <span>⏱ ${totalTime(r)} min</span>
        <span>Cycle ${r.cycle}</span>
        <span>${r.mealTypes.map(m => m === 'refuel' ? 'Refuel' : m[0].toUpperCase() + m.slice(1)).join(' · ')}</span>
      </div>
      <div class="recipe-card-tags">${tagChips(r)}</div>
    </div>`).join('');
}

/* ── Recipe drawer ─────────────────────────────────────── */

function openDrawer(html) {
  const content = $('#recipe-drawer-content');
  content.onclick = null;   // clear any chooser handler from a previous open
  content.innerHTML = html;
  const drawer = $('#recipe-drawer');
  drawer.classList.add('open');
  drawer.setAttribute('aria-hidden', 'false');
  const body = drawer.querySelector('.drawer-body');
  body.style.overflowY = 'scroll';   // iOS Safari: must be set explicitly
  body.scrollTop = 0;
}

function closeDrawer() {
  const drawer = $('#recipe-drawer');
  drawer.classList.remove('open');
  drawer.setAttribute('aria-hidden', 'true');
}

$('#recipe-drawer-backdrop').addEventListener('click', closeDrawer);
$('#recipe-drawer').querySelector('.drawer-handle').addEventListener('click', closeDrawer);

function openRecipeDrawer(id) {
  const r = RECIPE_BY_ID[id];
  if (!r) return;
  let html = `
    <h2 class="recipe-detail-name">${esc(r.name)}</h2>
    <div class="recipe-detail-meta">
      <span>Prep ${r.prep} min</span>
      ${r.cook ? `<span>Cook ${r.cook} min</span>` : ''}
      <span>Cycle ${r.cycle}</span>
    </div>
    <div class="recipe-detail-tags">${tagChips(r)}</div>

    <div class="recipe-section-title">Ingredients</div>
    <ul class="ingredient-list">
      ${r.ingredients.map(i => `
        <li class="ingredient-item">
          <span class="ingredient-qty">${esc(i.q)}</span>
          <span${i.gf ? ' class="ingredient-gf"' : ''}>${esc(i.n)}</span>
        </li>`).join('')}
    </ul>

    <div class="recipe-section-title">Method</div>
    <ol class="method-list">
      ${r.method.map(step => `<li class="method-step"><span>${esc(step)}</span></li>`).join('')}
    </ol>`;

  if (r.adaptations && r.adaptations.length) {
    html += `
      <div class="recipe-section-title">GF · DF · EF adaptations</div>
      ${r.adaptations.map(a => `
        <div class="adaptation-item">
          <span class="adaptation-orig">${esc(a.orig)}</span><span class="adaptation-arrow">→</span>
          <div class="adaptation-swap">${esc(a.swap)}</div>
        </div>`).join('')}`;
  }

  if (r.gfCheck && r.gfCheck.length) {
    html += `
      <div class="recipe-section-title">Check labels</div>
      <div class="gf-check-box">
        <ul>${r.gfCheck.map(c => `<li>${esc(c)}</li>`).join('')}</ul>
      </div>`;
  }

  if (r.note) html += `<div class="serving-note">${esc(r.note)}</div>`;
  openDrawer(html);
}

/* ── Custom week recipe chooser ────────────────────────── */

// Breakfast slots take breakfast recipes; lunch/dinner slots take anything else
const CHOOSER_TYPES = { B:['breakfast'], R:['refuel', 'lunch', 'dinner'], L:['refuel', 'lunch', 'dinner'], D:['refuel', 'lunch', 'dinner'] };

function openChooser(dayKey, slotType) {
  const wanted = CHOOSER_TYPES[slotType];
  const pool = RECIPES
    .filter(r => r.mealTypes.some(m => wanted.includes(m)))
    .sort((a, b) => a.cycle - b.cycle || a.name.localeCompare(b.name));
  const current = (settings.customWeekEntries[dayKey] || {})[slotType];

  let html = `
    <h2 class="recipe-detail-name">${DAY_NAMES[dayKey]} · ${SLOT_LABELS[slotType]}</h2>
    <div class="recipe-detail-meta"><span>Choose a recipe</span></div>`;
  if (current) {
    html += '<button class="settings-btn" data-choose="">Clear this slot</button>';
  }
  html += pool.map(r => `
    <div class="card card-tap${r.id === current ? '' : ''}" data-choose="${r.id}">
      <div class="recipe-card-name">${r.id === current ? '✓ ' : ''}${esc(r.name)}</div>
      <div class="recipe-card-meta">
        <span>⏱ ${totalTime(r)} min</span><span>Cycle ${r.cycle}</span>
        ${r.mealTypes.includes('refuel') ? '<span class="tag tag-refuel">Refuel</span>' : ''}
      </div>
    </div>`).join('');

  openDrawer(html);
  $('#recipe-drawer-content').onclick = e => {
    const pick = e.target.closest('[data-choose]');
    if (!pick) return;
    const entry = settings.customWeekEntries[dayKey] || {};
    if (pick.dataset.choose) entry[slotType] = pick.dataset.choose;
    else delete entry[slotType];
    settings.customWeekEntries[dayKey] = entry;
    saveSettings();
    closeDrawer();
    $('#recipe-drawer-content').onclick = null;
    renderWeek();
    renderToday();
  };
}

/* ── Build a Meal ──────────────────────────────────────── */

const BUILD = {
  fats: ['1 tsp coconut oil', '1 tsp olive oil', '1 tsp vegan butter (e.g. Naturli)'],
  proteins: ['75g edamame beans', '100g firm or smoked tofu', '105g cooked/tinned lentils',
             '80g tinned chickpeas', '100g tinned beans (cannellini, kidney or haricot)',
             '70g unsalted cashews or almonds'],
  carbs: ['40g rice (120g cooked)', '40g certified GF rolled oats', '40g quinoa (120g cooked)',
          '40g dried rice noodles', '50g GF pasta', '145g potato (any variety)', '2 GF corn tortillas'],
  fats2: ['65g avocado', '20g nut butter (almond, peanut or tahini)', '20g mixed nuts',
          '25g seeds (pumpkin, sunflower or hemp)', '90g pitted olives', '30g dairy-free feta (e.g. Violife)'],
  veg: ['Onion', 'Mushrooms', 'Peppers', 'Tomatoes', 'Aubergine', 'Courgette',
        'Cauliflower', 'Mangetout', 'Carrot', 'Leeks', 'Radish', 'Sweetcorn'],
  greens: ['Spinach', 'Broccoli', 'Kale', 'Green beans', 'Asparagus', 'Cabbage', 'Pak choi'],
  sides: ['30ml coconut cream', '65g coconut yoghurt', '65ml tinned coconut milk',
          '2 tsp GF curry paste', '1 tbsp sweet chilli sauce', '1 tbsp tamari (GF soy sauce)'],
  freebies: ['Garlic', 'Chilli', 'Ginger', 'Coriander', 'Parsley', 'Paprika', 'Cumin', 'Turmeric',
             'Mixed spice', 'Rosemary', 'Sesame seeds', 'Lime juice', 'Lemon juice',
             'Balsamic vinegar', 'Sriracha', 'Tamari', 'Salt & pepper'],
};

const buildState = { kind:'refuel', fat:null, proteins:[], carb:null, fat2:null, veg:[], greens:[], side:null };

function buildValid() {
  return buildState.fat !== null &&
    buildState.proteins.length === 2 &&
    (buildState.kind === 'refuel' ? buildState.carb !== null : buildState.fat2 !== null);
}

function pickerGrid(group, items, selected, extraClass) {
  return `<div class="picker-grid${extraClass ? ' ' + extraClass : ''}">
    ${items.map((it, i) => `
      <div class="picker-item${selected.includes(i) ? ' selected' : ''}" data-group="${group}" data-i="${i}">${esc(it)}</div>
    `).join('')}
  </div>`;
}

function renderBuild() {
  const s = buildState;
  const refuel = s.kind === 'refuel';
  let html = `
    <div class="build-type-toggle">
      <button class="type-btn${refuel ? ' active' : ''}" data-kind="refuel">⚡ Refuel</button>
      <button class="type-btn${!refuel ? ' active' : ''}" data-kind="general">🌿 General</button>
    </div>
    <p class="text-sm text-muted" style="margin:-8px 0 16px">
      ${refuel ? 'Refuel meals include a carb — great after a workout.' : 'General meals include an additional fat instead of a carb.'}
    </p>

    <div class="build-section">
      <div class="build-section-title">Cooking fat · choose one</div>
      ${pickerGrid('fat', BUILD.fats, s.fat === null ? [] : [s.fat])}
    </div>
    <div class="build-section">
      <div class="build-section-title">Protein sources · choose exactly 2</div>
      ${pickerGrid('proteins', BUILD.proteins, s.proteins)}
    </div>
    <div class="build-section">
      ${refuel
        ? `<div class="build-section-title">Carbohydrate · choose one</div>
           ${pickerGrid('carb', BUILD.carbs, s.carb === null ? [] : [s.carb])}`
        : `<div class="build-section-title">Additional fat · choose one</div>
           ${pickerGrid('fat2', BUILD.fats2, s.fat2 === null ? [] : [s.fat2])}`}
    </div>
    <div class="build-section">
      <div class="build-section-title">Vegetables · as many as you like</div>
      ${pickerGrid('veg', BUILD.veg, s.veg, 'build-veg-grid')}
    </div>
    <div class="build-section">
      <div class="build-section-title">Greens · one large handful</div>
      ${pickerGrid('greens', BUILD.greens, s.greens, 'build-veg-grid')}
    </div>
    <div class="build-section">
      <div class="build-section-title">Side sauce · optional</div>
      ${pickerGrid('side', BUILD.sides, s.side === null ? [] : [s.side])}
    </div>
    <div class="build-section">
      <div class="build-section-title">Freebies · unlimited, just for flavour</div>
      <div class="recipe-card-tags">${BUILD.freebies.map(f => `<span class="tag tag-quick">${f}</span>`).join('')}</div>
    </div>
    <button class="build-generate-btn" id="build-generate" ${buildValid() ? '' : 'disabled'}>Generate recipe</button>
    <div id="build-result"></div>`;

  const el = $('#build-content');
  el.innerHTML = html;
  el.onclick = e => {
    const kindBtn = e.target.closest('[data-kind]');
    if (kindBtn) {
      buildState.kind = kindBtn.dataset.kind;
      buildState.carb = null; buildState.fat2 = null;
      renderBuild();
      return;
    }
    const item = e.target.closest('.picker-item');
    if (item) { toggleBuildPick(item.dataset.group, Number(item.dataset.i)); return; }
    if (e.target.closest('#build-generate') && buildValid()) showBuildResult();
  };
}

function toggleBuildPick(group, i) {
  const s = buildState;
  if (group === 'proteins' || group === 'veg' || group === 'greens') {
    const arr = s[group];
    const at = arr.indexOf(i);
    if (at >= 0) arr.splice(at, 1);
    else if (group !== 'proteins' || arr.length < 2) arr.push(i);
  } else {
    s[group] = (s[group] === i) ? null : i;
  }
  renderBuild();
}

function showBuildResult() {
  const s = buildState;
  const refuel = s.kind === 'refuel';
  const ingredients = [
    { q:'', n:BUILD.fats[s.fat] },
    ...s.proteins.map(i => ({ q:'', n:BUILD.proteins[i] })),
    refuel ? { q:'', n:BUILD.carbs[s.carb] } : { q:'', n:BUILD.fats2[s.fat2] },
    ...s.veg.map(i => ({ q:'', n:BUILD.veg[i] })),
    ...s.greens.map(i => ({ q:'large handful', n:BUILD.greens[i] })),
    ...(s.side !== null ? [{ q:'', n:BUILD.sides[s.side] }] : []),
  ];
  const method = [
    'Heat your cooking fat in a frying pan over medium heat.',
    'Add protein sources; cook 4–5 mins until heated through.',
    'Add vegetables and greens; stir-fry 3–4 mins.',
    refuel ? 'Stir in carbohydrate and heat through for 2 mins.' : 'Fold in your additional fat.',
    'Season with your choice of herbs, spices and freebies. Serve hot.',
  ];

  $('#build-result').innerHTML = `
    <div class="build-result">
      <div class="build-result-name">Your Custom ${refuel ? 'Refuel' : 'General'} Meal</div>
      <div class="recipe-detail-tags">
        <span class="tag tag-free">GF · DF · EF</span>
        <span class="tag ${refuel ? 'tag-batch' : 'tag-quick'}">${refuel ? 'Refuel' : 'General'}</span>
      </div>
      <div class="recipe-section-title">Ingredients</div>
      <ul class="ingredient-list">
        ${ingredients.map(i => `
          <li class="ingredient-item">
            ${i.q ? `<span class="ingredient-qty">${i.q}</span>` : ''}
            <span>${esc(i.n)}</span>
          </li>`).join('')}
      </ul>
      <div class="recipe-section-title">Method</div>
      <ol class="method-list">
        ${method.map(m => `<li class="method-step"><span>${m}</span></li>`).join('')}
      </ol>
      <div class="serving-note">Your custom built meal. Makes 2 portions.</div>
    </div>`;
  $('#build-result').scrollIntoView({ behavior:'smooth', block:'start' });
}

/* ── Shopping list ─────────────────────────────────────── */

const SHOP_SECTIONS = [
  ['produce',  '🥬 Fruit & Veg'],
  ['chilled',  '❄️ Chilled'],
  ['tinsDry',  '🥫 Tins & Dry'],
  ['freeFrom', '✓ Free From Aisle'],
  ['pantry',   '🧂 Pantry & Spices'],
];

const FRACS = { '½':0.5, '¼':0.25, '¾':0.75 };

function parseNum(s) {
  s = s.trim();
  if (!s) return null;
  if (/^\d+(\.\d+)?$/.test(s)) return parseFloat(s);
  if (s.length === 1 && FRACS[s] != null) return FRACS[s];
  if (s.length === 2 && FRACS[s[1]] != null && /^\d$/.test(s[0])) return parseInt(s[0], 10) + FRACS[s[1]];
  return null;
}

// → [value, unitKey] for summable count quantities, else null
function parseCountQ(q) {
  let s = q.toLowerCase().trim();
  if (s.startsWith('juice of ')) { const n = parseNum(s.slice(9)); if (n != null) return [n, 'juiceof']; }
  for (const size of ['large ', 'small ', 'medium ']) if (s.startsWith(size)) s = s.slice(size.length);
  for (const u of ['cloves', 'clove']) {
    if (s.endsWith(' ' + u)) { const n = parseNum(s.slice(0, -(u.length + 1))); if (n != null) return [n, 'cloves']; }
  }
  for (const u of ['sticks', 'stick']) {
    if (s.endsWith(' ' + u)) { const n = parseNum(s.slice(0, -(u.length + 1))); if (n != null) return [n, 'sticks']; }
  }
  if (s === 'handful') return [1, 'handful'];
  if (s.endsWith(' handfuls')) { const n = parseNum(s.slice(0, -9)); if (n != null) return [n, 'handful']; }
  if (s === 'bunch') return [1, 'bunch'];
  if (s.endsWith(' bunches')) { const n = parseNum(s.slice(0, -8)); if (n != null) return [n, 'bunch']; }
  const n = parseNum(s);
  return n != null ? [n, ''] : null;
}

function formatCount(value, unit) {
  const whole = Math.floor(value);
  const frac = value - whole;
  let num;
  if (Math.abs(frac) < 0.01) num = String(whole);
  else if (Math.abs(frac - 0.5) < 0.01)  num = whole === 0 ? '½' : whole + '½';
  else if (Math.abs(frac - 0.25) < 0.01) num = whole === 0 ? '¼' : whole + '¼';
  else if (Math.abs(frac - 0.75) < 0.01) num = whole === 0 ? '¾' : whole + '¾';
  else num = value.toFixed(1);
  switch (unit) {
    case 'juiceof': return 'juice of ' + num;
    case 'cloves':  return whole === 1 && frac < 0.01 ? '1 clove' : num + ' cloves';
    case 'sticks':  return whole === 1 && frac < 0.01 ? '1 stick' : num + ' sticks';
    case 'handful': return whole === 1 && frac < 0.01 ? 'handful' : num + ' handfuls';
    case 'bunch':   return whole === 1 && frac < 0.01 ? '1 bunch' : num + ' bunches';
    default:        return num;
  }
}

const PLURALS = { chillies:'chilli', limes:'lime', lemons:'lemon', tomatoes:'tomato', potatoes:'potato', berries:'berry' };

function normalizeKey(name) {
  let n = name.toLowerCase();
  for (const prefix of ['certified gf ', 'gf ', 'tinned ', 'canned ', 'frozen ', 'dried ', 'fresh ']) {
    if (n.startsWith(prefix)) n = n.slice(prefix.length);
  }
  const comma = n.indexOf(',');
  if (comma >= 0) n = n.slice(0, comma);
  for (const size of ['medium ', 'large ', 'small ']) if (n.startsWith(size)) n = n.slice(size.length);
  if (PLURALS[n.trim()]) n = PLURALS[n.trim()];
  return n.trim();
}

function isTinItem(name) {
  const n = name.toLowerCase();
  return n.includes('tinned') || n.includes('coconut milk') || n.includes('coconut cream');
}

function categorise(name) {
  const n = name.toLowerCase();
  if (n.includes('tamari') || n.includes('certified gf') || n.includes('gf oat') ||
      n.includes('oat') || n.includes('gf pasta') || n.includes('poppadom') ||
      n.includes('protein powder') || n.includes('nutritional yeast')) return 'freeFrom';
  if (n.includes('tofu') || n.includes('yoghurt') ||
      n.includes('coconut milk') || n.includes('coconut cream')) return 'chilled';
  if (n.includes('tinned') || n.includes('lentil') || n.includes('split pea') ||
      n.includes('pasta') || (n.includes('rice') && !n.includes('poppadom')) ||
      n.includes('chia') || n.includes('date') || n.includes('pumpkin seed') ||
      n.includes('flaked almond') || n.includes('peanut') ||
      n.includes('almond butter') || n.includes('tahini') ||
      n.includes('stock cube')) return 'tinsDry';
  if (['onion', 'garlic', 'carrot', 'pepper', 'aubergine', 'mushroom', 'spinach', 'kale',
       'banana', 'mango', 'berr', 'lemon', 'lime', 'coriander', 'ginger', 'avocado',
       'tomato', 'celery', 'cauliflower', 'potato', 'cabbage', 'spring onion', 'chilli',
       'lemongrass', 'parsley', 'basil', 'rocket', 'mangetout', 'edamame', 'cucumber',
       'quinoa', 'baby gem', 'cherry'].some(w => n.includes(w))) return 'produce';
  return 'pantry';
}

// Unique cook-fresh recipes across the week → aggregated shopping items
function shoppingItems(cycle, week) {
  const seen = new Set();
  const all = [];
  for (const d of weekDays(cycle, week)) {
    for (const slot of d.slots) {
      if (!slot.recipeId || slot.isBatch || seen.has(slot.recipeId)) continue;
      seen.add(slot.recipeId);
      all.push(...RECIPE_BY_ID[slot.recipeId].ingredients);
    }
  }

  const order = [];
  const groups = {};
  for (const ing of all) {
    const key = normalizeKey(ing.n);
    if (!groups[key]) { groups[key] = []; order.push(key); }
    groups[key].push(ing);
  }

  return order.map(key => {
    const items = groups[key];
    const first = items[0];
    const quantities = items.map(i => i.q);

    let quantity;
    if (items.length === 1) {
      quantity = first.q;
    } else {
      const gs  = quantities.map(q => (/^(\d+(\.\d+)?)g$/i.exec(q.trim()) || [])[1]).filter(v => v != null);
      const mls = quantities.map(q => (/^(\d+(\.\d+)?)ml$/i.exec(q.trim()) || [])[1]).filter(v => v != null);
      if (gs.length === quantities.length)       quantity = Math.round(gs.reduce((a, b) => a + parseFloat(b), 0)) + 'g';
      else if (mls.length === quantities.length) quantity = Math.round(mls.reduce((a, b) => a + parseFloat(b), 0)) + 'ml';
      else if (isTinItem(first.n))               quantity = items.length + ' tins';
      else {
        const parsed = quantities.map(parseCountQ).filter(Boolean);
        const units = new Set(parsed.map(p => p[1]));
        if (parsed.length === quantities.length && units.size === 1) {
          quantity = formatCount(parsed.reduce((a, p) => a + p[0], 0), parsed[0][1]);
        } else {
          const unique = [...new Set(quantities)];
          quantity = unique.length === 1 ? `${items.length} × ${unique[0]}` : quantities.join(' + ');
        }
      }
    }

    let base = first.n;
    const comma = base.indexOf(',');
    if (comma >= 0) base = base.slice(0, comma);
    for (const size of ['medium ', 'large ', 'small ', 'Medium ', 'Large ', 'Small ']) {
      if (base.startsWith(size)) base = base.slice(size.length);
    }

    return {
      key,
      name: base.charAt(0).toUpperCase() + base.slice(1),
      quantity,
      gf: items.some(i => i.gf),
      category: categorise(first.n),
    };
  });
}

function shopStoreKey(cycle, week) { return `nourishShop:${cycle}:${week}`; }

function openShopping(cycle, week) {
  const items = shoppingItems(cycle, week);
  let checked;
  try { checked = new Set(JSON.parse(localStorage.getItem(shopStoreKey(cycle, week))) || []); }
  catch (e) { checked = new Set(); }

  const render = () => {
    let html = `
      <div class="progress-label" style="margin-bottom:10px">
        <span>${cycle === 0 ? 'Custom Week' : `Cycle ${cycle} · Week ${week}`} · ${items.length} items</span>
        <span>${[...checked].filter(k => items.some(i => i.key === k)).length} ticked</span>
      </div>`;
    for (const [cat, title] of SHOP_SECTIONS) {
      const secItems = items.filter(i => i.category === cat);
      if (!secItems.length) continue;
      html += `
        <div class="shop-section">
          <div class="shop-section-title">${title}</div>
          ${secItems.map(i => `
            <div class="shop-item${checked.has(i.key) ? ' checked' : ''}" data-key="${esc(i.key)}">
              <span class="shop-item-name">${esc(i.name)}${i.gf ? '<span class="shop-item-gf">⚠ GF check</span>' : ''}</span>
              <span class="shop-item-qty">${esc(i.quantity)}</span>
            </div>`).join('')}
        </div>`;
    }
    html += '<button class="settings-btn" id="shop-clear">Clear all ticks</button>';
    $('#shopping-content').innerHTML = html;
  };
  render();

  $('#shopping-content').onclick = e => {
    if (e.target.closest('#shop-clear')) {
      checked.clear();
    } else {
      const row = e.target.closest('.shop-item');
      if (!row) return;
      const key = row.dataset.key;
      if (checked.has(key)) checked.delete(key); else checked.add(key);
    }
    localStorage.setItem(shopStoreKey(cycle, week), JSON.stringify([...checked]));
    render();
  };

  const modal = $('#shopping-modal');
  modal.classList.add('open');
  modal.setAttribute('aria-hidden', 'false');
  const body = modal.querySelector('.modal-body');
  body.style.overflowY = 'scroll';   // iOS Safari: must be set explicitly
  body.scrollTop = 0;
}

function closeShopping() {
  const modal = $('#shopping-modal');
  modal.classList.remove('open');
  modal.setAttribute('aria-hidden', 'true');
}

$('#shopping-close').addEventListener('click', closeShopping);
$('#shopping-backdrop').addEventListener('click', closeShopping);

/* ── Settings view ─────────────────────────────────────── */

const CYCLE_OPTIONS = [
  [1, 'Cycle 1', 'Days 1–30'],
  [2, 'Cycle 2', 'Days 31–60'],
  [3, 'Cycle 3', 'Days 61–90'],
  [0, 'Custom Week', 'Build your own week'],
];

function renderSettings() {
  let html = `
    <div class="settings-group">
      <div class="settings-group-title">Meal plan cycle</div>
      ${CYCLE_OPTIONS.map(([val, label, sub]) => `
        <div class="settings-row card-tap" data-cycle="${val}">
          <span class="settings-row-label">${label}<div class="cycle-option-sub">${sub}</div></span>
          <span class="settings-row-value">${settings.cycle === val ? '✓' : ''}</span>
        </div>`).join('')}
    </div>

    <div class="settings-group">
      <div class="settings-group-title">Cycle start date</div>
      <div class="settings-row">
        <span class="settings-row-label">Started</span>
        <input type="date" id="settings-date" value="${settings.startDate}" style="border:none;background:none;color:var(--rust);font-size:16px">
      </div>
      ${settings.cycle > 0 ? `
        <div class="settings-row">
          <span class="settings-row-label">Progress</span>
          <span class="settings-row-value">Day ${Math.min(daysIntoCycle() + 1, CYCLE_DAYS)} of ${CYCLE_DAYS} · Week ${currentWeek()}</span>
        </div>
        <button class="settings-btn" id="settings-restart">Restart cycle from today</button>` : ''}
    </div>

    <div class="settings-group">
      <div class="settings-group-title">Custom week</div>
      <button class="settings-btn" id="settings-randomise">Randomise custom week</button>
      <button class="settings-btn" id="settings-clear-custom">Clear custom week</button>
    </div>

    <div class="settings-group">
      <div class="settings-group-title">App</div>
      <button class="settings-btn settings-btn-danger" id="settings-reset">Reset app</button>
    </div>`;

  const el = $('#settings-content');
  el.innerHTML = html;

  el.querySelector('#settings-date').onchange = e => {
    if (!e.target.value) return;
    settings.startDate = e.target.value;
    saveSettings();
    viewedWeek = null;
    renderSettings();
  };

  el.onclick = e => {
    const cycleRow = e.target.closest('[data-cycle]');
    if (cycleRow) {
      settings.cycle = Number(cycleRow.dataset.cycle);
      saveSettings();
      viewedWeek = null;
      renderSettings();
      return;
    }
    if (e.target.closest('#settings-restart')) {
      settings.startDate = new Date().toISOString().slice(0, 10);
      saveSettings();
      viewedWeek = null;
      renderSettings();
      return;
    }
    if (e.target.closest('#settings-randomise')) {
      randomiseCustomWeek();
      settings.cycle = 0;
      saveSettings();
      renderSettings();
      switchView('week');
      return;
    }
    if (e.target.closest('#settings-clear-custom')) {
      settings.customWeekEntries = {};
      saveSettings();
      renderSettings();
      return;
    }
    if (e.target.closest('#settings-reset')) {
      if (confirm('Reset Nourish? This clears your cycle, training days and custom week.')) {
        localStorage.removeItem(STORE_KEY);
        Object.keys(localStorage)
          .filter(k => k.startsWith('nourishShop:'))
          .forEach(k => localStorage.removeItem(k));
        location.reload();
      }
    }
  };
}

function randomiseCustomWeek() {
  const used = new Set();
  const pick = types => {
    const pool = RECIPES.filter(r => r.mealTypes.some(m => types.includes(m)));
    const fresh = pool.filter(r => !used.has(r.id));
    const chosen = (fresh.length ? fresh : pool)[Math.floor(Math.random() * (fresh.length ? fresh.length : pool.length))];
    if (chosen) used.add(chosen.id);
    return chosen ? chosen.id : null;
  };
  const entries = {};
  for (const day of DAY_KEYS) {
    entries[day] = {
      B: pick(['breakfast']),
      L: pick(['refuel', 'lunch', 'dinner']),
      D: pick(['refuel', 'lunch', 'dinner']),
    };
  }
  settings.customWeekEntries = entries;
}

/* ── Onboarding ────────────────────────────────────────── */

function renderOnboarding() {
  $('#onboarding-steps').innerHTML = `
    <div class="onboarding-label">Which cycle are you on?</div>
    <div id="ob-cycles">
      ${CYCLE_OPTIONS.map(([val, label, sub]) => `
        <label class="cycle-option">
          <input type="radio" name="ob-cycle" value="${val}" ${val === 1 ? 'checked' : ''}>
          <span>
            <div class="cycle-option-label">${label}</div>
            <div class="cycle-option-sub">${sub}</div>
          </span>
        </label>`).join('')}
    </div>
    <div class="onboarding-label" style="margin-top:16px">When did this cycle start?</div>
    <input type="date" id="ob-date" class="onboarding-field" value="${new Date().toISOString().slice(0, 10)}">
    <button class="onboarding-next-btn" id="ob-start">Let's go</button>`;

  $('#ob-start').onclick = () => {
    const picked = document.querySelector('input[name="ob-cycle"]:checked');
    settings.cycle = picked ? Number(picked.value) : 1;
    settings.startDate = $('#ob-date').value || new Date().toISOString().slice(0, 10);
    settings.onboarded = true;
    saveSettings();
    $('#onboarding').setAttribute('aria-hidden', 'true');
    switchView('today');
  };

  $('#onboarding').setAttribute('aria-hidden', 'false');
}

/* ── Boot ──────────────────────────────────────────────── */

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => navigator.serviceWorker.register('sw.js').catch(() => {}));
}

if (settings.onboarded) {
  switchView('today');
} else {
  renderOnboarding();
}
