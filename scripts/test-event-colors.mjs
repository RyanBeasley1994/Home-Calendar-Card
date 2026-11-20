// Event colours (use_event_colors) – data flow from the "Google Calendar (event colours)" integration
// (github.com/Jam3s97/ha-google-calendar-event-colors) through to the rendered event.
//
// That integration doesn't add a colour to events (Home Assistant's calendar API has no such field). It splits
// a Google calendar into one calendar entity per event colour, each with a hex `color` state attribute, e.g.
//   calendar.family          – the real calendar, all events, no `color` attribute
//   calendar.family_school   – color: "#33b679" (Sage)
//   calendar.family_doctor   – color: "#d50000" (Tomato)
//   calendar.family_other    – color: the calendar's own colour; events with no colour of their own
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync(new URL("../dist/home-calendar-card.js", import.meta.url), "utf8");
const between = (a, b) => {
  const i = source.indexOf(a);
  const j = source.indexOf(b, i);
  assert.ok(i >= 0 && j > i, `source markers not found: ${a} … ${b}`);
  return source.slice(i, j);
};

// module-level helpers, with the theme table they read
const themes = between("const THEMES = {", "const THEME_VARS");
const helpers = between("/* ---- event colours (use_event_colors) ----", "/* ---- end event colours ---- */");
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const H = new Function(`${themes}; ${helpers}; return { THEMES, cleanColor, luminance, inkFor, toneEventColor, colorSiblings, colorEntities, isOtherColorEntity, eventKey };`)();

// the card's own methods, bound to a small stand-in card
const methods = between("  _useEventColors() {", "  // Calendar filters: false = leave this event out of the card");
const colorMethods = between("  _eventColor(e, cal) {", "  _onDay(day) {");
const proto = new Function("cleanColor", "colorSiblings", "colorEntities", "isOtherColorEntity", "eventKey", "toneEventColor", "inkFor", "esc", "console",
  `return (class {${methods}${colorMethods}}).prototype;`)(H.cleanColor, H.colorSiblings, H.colorEntities, H.isOtherColorEntity, H.eventKey, H.toneEventColor, H.inkFor, esc,
  { warn: () => {} });

const ev = (uid, summary, start, extra = {}) => ({
  uid, summary, start: { dateTime: start }, end: { dateTime: start.replace("T09", "T10") },
  description: "", location: "", recurrence_id: null, rrule: null, ...extra,
});
// What GET /api/calendars/<entity> returns for each entity (the split entities return a subset of the parent)
const school = ev("a1", "School appointment", "2026-11-20T09:00:00-05:00");
const doctor = ev("a2", "Doctor appointment", "2026-11-21T09:00:00-05:00");
const bday = { uid: "a3", summary: "Mia's birthday", start: { date: "2026-11-22" }, end: { date: "2026-11-23" } };
const work = ev("a4", "Work meeting", "2026-11-23T09:00:00-05:00");
const plain = ev("a5", "Family dinner", "2026-11-24T09:00:00-05:00");
const weekly1 = ev("r1", "Swimming", "2026-11-20T09:00:00-05:00", { recurrence_id: "20261120T140000Z", rrule: "FREQ=WEEKLY" });
const weekly2 = ev("r1", "Swimming", "2026-11-27T09:00:00-05:00", { recurrence_id: "20261127T140000Z", rrule: "FREQ=WEEKLY" });
const API = {
  "calendar.family": [school, doctor, bday, work, plain, weekly1, weekly2],
  "calendar.family_school": [school, weekly1],
  "calendar.family_doctor": [doctor],
  "calendar.family_birthday": [bday],
  "calendar.family_work": [work, weekly2],
  "calendar.family_other": [plain],
  "calendar.plain": [plain],
};
const STATES = {
  "calendar.family": { attributes: { friendly_name: "Family", offset_reached: false } },
  "calendar.family_school": { attributes: { friendly_name: "Family School", color: "#33b679" } },
  "calendar.family_doctor": { attributes: { friendly_name: "Family Doctor", color: "#d50000" } },
  "calendar.family_birthday": { attributes: { friendly_name: "Family Birthday", color: "#8e24aa" } },
  "calendar.family_work": { attributes: { friendly_name: "Family Work", color: "#039BE5" } },
  "calendar.family_other": { attributes: { friendly_name: "Family Other", color: "#9fe1e7" } },
  "calendar.plain": { attributes: { friendly_name: "Plain", offset_reached: false } },
  "calendar.plain_extra": { attributes: { friendly_name: "Another calendar" } }, // no colour: not a split
};

const card = (config = {}, { states = STATES, api = API, fail = [] } = {}) => {
  const calls = [];
  return Object.assign(Object.create(proto), {
    calls,
    _config: { calendars: [], ...config },
    _hass: {
      states,
      callApi: async (method, path) => {
        const ent = path.split("?")[0].replace("calendars/", "");
        calls.push(ent);
        if (fail.includes(ent)) throw new Error("boom");
        return structuredClone(api[ent] || []);
      },
    },
  });
};
const START = "2026-11-16T05:00:00.000Z";
const END = "2026-11-30T05:00:00.000Z";
const colours = (evs) => Object.fromEntries(evs.map((e) => [`${e.summary}@${e.start.dateTime || e.start.date}`, e._hccColor ?? null]));
const CAL = { entity: "calendar.family", color: "#3B82F6" };

test("cleanColor accepts #rgb / #rrggbb in any case and rejects everything else", () => {
  assert.equal(H.cleanColor("#33b679"), "#33B679");
  assert.equal(H.cleanColor(" #D50000 "), "#D50000");
  assert.equal(H.cleanColor("#abc"), "#AABBCC");
  for (const bad of [undefined, null, "", "red", "33b679", "#12345", "#1234567", "#ggg", "rgb(1,2,3)", "var(--x)", 7, {}, "#33b679;background:red"]) {
    assert.equal(H.cleanColor(bad), null, String(bad));
  }
});

test("finds the colour entities split off a calendar, and only those", () => {
  assert.deepEqual(H.colorSiblings(STATES, "calendar.family").sort(),
    ["calendar.family_birthday", "calendar.family_doctor", "calendar.family_other", "calendar.family_school", "calendar.family_work"]);
  assert.deepEqual(H.colorSiblings(STATES, "calendar.plain"), []); // calendar.plain_extra has no colour
  assert.deepEqual(H.colorSiblings(STATES, "calendar.family_school"), []);
  assert.deepEqual(H.colorSiblings(undefined, "calendar.family"), []);
});

test("events of one calendar get their own Google colours (several colours, one calendar)", async () => {
  const c = card();
  const evs = await c._calEvents("calendar.family", START, END);
  assert.equal(evs.length, 7, "every event of the calendar is still there");
  assert.deepEqual(colours(evs), {
    "School appointment@2026-11-20T09:00:00-05:00": "#33B679",
    "Doctor appointment@2026-11-21T09:00:00-05:00": "#D50000",
    "Mia's birthday@2026-11-22": "#8E24AA",
    "Work meeting@2026-11-23T09:00:00-05:00": "#039BE5",
    "Family dinner@2026-11-24T09:00:00-05:00": null, // in "Other": no colour of its own
    // one recurring series, each occurrence in its own colour
    "Swimming@2026-11-20T09:00:00-05:00": "#33B679",
    "Swimming@2026-11-27T09:00:00-05:00": "#039BE5",
  });
  assert.ok(!c.calls.includes("calendar.family_other"), "the Other entity is not read");
});

test("a colour entity in the card colours all of its events", async () => {
  const evs = await card()._calEvents("calendar.family_doctor", START, END);
  assert.deepEqual(evs.map((e) => e._hccColor), ["#D50000"]);
  const other = await card()._calEvents("calendar.family_other", START, END);
  assert.deepEqual(other.map((e) => e._hccColor), [undefined]);
});

test("without the integration: one request, events untouched", async () => {
  const states = { "calendar.plain": STATES["calendar.plain"], "calendar.plain_extra": STATES["calendar.plain_extra"] };
  const c = card({}, { states });
  const evs = await c._calEvents("calendar.plain", START, END);
  assert.deepEqual(c.calls, ["calendar.plain"]);
  assert.deepEqual(evs, API["calendar.plain"]);
});

test("a calendar whose entity id was changed (calendar.personal_2) still gets its colours", async () => {
  // HA kept calendar.personal_2 from before; the integration named the colour entities calendar.personal_…
  const p1 = ev("p1", "Dentist", "2026-11-20T09:00:00-05:00");
  const p2 = ev("p2", "Parents evening", "2026-11-21T09:00:00-05:00");
  const p3 = ev("p3", "Gym", "2026-11-22T09:00:00-05:00");
  const api = { ...API, "calendar.personal_2": [p1, p2, p3], "calendar.personal_tomato": [p1], "calendar.personal_sage": [p2], "calendar.personal_other": [p3] };
  const states = { ...STATES, "calendar.personal_2": { attributes: {} },
    "calendar.personal_tomato": { attributes: { color: "#d50000" } }, "calendar.personal_sage": { attributes: { color: "#33b679" } },
    "calendar.personal_other": { attributes: { color: "#9fe1e7" } } };
  const c = card({}, { states, api });
  const evs = await c._calEvents("calendar.personal_2", START, END);
  assert.deepEqual(evs.map((e) => e._hccColor), ["#D50000", "#33B679", undefined]);
  // a calendar with no colour entities of its own: unrelated colour entities don't change its events
  assert.ok((await c._calEvents("calendar.plain", START, END)).every((e) => e._hccColor === undefined));
});

test("each colour entity is read once per refresh, however many calendars use it", async () => {
  const c = card();
  await Promise.all(["calendar.family", "calendar.plain"].map((ent) => c._calEvents(ent, START, END)));
  const reads = c.calls.filter((e) => e !== "calendar.family" && e !== "calendar.plain");
  assert.deepEqual([...reads].sort(), [...new Set(reads)].sort());
  assert.equal(reads.length, 4); // school, doctor, birthday, work – not other
});

test("events named after this calendar win over another calendar's colour for the same event", async () => {
  // the same Google event (same uid) on two split calendars, in different colours
  const shared = ev("s1", "School play", "2026-11-25T09:00:00-05:00");
  const api = { ...API, "calendar.family": [shared], "calendar.family_school": [shared], "calendar.work_red": [shared] };
  const states = { ...STATES, "calendar.work_red": { attributes: { color: "#d50000" } } };
  const evs = await card({}, { states, api })._calEvents("calendar.family", START, END);
  assert.equal(evs[0]._hccColor, "#33B679");
});

test("use_event_colors: false reads only the configured calendar", async () => {
  const c = card({ use_event_colors: false });
  const evs = await c._calEvents("calendar.family", START, END);
  assert.deepEqual(c.calls, ["calendar.family"]);
  assert.ok(evs.every((e) => e._hccColor === undefined));
  assert.deepEqual(c._eventColor({ _hccColor: "#D50000" }, CAL), { color: "#3B82F6", ink: null, ownColor: false });
});

test("a colour entity that can't be read leaves its events in the calendar colour", async () => {
  const evs = await card({}, { fail: ["calendar.family_doctor"] })._calEvents("calendar.family", START, END);
  assert.equal(evs.length, 7);
  assert.equal(evs.find((e) => e.uid === "a2")._hccColor, undefined);
  assert.equal(evs.find((e) => e.uid === "a1")._hccColor, "#33B679");
});

test("invalid colour attributes are ignored", async () => {
  const states = { ...STATES, "calendar.family_doctor": { attributes: { color: "tomato" } }, "calendar.family_work": { attributes: { color: "" } } };
  const c = card({}, { states });
  const evs = await c._calEvents("calendar.family", START, END);
  assert.equal(evs.find((e) => e.uid === "a2")._hccColor, undefined);
  assert.equal(evs.find((e) => e.uid === "a4")._hccColor, undefined);
  assert.ok(!c.calls.includes("calendar.family_doctor"));
  assert.deepEqual(c._eventColor({ _hccColor: "javascript:alert(1)" }, CAL), { color: "#3B82F6", ink: null, ownColor: false });
});

test("priority: event colour, then the calendar colour (configured or automatic)", () => {
  const c = card();
  assert.deepEqual(c._eventColor({ _hccColor: "#D50000" }, CAL), { color: "#D50000", ink: "#FFFFFF", ownColor: true });
  assert.deepEqual(c._eventColor({}, CAL), { color: "#3B82F6", ink: null, ownColor: false });
  assert.deepEqual(c._eventColor({ _hccColor: null }, { entity: "x", color: "var(--hcc-accent)" }),
    { color: "var(--hcc-accent)", ink: null, ownColor: false });
});

test("readable text: dark on light colours, white on dark ones", () => {
  const ink = (hex) => H.inkFor(hex);
  for (const light of ["#F6BF26", "#E4C441", "#C0CA33", "#B39DDB", "#FFFFFF", "#9FE1E7"]) assert.equal(ink(light), "#1F2937", light);
  for (const dark of ["#D50000", "#3F51B5", "#0B8043", "#8E24AA", "#616161", "#795548", "#000000"]) assert.equal(ink(dark), "#FFFFFF", dark);
  // every Google event colour gets at least 3:1 contrast (WCAG large/bold text – event bars are bold)
  const google = ["#7986CB", "#33B679", "#8E24AA", "#E67C73", "#F6BF26", "#F4511E", "#039BE5", "#616161", "#3F51B5", "#0B8043", "#D50000",
    "#AD1457", "#D81B60", "#EF6C00", "#F09300", "#E4C441", "#C0CA33", "#7CB342", "#009688", "#4285F4", "#B39DDB", "#9E69AF", "#A79B8E", "#795548"];
  for (const theme of [undefined, "midnight", "graphite", "nordic"]) {
    for (const g of google) {
      const bg = H.toneEventColor(g, theme);
      const [a, b] = [H.luminance(bg), H.luminance(ink(bg))].sort((x, y) => y - x);
      assert.ok((a + 0.05) / (b + 0.05) >= 3, `${g} on ${theme}: ${((a + 0.05) / (b + 0.05)).toFixed(2)}`);
    }
  }
});

test("Midnight: bright colours are toned down, dark ones and light themes are untouched", () => {
  const c = card({ theme: "midnight" });
  const banana = c._eventColor({ _hccColor: "#F6BF26" }, CAL);
  assert.notEqual(banana.color, "#F6BF26");
  assert.ok(H.luminance(banana.color) < H.luminance("#F6BF26"));
  assert.equal(banana.ink, H.inkFor(banana.color));
  assert.equal(c._eventColor({ _hccColor: "#3F51B5" }, CAL).color, "#3F51B5");
  assert.equal(card({ theme: "nordic" })._eventColor({ _hccColor: "#F6BF26" }, CAL).color, "#F6BF26");
  assert.equal(card()._eventColor({ _hccColor: "#F6BF26" }, CAL).color, "#F6BF26");
});

test("CSS variables for an event: --ct only for event colours", () => {
  const c = card();
  assert.equal(c._evVars({ cal: CAL, ...c._eventColor({}, CAL) }), "--c:#3B82F6");
  assert.equal(c._evVars({ cal: CAL, ...c._eventColor({ _hccColor: "#F6BF26" }, CAL) }), "--c:#F6BF26;--ct:#1F2937");
  assert.equal(c._evVars({ cal: CAL }), "--c:#3B82F6", "events made elsewhere fall back to the calendar colour");
});

test("every event view uses the event's colour, not its calendar's", () => {
  // only the calendar dot in the event details still shows the calendar's own colour
  assert.deepEqual(source.match(/.{0,24}--c:\$\{esc\(ev\.cal\.color\)\}/g), [' class="cal-dot" style="--c:${esc(ev.cal.color)}']);
  // agenda, week (list + timeline), month (+ holiday labels), planner, multi-day bars, year, screensaver, holidays
  assert.ok((source.match(/\$\{this\._evVars\(ev\)\}/g) || []).length >= 12);
  assert.match(source, /class="dlg-head" style="\$\{this\._evVars\(ev\)\}"/, "event details header");
  for (const sel of [".mbar, .wbar, .pbar {", ".wev.allday {", ".mev.allday {", ".yseg {"]) {
    const rule = source.slice(source.indexOf(sel), source.indexOf("}", source.indexOf(sel) + sel.length));
    assert.match(rule, /color: var\(--ct, #fff\)/, sel);
  }
  // the main views, countdowns and the screensaver all go through the colour-aware fetch
  assert.equal((source.match(/this\._calEvents\(/g) || []).length, 3);
});

test("Pastel theme: defined like the others, CSS scoped to it, dark text readable on every pastel card", () => {
  const t = H.THEMES.pastel;
  assert.equal(t.dark, false);
  for (const k of ["bg", "text", "muted", "line", "soft", "accent", "onAccent"]) assert.ok(t.vars[k], k);
  assert.equal(t.palette.length, 8);
  assert.ok(t.palette.every((c) => H.cleanColor(c) === c));
  assert.match(source, /\n {2}pastel: {3}\{ birthday:/, "countdown colours");
  // every pastel rule only applies to the Pastel theme
  const css = source.split("\n").filter((l) => l.includes("pastel") && /^[:.]/.test(l));
  assert.ok(css.length >= 10);
  assert.ok(css.every((l) => l.startsWith(':host([data-theme="pastel"])')), css.find((l) => !l.startsWith(':host([data-theme="pastel"])')));
  // cards are color-mix(colour 42%, white) with the theme text colour: WCAG AA (4.5:1) for palette + Google colours
  const mix = (hex) => "#" + [1, 3, 5].map((i) => Math.round(parseInt(hex.slice(i, i + 2), 16) * 0.42 + 255 * 0.58).toString(16).padStart(2, "0")).join("");
  const google = ["#7986CB", "#33B679", "#8E24AA", "#E67C73", "#F6BF26", "#F4511E", "#039BE5", "#616161", "#3F51B5", "#0B8043", "#D50000",
    "#AD1457", "#D81B60", "#EF6C00", "#F09300", "#E4C441", "#C0CA33", "#7CB342", "#009688", "#4285F4", "#B39DDB", "#9E69AF", "#A79B8E", "#795548"];
  for (const c of [...t.palette, ...google]) {
    const r = (H.luminance(mix(c)) + 0.05) / (H.luminance(t.vars.text) + 0.05);
    assert.ok(r >= 4.5, `${c}: ${r.toFixed(2)}`);
  }
});
