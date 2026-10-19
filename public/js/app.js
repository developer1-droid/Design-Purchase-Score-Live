/* Purchase & Design Live TV board: wires data, settings, period filters, rotation and the voice together. */
import { $, el, keyOf } from "./dom.js";
import { setMotion } from "./motion.js";
import { createTheme } from "./theme.js";
import {
  PURCHASE_PERIODS,
  DESIGN_PERIODS,
  periodOrLegacy,
  sanitizeSettings,
} from "./settingsModel.js";
import { createSettingsStore, PinError } from "./settingsStore.js";
import { purchaseBoard, designBoard, periodLabel } from "./payload.js";
import { createMisView } from "./misView.js";
import { createPeopleView, cardPeopleOf } from "./peopleView.js";
import { createAnnouncerHost } from "./mascot.js";
import { createSpotView, misSpotModel } from "./spotView.js";
import { createRotation } from "./rotation.js";
import { createFilterBar } from "./filterBar.js";
import { createTicker } from "./ticker.js";
import { createControls } from "./controls.js";
import { createStatus } from "./status.js";
import { startLive, startMock } from "./source.js";
import { createAnnouncer } from "./voice/announcer.js";
import { rememberScores } from "./voice/local.js";
import { onSpeech } from "./voice/speech.js";

const params = new URLSearchParams(location.search);
const IS_MOCK = params.get("mock") === "1";
const RESIZE_DEBOUNCE_MS = 200;
const FIRST_RELAYOUT_MS = 1500;
const purchaseKeys = PURCHASE_PERIODS.map((p) => p.key);
const designKeys = DESIGN_PERIODS.map((p) => p.key);
/* ?purchase= / ?design= may name a period (or an old one, read as the nearest MIS period). */
const urlPeriod = (name, keys) => {
  const key = periodOrLegacy(params.get(name));
  return keys.includes(key) ? key : null;
};

const store = createSettingsStore({ mock: IS_MOCK });
let settings = store.cached();
let data = null;
/* A chip click overrides the shared default on this screen only, until "Set as default". */
let purchaseOverride = urlPeriod("purchase", purchaseKeys);
let designOverride = urlPeriod("design", designKeys);
const purchaseKey = () => purchaseOverride || settings.purchasePeriod;
const designKey = () => designOverride || settings.designPeriod;

const theme = createTheme({
  urlTheme: params.get("theme"),
  shared: settings.theme,
});
setMotion(settings.animation);
const status = createStatus(IS_MOCK ? "demo" : "connecting");
const announcer = createAnnouncer({
  getData: () => data,
  getPeriods: () => ({ purchase: purchaseKey(), design: designKey() }),
  onBlockedChange: () => renderChrome(),
});
announcer.setVoice(settings.voice);
// Whenever the voice speaks, the cartoon announcer comes in from the side with what it says.
const announcerHost = createAnnouncerHost(document.body);
onSpeech((event) => announcerHost.handle(event));

/* ---------------- views ---------------- */
const purchaseView = createMisView({ kind: "purchase" });
const designView = createMisView({ kind: "design" });
const onPerson = (board, index) => announcer.personShown(board, index);
const purchasePeople = createPeopleView({ onPerson });
const designPeople = createPeopleView({ onPerson });
const purchaseSpot = createSpotView();
const designSpot = createSpotView();
const emptyRoot = el("div", "view");
emptyRoot.appendChild(
  el("div", "empty", "Waiting for the first scores from the CRM"),
);

const chipLabel = (list, key) =>
  (list.find((p) => p.key === key) || { chip: key }).chip;
const purchaseLabel = () => periodLabel("purchase", data, purchaseKey());
const designLabel = () => periodLabel("design", data, designKey());
const purchaseNow = () => purchaseBoard(data, purchaseKey());
const designNow = () => designBoard(data, designKey());

/* The first board of each group is named after the group: rotation.go(kind) jumps to it. */
const VIEWS = [
  {
    id: "purchase",
    kind: "board",
    group: "purchase",
    impl: purchaseView,
    rail: "Purchase MIS",
    ok: () => Boolean(data && data.purchase),
    head: () => ({ kicker: "Leaderboard", title: (purchaseNow() || {}).title || "Purchase MIS", period: purchaseLabel() }),
  },
  {
    id: "purchase-people",
    kind: "board",
    group: "purchase",
    impl: purchasePeople,
    rail: "Each person",
    ok: () => cardPeopleOf(purchaseNow()).length > 0,
    head: () => ({ kicker: "Score & delay · one by one", title: "Purchase MIS", period: purchaseLabel() }),
  },
  {
    id: "purchase-leader",
    kind: "spot",
    group: "purchase",
    impl: purchaseSpot,
    rail: "Leader",
    ok: () => Boolean(misSpotModel(purchaseNow())),
    head: () => ({ kicker: "Spotlight", title: "Purchase leader", period: purchaseLabel() }),
  },
  {
    id: "design",
    kind: "board",
    group: "design",
    impl: designView,
    rail: "Designer MIS",
    ok: () => Boolean(data && data.design),
    head: () => ({ kicker: "Leaderboard", title: (designNow() || {}).title || "Designer MIS", period: designLabel() }),
  },
  {
    id: "design-people",
    kind: "board",
    group: "design",
    impl: designPeople,
    rail: "Each person",
    ok: () => cardPeopleOf(designNow()).length > 0,
    head: () => ({ kicker: "Score & delay · one by one", title: "Designer MIS", period: designLabel() }),
  },
  {
    id: "design-leader",
    kind: "spot",
    group: "design",
    impl: designSpot,
    rail: "Leader",
    ok: () => Boolean(misSpotModel(designNow())),
    head: () => ({ kicker: "Spotlight", title: "Designer leader", period: designLabel() }),
  },
];

function showHeader(v) {
  announcer.boardShown(v ? v.id : null);
  const h = v
    ? v.head()
    : { kicker: "Leaderboard", title: "Waiting for scores", period: "" };
  $("kicker").textContent = h.kicker;
  $("title").textContent = h.title;
  $("period").textContent = h.period || "";
  document.title = `${h.title} · Purchase & Design Live`;
  renderChrome();
}

const BOARD_ALIASES = {
  purchaser: "purchase",
  designer: "design",
};
const rotation = createRotation({
  stage: $("stage"),
  views: VIEWS,
  emptyRoot,
  wipe: $("wipe"),
  railList: $("segments"),
  getSettings: () => settings,
  onShow: showHeader,
  startId: BOARD_ALIASES[params.get("board")] || params.get("board"),
  startPaused: params.get("paused") === "1",
});

// While the voice reads the slides, it moves them on (each one stays until its lines are said).
announcer.setRotation(rotation);

/* ---------------- filter bar, ticker, rail note ---------------- */
const filterBar = createFilterBar($("filterbar"), {
  onPick: pickPeriod,
  onSaveDefault: saveDefaultPeriods,
});
const ticker = createTicker($("ticker"));

function renderChrome() {
  const current = VIEWS.find((v) => v.id === rotation.current());
  filterBar.render({
    purchaseKey: purchaseKey(),
    designKey: designKey(),
    focus: current ? current.group : null,
    isDirty:
      purchaseKey() !== settings.purchasePeriod ||
      designKey() !== settings.designPeriod,
    visible: settings.showFilterBar,
  });
  const bits = [];
  if (IS_MOCK) bits.push("Demo data");
  if (rotation.isPaused()) bits.push("Paused · space to resume");
  else if (!settings.rotate) bits.push("Single board");
  const sources = Object.entries(
    (data && data.status && data.status.sources) || {},
  );
  const stale = sources.filter(([, x]) => x === "stale").length;
  const down = sources.filter(([, x]) => x === "error").length;
  if (stale)
    bits.push(`${stale} source${stale > 1 ? "s" : ""} using last good data`);
  if (down) bits.push(`${down} source${down > 1 ? "s" : ""} unavailable`);
  if (announcer.isBlocked()) bits.push("Sound blocked · click once to allow");
  else if (announcer.isSilentHere()) bits.push("Voice off on this screen · Settings → This screen speaks");
  $("railNote").textContent = bits.join("  ·  ");
}

/* ---------------- applying data ---------------- */
function updateBoards({ periodSwitch = false } = {}) {
  if (!data) return;
  const live = (id) => rotation.current() === id;
  const purchase = purchaseNow();
  const design = designNow();
  const trackMoves = !periodSwitch;
  purchaseView.update(purchase, {
    animate: live("purchase"),
    trackMoves,
    periodLabel: chipLabel(PURCHASE_PERIODS, purchaseKey()).toLowerCase(),
  });
  designView.update(design, {
    animate: live("design"),
    trackMoves,
    periodLabel: chipLabel(DESIGN_PERIODS, designKey()).toLowerCase(),
  });
  purchasePeople.update(purchase);
  designPeople.update(design);
  const purchaseModel = misSpotModel(purchase);
  if (purchaseModel) purchaseSpot.update(purchaseModel);
  const designModel = misSpotModel(design);
  if (designModel) designSpot.update(designModel);
  ticker.render({
    visible: settings.showTicker,
    purchase,
    purchaseLabel: chipLabel(PURCHASE_PERIODS, purchaseKey()),
    design,
    designLabel: chipLabel(DESIGN_PERIODS, designKey()),
  });
}

let isFirstData = true;
function applyData(payload) {
  if (!payload || typeof payload !== "object") return;
  data = payload;
  rememberScores(payload);
  status.setData(payload);
  updateBoards();
  rotation.refresh();
  renderChrome();
  if (isFirstData) {
    isFirstData = false;
    setTimeout(() => rotation.relayout(), FIRST_RELAYOUT_MS);
  }
}

function applySettings(next) {
  const prev = settings;
  settings = next;
  if (
    purchaseOverride === settings.purchasePeriod ||
    prev.purchasePeriod !== settings.purchasePeriod
  )
    purchaseOverride = null;
  if (
    designOverride === settings.designPeriod ||
    prev.designPeriod !== settings.designPeriod
  )
    designOverride = null;
  theme.setShared(settings.theme);
  announcer.setVoice(settings.voice);
  setMotion(settings.animation);
  [purchaseView, designView].forEach((v) =>
    v.list.setRowsPerPage(settings.rowsPerPage),
  );
  updateBoards({ periodSwitch: true });
  rotation.refresh({ reschedule: true });
  renderChrome();
}

/* ---------------- periods ---------------- */
function pickPeriod(kind, key) {
  if (kind === "purchase")
    purchaseOverride = key === settings.purchasePeriod ? null : key;
  else designOverride = key === settings.designPeriod ? null : key;
  updateBoards({ periodSwitch: true });
  rotation.refresh();
  const current = VIEWS.find((v) => v.id === rotation.current());
  if (!current || current.group !== kind) rotation.go(kind);
  else showHeader(current);
}

function saveDefaultPeriods() {
  return store
    .save({ purchasePeriod: purchaseKey(), designPeriod: designKey() })
    .then(applySettings)
    .catch((err) => {
      throw err instanceof PinError
        ? new Error("PIN needed: open settings (S)")
        : err;
    });
}

/* ---------------- controls ---------------- */
createControls({
  onTheme: () => theme.toggle(),
  onSettings: () => {
    location.href = `settings.html${IS_MOCK ? "?mock=1" : ""}`;
  },
  onKey: (e) => {
    const key = keyOf(e);
    if (key.toLowerCase() === "v") {
      announcer.speakNow();
      return;
    }
    if (key === "ArrowRight") {
      rotation.step(1);
      return;
    }
    if (key === "ArrowLeft") {
      rotation.step(-1);
      return;
    }
    if (key === " ") {
      e.preventDefault();
      rotation.togglePause();
      renderChrome();
      return;
    }
    const n = Number(key);
    if (n >= 1 && n <= purchaseKeys.length)
      pickPeriod("purchase", purchaseKeys[n - 1]);
  },
});

let resizeTimer = null;
window.addEventListener("resize", () => {
  clearTimeout(resizeTimer);
  resizeTimer = setTimeout(() => rotation.relayout(), RESIZE_DEBOUNCE_MS);
});
// A TV can lay the board out before its fonts and screen size settle (rows then overflow and
// look cut off): measure again once they have, and once shortly after the first scores.
window.addEventListener("load", () => rotation.relayout());
if (document.fonts && document.fonts.ready) {
  document.fonts.ready.then(() => rotation.relayout()).catch(() => {});
}

/* ---------------- start ---------------- */
applySettings(settings);
if (IS_MOCK) {
  store.onExternalChange(applySettings);
  startMock({
    onScores: applyData,
    onConn: status.setConn,
    padRows: Number(params.get("rows")) || 0,
    still: params.get("still") === "1",
  });
} else {
  store
    .load()
    .then(applySettings)
    .catch(() => {
      /* keep the cached settings; the socket sends fresh ones */
    });
  startLive({
    onScores: applyData,
    onSettings: (s) =>
      applySettings(store.remember(sanitizeSettings(s, settings))),
    onConn: (state) =>
      status.setConn(
        state === "reconnecting" && !status.hasData() ? "offline" : state,
      ),
  });
}
