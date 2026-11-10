import PDFDocument from 'pdfkit';
import QRCode from 'qrcode';
import fs from 'node:fs';
import path from 'node:path';
import type { Machine } from '@prisma/client';
import { config, SERVER_ROOT, timeInTz, type Lang } from '../lib.js';
import { readFile } from '../storage.js';
import { pt } from './i18n.js';

const GREEN = '#7AA621';
const LIME = '#9CC53A';
const YELLOW = '#F6D31B';
const GREEN_LIGHT = '#F4F9E6';
const LOGO = path.join(SERVER_ROOT, 'assets', 'logo.jpg');
const hasLogo = fs.existsSync(LOGO);
const DARK = '#1F2A1A';
const GREY = '#6B7280';
const RED = '#C0392B';
const MARGIN = 45;

type Doc = PDFKit.PDFDocument;

function toBuffer(doc: Doc): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    doc.on('data', (c: Buffer) => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);
    doc.end();
  });
}

function fmtDate(d: string, lang: Lang) {
  const [y, m, day] = d.split('-');
  return lang === 'en' ? `${y}-${m}-${day}` : `${day}.${m}.${y}`;
}

function fmtDateTime(d: Date, lang: Lang) {
  const locale = lang === 'de' ? 'de-DE' : lang === 'es' ? 'es-ES' : 'en-GB';
  return new Intl.DateTimeFormat(locale, {
    timeZone: config.timezone,
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(d);
}

export interface ReportMeta {
  lang: Lang;
  from: string;
  to: string;
  machineLabel: string | null;
  generatedBy: string;
}

function newDoc(): Doc {
  return new PDFDocument({ size: 'A4', margin: MARGIN, bufferPages: true, info: { Producer: 'Froobie' } });
}

function header(doc: Doc, title: string, meta: ReportMeta) {
  const t = pt(meta.lang);
  const w = doc.page.width;
  // Cabecera blanca con logo y franjas verde/amarillo
  if (hasLogo) doc.image(LOGO, MARGIN, 14, { width: 62 });
  else doc.fillColor(LIME).font('Helvetica-Bold').fontSize(24).text('froobie', MARGIN, 30);
  doc.fillColor(DARK).font('Helvetica-Bold').fontSize(17).text(title, MARGIN + 80, 28, { width: w - 2 * MARGIN - 80, align: 'right' });
  doc.fillColor(GREY).font('Helvetica').fontSize(9).text('Quality & Hygiene · Taste the honesty', MARGIN + 80, 52, { width: w - 2 * MARGIN - 80, align: 'right' });
  doc.rect(0, 84, w, 4).fill(LIME);
  doc.rect(0, 88, w, 2).fill(YELLOW);
  doc.y = 104;
  doc.fillColor(DARK).font('Helvetica').fontSize(10);
  doc.text(`${t('period')}: ${fmtDate(meta.from, meta.lang)} – ${fmtDate(meta.to, meta.lang)}`, MARGIN);
  doc.text(`${t('machine')}: ${meta.machineLabel ?? t('allMachines')}`);
  doc.fillColor(GREY).text(`${t('generated')} ${fmtDateTime(new Date(), meta.lang)} ${t('by')} ${meta.generatedBy}`);
  doc.moveDown(1);
  doc.fillColor(DARK);
}

function footer(doc: Doc, lang: Lang) {
  const t = pt(lang);
  const range = doc.bufferedPageRange();
  for (let i = 0; i < range.count; i++) {
    doc.switchToPage(range.start + i);
    const bottom = doc.page.height - 30;
    doc.page.margins.bottom = 0;
    doc
      .fillColor(GREY)
      .fontSize(8)
      .text(`Froobie · ${t('page')} ${i + 1} ${t('of')} ${range.count}`, MARGIN, bottom, {
        width: doc.page.width - 2 * MARGIN,
        align: 'center',
        lineBreak: false,
      });
  }
}

function ensureSpace(doc: Doc, needed: number) {
  if (doc.y + needed > doc.page.height - MARGIN - 20) {
    doc.addPage();
    doc.y = MARGIN;
  }
}

function sectionTitle(doc: Doc, text: string) {
  ensureSpace(doc, 40);
  doc.moveDown(0.5).font('Helvetica-Bold').fontSize(13).fillColor(GREEN).text(text, MARGIN);
  const y = doc.y + 2;
  doc.moveTo(MARGIN, y).lineTo(doc.page.width - MARGIN, y).strokeColor(GREEN).lineWidth(1).stroke();
  doc.moveDown(0.6).fillColor(DARK).font('Helvetica').fontSize(10);
}

/** Tabla simple con cabecera verde. */
function table(doc: Doc, cols: { label: string; width: number; align?: 'left' | 'right' | 'center' }[], rows: string[][]) {
  const rowH = 18;
  const drawHeader = () => {
    ensureSpace(doc, rowH * 2);
    let x = MARGIN;
    const y = doc.y;
    doc.rect(MARGIN, y, cols.reduce((a, c) => a + c.width, 0), rowH).fill(GREEN);
    doc.font('Helvetica-Bold').fontSize(9).fillColor('#fff');
    for (const c of cols) {
      doc.text(c.label, x + 4, y + 5, { width: c.width - 8, align: c.align ?? 'left', lineBreak: false });
      x += c.width;
    }
    doc.y = y + rowH;
  };
  drawHeader();
  rows.forEach((r, i) => {
    if (doc.y + rowH > doc.page.height - MARGIN - 20) {
      doc.addPage();
      doc.y = MARGIN;
      drawHeader();
    }
    const y = doc.y;
    if (i % 2 === 1) doc.rect(MARGIN, y, cols.reduce((a, c) => a + c.width, 0), rowH).fill(GREEN_LIGHT);
    let x = MARGIN;
    doc.font('Helvetica').fontSize(9).fillColor(DARK);
    cols.forEach((c, ci) => {
      doc.text(r[ci] ?? '', x + 4, y + 5, { width: c.width - 8, align: c.align ?? 'left', lineBreak: false, ellipsis: true });
      x += c.width;
    });
    doc.y = y + rowH;
  });
  doc.moveDown(0.5);
}

function checkbox(doc: Doc, x: number, y: number, checked: boolean) {
  doc.lineWidth(1).strokeColor(checked ? GREEN : RED).rect(x, y, 9, 9).stroke();
  if (checked) {
    doc.moveTo(x + 2, y + 4.5).lineTo(x + 4, y + 7).lineTo(x + 7.5, y + 2).strokeColor(GREEN).lineWidth(1.5).stroke();
  } else {
    doc.moveTo(x + 2, y + 2).lineTo(x + 7, y + 7).moveTo(x + 7, y + 2).lineTo(x + 2, y + 7).strokeColor(RED).stroke();
  }
}

function badge(doc: Doc, text: string, x: number, y: number, color: string) {
  doc.font('Helvetica-Bold').fontSize(8);
  const w = doc.widthOfString(text) + 10;
  doc.roundedRect(x, y, w, 13, 3).fill(color);
  doc.fillColor('#fff').text(text, x + 5, y + 3, { lineBreak: false });
  doc.fillColor(DARK);
  return w;
}

function noData(doc: Doc, lang: Lang) {
  doc.moveDown(1).fillColor(GREY).fontSize(11).text(pt(lang)('noData'), MARGIN).fillColor(DARK);
}

// ---------------------------------------------------------------------------

export interface CleaningRow {
  date: string;
  completedAt: Date;
  machine: { number: number; name: string };
  user: { fullName: string };
  planName: string;
  wasStrict: boolean;
  status: string;
  comment: string | null;
  signature: string;
  steps: { text: string; checked: boolean }[];
  incidents: { description: string; severity: string }[];
}

export async function cleaningReportPdf(rows: CleaningRow[], meta: ReportMeta) {
  const t = pt(meta.lang);
  const doc = newDoc();
  header(doc, t('cleaningReport'), meta);

  if (!rows.length) {
    noData(doc, meta.lang);
  } else {
    sectionTitle(doc, `${t('total')}: ${rows.length} ${t('records')}`);
    table(
      doc,
      [
        { label: t('date'), width: 65 },
        { label: t('time'), width: 40 },
        { label: t('machine'), width: 125 },
        { label: t('worker'), width: 105 },
        { label: t('strict'), width: 80 },
        { label: t('status'), width: 90 },
      ],
      rows.map((r) => [
        fmtDate(r.date, meta.lang),
        timeInTz(r.completedAt),
        `Nº${r.machine.number} ${r.machine.name}`,
        r.user.fullName,
        r.wasStrict ? t('yes') : '—',
        r.status === 'OK' ? t('ok') : t('withIssues'),
      ]),
    );

    for (const r of rows) {
      const needed = 90 + r.steps.length * 14 + (r.comment ? 30 : 0) + r.incidents.length * 14;
      ensureSpace(doc, Math.min(needed, 400));
      const top = doc.y;
      doc.rect(MARGIN, top, doc.page.width - 2 * MARGIN, 22).fill(GREEN_LIGHT);
      doc
        .fillColor(DARK)
        .font('Helvetica-Bold')
        .fontSize(11)
        .text(`Nº${r.machine.number} ${r.machine.name} · ${fmtDate(r.date, meta.lang)} ${timeInTz(r.completedAt)}`, MARGIN + 6, top + 6, {
          lineBreak: false,
        });
      let bx = doc.page.width - MARGIN - 6;
      const b1 = r.status === 'OK' ? t('ok') : t('withIssues');
      doc.font('Helvetica-Bold').fontSize(8);
      bx -= doc.widthOfString(b1) + 10;
      badge(doc, b1, bx, top + 4.5, r.status === 'OK' ? GREEN : RED);
      if (r.wasStrict) {
        bx -= doc.widthOfString(t('strict')) + 16;
        badge(doc, t('strict'), bx, top + 4.5, '#2F6FB0');
      }
      doc.y = top + 28;
      doc.font('Helvetica').fontSize(9).fillColor(GREY);
      doc.text(`${t('worker')}: ${r.user.fullName}   ·   ${t('plan')}: ${r.planName}`, MARGIN + 6);
      doc.moveDown(0.4).fillColor(DARK);

      for (const s of r.steps) {
        ensureSpace(doc, 14);
        const y = doc.y;
        checkbox(doc, MARGIN + 8, y + 1, s.checked);
        doc.font('Helvetica').fontSize(9).fillColor(DARK).text(s.text, MARGIN + 24, y, { width: doc.page.width - 2 * MARGIN - 30 });
        doc.y = Math.max(doc.y, y + 13);
      }
      if (r.comment) {
        doc.moveDown(0.3).font('Helvetica-Bold').text(`${t('comment')}: `, MARGIN + 6, doc.y, { continued: true });
        doc.font('Helvetica').text(r.comment);
      }
      for (const inc of r.incidents) {
        ensureSpace(doc, 14);
        doc.font('Helvetica-Bold').fillColor(RED).text(`! ${t('incidents')} (${t(inc.severity as 'LOW')}): `, MARGIN + 6, doc.y, { continued: true });
        doc.font('Helvetica').fillColor(DARK).text(inc.description);
      }
      // Firma
      const sig = r.signature.split(',')[1];
      if (sig) {
        ensureSpace(doc, 60);
        doc.moveDown(0.3).font('Helvetica').fontSize(8).fillColor(GREY).text(`${t('signature')}:`, MARGIN + 6);
        try {
          doc.image(Buffer.from(sig, 'base64'), MARGIN + 6, doc.y, { fit: [150, 45] });
        } catch {
          /* firma ilegible: se ignora */
        }
        doc.y += 48;
      }
      doc.moveDown(0.8);
    }
  }
  footer(doc, meta.lang);
  return toBuffer(doc);
}

export interface IncidentRow {
  createdAt: Date;
  machine: { number: number; name: string };
  user: { fullName: string };
  description: string;
  severity: string;
  photoUrl: string;
  resolved: boolean;
  resolvedAt: Date | null;
  resolution: string | null;
}

export async function incidentReportPdf(rows: IncidentRow[], meta: ReportMeta) {
  const t = pt(meta.lang);
  const doc = newDoc();
  header(doc, t('incidentReport'), meta);
  if (!rows.length) noData(doc, meta.lang);
  else {
    const open = rows.filter((r) => !r.resolved).length;
    sectionTitle(doc, `${t('total')}: ${rows.length} · ${t('open')}: ${open} · ${t('resolved')}: ${rows.length - open}`);
    for (const r of rows) {
      ensureSpace(doc, 150);
      const top = doc.y;
      const photo = await readFile(r.photoUrl);
      const textX = photo ? MARGIN + 170 : MARGIN;
      const textW = doc.page.width - MARGIN - textX;
      if (photo) {
        try {
          doc.image(photo, MARGIN, top, { fit: [160, 120] });
        } catch {
          /* imagen no soportada */
        }
      }
      doc.font('Helvetica-Bold').fontSize(11).fillColor(DARK).text(`Nº${r.machine.number} ${r.machine.name}`, textX, top, { width: textW });
      const by = doc.y + 3;
      let bx = textX;
      bx += badge(doc, r.resolved ? t('resolved') : t('open'), bx, by, r.resolved ? GREEN : RED) + 4;
      badge(doc, `${t('severity')}: ${t(r.severity as 'LOW')}`, bx, by, r.severity === 'HIGH' ? RED : r.severity === 'MEDIUM' ? '#D68910' : GREY);
      doc.y = by + 18;
      doc.font('Helvetica').fontSize(9).fillColor(GREY);
      doc.text(`${fmtDateTime(r.createdAt, meta.lang)} · ${t('reportedBy')}: ${r.user.fullName}`, textX, doc.y, { width: textW });
      doc.moveDown(0.3).fillColor(DARK).fontSize(10).text(r.description, textX, doc.y, { width: textW });
      if (r.resolved) {
        doc.moveDown(0.3).fontSize(9).fillColor(GREEN);
        doc.text(`${t('resolution')} (${r.resolvedAt ? fmtDateTime(r.resolvedAt, meta.lang) : ''}): ${r.resolution ?? '—'}`, textX, doc.y, { width: textW });
      }
      doc.y = Math.max(doc.y, photo ? top + 125 : doc.y) + 10;
      doc.moveTo(MARGIN, doc.y - 5).lineTo(doc.page.width - MARGIN, doc.y - 5).strokeColor('#E5E7EB').lineWidth(0.5).stroke();
      doc.fillColor(DARK);
    }
  }
  footer(doc, meta.lang);
  return toBuffer(doc);
}

export interface MaintenanceRow {
  date: string;
  type: string;
  machine: { number: number; name: string };
  description: string;
  technician: string | null;
  cost: number | null;
}

export async function maintenanceReportPdf(rows: MaintenanceRow[], meta: ReportMeta) {
  const t = pt(meta.lang);
  const doc = newDoc();
  header(doc, t('maintenanceReport'), meta);
  if (!rows.length) noData(doc, meta.lang);
  else {
    const total = rows.reduce((a, r) => a + (r.cost ?? 0), 0);
    sectionTitle(doc, `${t('total')}: ${rows.length}${total ? ` · ${t('cost')}: ${total.toFixed(2)} €` : ''}`);
    for (const r of rows) {
      ensureSpace(doc, 70);
      const top = doc.y;
      doc.font('Helvetica-Bold').fontSize(10).fillColor(DARK).text(`${fmtDate(r.date, meta.lang)} · Nº${r.machine.number} ${r.machine.name}`, MARGIN, top);
      const color = r.type === 'REPAIR' ? RED : r.type === 'UPDATE' ? '#2F6FB0' : GREEN;
      doc.font('Helvetica-Bold').fontSize(8);
      badge(doc, t(r.type as 'REPAIR'), doc.page.width - MARGIN - doc.widthOfString(t(r.type as 'REPAIR')) - 10, top, color);
      doc.y = top + 15;
      doc.font('Helvetica').fontSize(9).fillColor(GREY);
      const extra = [r.technician ? `${t('technician')}: ${r.technician}` : '', r.cost != null ? `${t('cost')}: ${r.cost.toFixed(2)} €` : '']
        .filter(Boolean)
        .join(' · ');
      if (extra) doc.text(extra, MARGIN);
      doc.fillColor(DARK).fontSize(10).text(r.description, MARGIN, doc.y + 2, { width: doc.page.width - 2 * MARGIN });
      doc.moveDown(0.8);
    }
  }
  footer(doc, meta.lang);
  return toBuffer(doc);
}

export interface ComplianceData {
  perMachine: { label: string; scheduled: number; done: number }[];
  missed: { date: string; label: string; plan: string; strict: boolean }[];
}

export async function complianceReportPdf(data: ComplianceData, meta: ReportMeta) {
  const t = pt(meta.lang);
  const doc = newDoc();
  header(doc, t('complianceReport'), meta);
  const sched = data.perMachine.reduce((a, m) => a + m.scheduled, 0);
  const done = data.perMachine.reduce((a, m) => a + m.done, 0);
  const pct = (d: number, s: number) => (s ? `${Math.round((d / s) * 100)} %` : '—');
  sectionTitle(doc, `${t('rate')}: ${pct(done, sched)} (${done}/${sched})`);
  table(
    doc,
    [
      { label: t('machine'), width: 215 },
      { label: t('scheduled'), width: 70, align: 'right' },
      { label: t('done'), width: 70, align: 'right' },
      { label: t('missed'), width: 80, align: 'right' },
      { label: t('rate'), width: 70, align: 'right' },
    ],
    data.perMachine.map((m) => [m.label, String(m.scheduled), String(m.done), String(m.scheduled - m.done), pct(m.done, m.scheduled)]),
  );
  if (data.missed.length) {
    sectionTitle(doc, t('missedList'));
    table(
      doc,
      [
        { label: t('date'), width: 80 },
        { label: t('machine'), width: 200 },
        { label: t('plan'), width: 225 },
      ],
      data.missed.map((m) => [fmtDate(m.date, meta.lang), m.label, m.plan + (m.strict ? ` (${t('strict')})` : '')]),
    );
  }
  footer(doc, meta.lang);
  return toBuffer(doc);
}

/** Etiqueta A6 con QR para pegar en la máquina (trilingüe). */
export async function qrLabelPdf(m: Machine, url: string) {
  const doc = new PDFDocument({ size: 'A6', margin: 20 });
  const w = doc.page.width;
  const qr = await QRCode.toBuffer(url, { width: 600, margin: 1, errorCorrectionLevel: 'M' });
  if (hasLogo) doc.image(LOGO, 16, 6, { width: 46 });
  doc.roundedRect(w - 70, 14, 54, 30, 8).fill(YELLOW);
  doc.fillColor(DARK).font('Helvetica-Bold').fontSize(14).text(`Nº ${m.number}`, w - 70, 23, { width: 54, align: 'center' });
  doc.rect(0, 54, w, 3).fill(LIME);
  doc.fillColor(DARK).font('Helvetica-Bold').fontSize(14).text(m.name, 20, 62, { width: w - 40, align: 'center' });
  const size = 200;
  doc.image(qr, (w - size) / 2, 88, { width: size });
  doc.font('Helvetica').fontSize(9).fillColor(GREY);
  const info = [m.model ? `Modell / Model: ${m.model}` : '', m.serialNumber ? `S/N: ${m.serialNumber}` : ''].filter(Boolean).join('   ·   ');
  doc.text(info, 20, 295, { width: w - 40, align: 'center' });
  doc.font('Helvetica-Bold').fontSize(10).fillColor(GREEN);
  doc.text('Zum Reinigen scannen · Scan to clean · Escanear para limpiar', 20, 318, { width: w - 40, align: 'center' });
  return toBuffer(doc);
}
