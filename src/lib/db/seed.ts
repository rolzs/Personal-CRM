// Sample data inserted on first launch so the app is not empty.
// Every row is flagged is_sample = 1; "Clear sample data" removes exactly these.
// Dates are relative to "now" so there are always overdue, today and upcoming reminders.

import { insertBatch, newId } from "./store.svelte";
import type { Activity, Contact, Deal, Reminder } from "./types";

const HOUR = 3_600_000;
const DAY = 24 * HOUR;

export function seedSampleData(now = Date.now()): void {
  const at = (dayOffset: number, h: number, m = 0) => {
    const d = new Date(now);
    d.setDate(d.getDate() + dayOffset);
    d.setHours(h, m, 0, 0);
    return d.getTime();
  };

  const contact = (name: string, company: string, email: string, phone: string, status: Contact["status"], tags: string[], notes: string, createdDaysAgo: number): Contact => ({
    id: newId(), name, company, email, phone, status, tags, notes,
    created_at: now - createdDaysAgo * DAY, updated_at: now - createdDaysAgo * DAY,
    last_contacted_at: null, is_sample: 1,
  });

  const janis = contact("Jānis Bērziņš", "SIA Baltijas Koks", "janis.berzins@baltijaskoks.example", "+371 2912 3456", "active", ["klients", "kokrūpniecība"], "Galvenā kontaktpersona iepirkumos. Dod priekšroku zvaniem no rīta.", 120);
  const liga = contact("Līga Ozoliņa", "SIA Rīgas Dizaina Birojs", "liga@rdb.example", "+371 2645 7788", "lead", ["dizains", "ieteikums"], "Iepazināmies konferencē “Digitālā Latvija”. Interesē mājaslapas pārbūve.", 21);
  const andris = contact("Andris Kalniņš", "AS Latvijas Logi", "andris.kalnins@latvijaslogi.example", "+371 2233 4455", "waiting", ["klients", "ražošana"], "Gaida valdes lēmumu par budžetu.", 200);
  const ilze = contact("Ilze Liepiņa", "SIA Zaļā Pļava", "ilze@zalaplava.example", "+371 2877 1100", "active", ["klients", "bio"], "Ikmēneša atskaites līdz 5. datumam.", 340);
  const martins = contact("Mārtiņš Krūmiņš", "IK Krūmiņš un Dēli", "martins@krumins.example", "+371 2001 9090", "closed", ["būvniecība"], "Projekts noslēgts 2025. gadā. Iespējama sadarbība nākotnē.", 500);

  const activity = (c: Contact, type: Activity["type"], text: string, ts: number): Activity => {
    c.last_contacted_at = Math.max(c.last_contacted_at ?? 0, ts);
    return { id: newId(), contact_id: c.id, type, text, timestamp: ts, is_sample: 1 };
  };
  const activities: Activity[] = [
    activity(janis, "call", "Pārrunājām decembra pasūtījumu, lūdza atsūtīt rēķinu.", at(-2, 10, 15)),
    activity(janis, "email", "Nosūtīts atjaunotais cenrādis 2027. gadam.", at(-9, 14, 0)),
    activity(janis, "meeting", "Tikšanās birojā – iepazīstināja ar jauno ražošanas vadītāju.", at(-30, 11, 0)),
    activity(liga, "meeting", "Pirmā tikšanās kafejnīcā, izrunājām mājaslapas vajadzības.", at(-6, 15, 30)),
    activity(liga, "email", "Nosūtīts piedāvājums un portfolio.", at(-5, 9, 40)),
    activity(andris, "call", "Budžets vēl nav apstiprināts, atzvanīt pēc valdes sēdes.", at(-18, 13, 0)),
    activity(andris, "note", "Konkurents piedāvājis zemāku cenu – jāsagatavo argumenti.", at(-25, 16, 20)),
    activity(ilze, "email", "Nosūtīta oktobra atskaite.", at(-41, 10, 0)),
    activity(ilze, "call", "Apspriedām jauno produktu līniju pavasarim.", at(-55, 11, 30)),
    activity(martins, "note", "Projekts pabeigts, saņemta pozitīva atsauksme.", at(-95, 12, 0)),
  ];

  const deal = (c: Contact, title: string, value: number, stage: Deal["stage"], dueOffset: number | null, notes = ""): Deal => ({
    id: newId(), contact_id: c.id, title, value, stage, due_date: dueOffset === null ? null : at(dueOffset, 12),
    notes, created_at: now - 20 * DAY, updated_at: now - 2 * DAY, is_sample: 1,
  });
  const dealJanis = deal(janis, "Kokmateriālu piegāde 2027", 12500, "in_progress", 14, "Līgums saskaņošanā.");
  const dealLiga = deal(liga, "Mājaslapas pārbūve", 4800, "new", 30);
  const dealAndris = deal(andris, "Noliktavas uzskaites sistēma", 18900, "in_progress", 45);
  const deals: Deal[] = [
    dealJanis, dealLiga, dealAndris,
    deal(ilze, "Iepakojuma dizains", 2350, "won", -10),
    deal(martins, "Biroja renovācijas konsultācijas", 6200, "lost", -60),
  ];

  const reminder = (title: string, datetime: number, c: Contact | null, extra: Partial<Reminder> = {}): Reminder => ({
    id: newId(), title, datetime, duration: null, contact_id: c?.id ?? null, deal_id: null, done: false,
    done_at: null, repeat: "none", snoozed_until: null, created_at: now, is_sample: 1, ...extra,
  });
  const soon = Math.ceil((now + 2 * HOUR) / (15 * 60_000)) * 15 * 60_000;
  const reminders: Reminder[] = [
    // Overdue
    reminder("Nosūtīt rēķinu Jānim", at(-1, 9), janis, { deal_id: dealJanis.id }),
    reminder("Atzvanīt Andrim par budžetu", at(-3, 14), andris, { deal_id: dealAndris.id }),
    // Today
    reminder("Zvanīt Līgai par piedāvājumu", soon, liga, { deal_id: dealLiga.id }),
    reminder("Sagatavot līguma projektu", at(0, 17), janis, { duration: 60 }),
    // Upcoming
    reminder("Tikšanās ar Ilzi – pavasara kolekcija", at(1, 10), ilze, { duration: 90 }),
    reminder("Nosūtīt mēneša atskaiti", at(3, 9), ilze, { repeat: "monthly" }),
    reminder("Nedēļas plānošana", at(6, 9), null, { repeat: "weekly", duration: 30 }),
    reminder("Apsveikt Mārtiņu vārda dienā", at(10, 9), martins),
  ];

  insertBatch({ contacts: [janis, liga, andris, ilze, martins], deals, activities, reminders });
}
