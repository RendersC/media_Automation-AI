import ExcelJS from "exceljs";

interface Segment {
  title: string;
  speaker?: string | null;
  timeStart: string;
  timeEnd: string;
  durationMinutes: number;
  categories: Array<{ id: number; code?: string | null; title: string }>;
  aiSuggested: boolean;
  manuallyEdited: boolean;
  source: string;
}

interface SessionDetail {
  programName: string;
  broadcastDate: string;
  segments: Segment[];
}

// Excel duration format: minutes:seconds, e.g. 0:40, 1:15, 75:00 (minutes may
// exceed 60, hence the bracket). Cells hold real Excel time values (a fraction
// of a day) so a SUM formula can total the chronometry.
const DURATION_FORMAT = "[m]:ss";

function hhmmssToSeconds(t: string): number {
  const parts = t.split(":").map((p) => parseInt(p, 10));
  if (parts.length === 3 && parts.every((n) => !isNaN(n))) return parts[0] * 3600 + parts[1] * 60 + parts[2];
  if (parts.length === 2 && parts.every((n) => !isNaN(n))) return parts[0] * 60 + parts[1];
  return 0;
}

/** Duration of a segment as an Excel time serial (fraction of a 24h day). */
function durationSerial(timeStart: string, timeEnd: string): number {
  const seconds = Math.max(0, hhmmssToSeconds(timeEnd) - hhmmssToSeconds(timeStart));
  return seconds / 86400;
}

export async function generateExcel(session: SessionDetail): Promise<{ buffer: Buffer; filename: string }> {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet("Отчёт");

  // Column structure per ТЗ (раздел 4): ровно 5 колонок
  sheet.columns = [
    { header: "Наименование тематического направления", key: "category", width: 50 },
    { header: "Название программы", key: "program", width: 28 },
    { header: "Тема передачи (ключевая мысль, спикер)", key: "topic", width: 55 },
    { header: "Хронометраж (мин:сек)", key: "duration", width: 22 },
    { header: "Дата выхода в эфир", key: "date", width: 22 },
  ];

  // Style the header row
  const headerRow = sheet.getRow(1);
  headerRow.font = { bold: true, color: { argb: "FFFFFFFF" } };
  headerRow.fill = {
    type: "pattern",
    pattern: "solid",
    fgColor: { argb: "FF1E3A5F" },
  };
  headerRow.alignment = { wrapText: true, vertical: "middle" };
  headerRow.height = 40;

  // Add data rows
  for (const seg of session.segments) {
    const topicCell = seg.speaker ? `${seg.title} / ${seg.speaker}` : seg.title;
    const categoryCell =
      seg.categories.length > 0
        ? seg.categories.map((c) => (c.code ? `${c.code}. ${c.title}` : c.title)).join("\n")
        : "—";
    const row = sheet.addRow({
      category: categoryCell,
      program: session.programName,
      topic: topicCell,
      duration: durationSerial(seg.timeStart, seg.timeEnd),
      date: session.broadcastDate,
    });
    // Display the duration cell as время (м:сс), not a decimal.
    row.getCell("duration").numFmt = DURATION_FORMAT;

    // Color rows by AI classification status
    if (seg.aiSuggested && !seg.manuallyEdited) {
      row.fill = {
        type: "pattern",
        pattern: "solid",
        fgColor: { argb: "FFE8F4FD" },
      };
    } else if (seg.manuallyEdited) {
      row.fill = {
        type: "pattern",
        pattern: "solid",
        fgColor: { argb: "FFFFF3E0" },
      };
    }

    row.alignment = { wrapText: true, vertical: "top" };
    row.height = 25;
  }

  // Total chronometry row with a live SUM formula over the duration column (col D).
  if (session.segments.length > 0) {
    const firstDataRow = 2;
    const lastDataRow = sheet.rowCount;
    const totalRow = sheet.addRow({});
    totalRow.getCell("topic").value = "Итого хронометраж:";
    const totalCell = totalRow.getCell("duration");
    totalCell.value = { formula: `SUM(D${firstDataRow}:D${lastDataRow})` };
    totalCell.numFmt = DURATION_FORMAT;
    totalRow.font = { bold: true };
    totalRow.getCell("topic").alignment = { horizontal: "right" };
  }

  // Add border to all cells
  sheet.eachRow((row) => {
    row.eachCell((cell) => {
      cell.border = {
        top: { style: "thin" },
        left: { style: "thin" },
        bottom: { style: "thin" },
        right: { style: "thin" },
      };
    });
  });

  // Freeze header row
  sheet.views = [{ state: "frozen", ySplit: 1 }];

  const buffer = Buffer.from(await workbook.xlsx.writeBuffer());
  const safeName = session.programName.replace(/[^а-яА-ЯёЁa-zA-Z0-9_]/g, "_");
  const filename = `${safeName}_${session.broadcastDate}.xlsx`;

  return { buffer, filename };
}
