import fs from "fs";
import path from "path";

const CSV_PATH = path.resolve("Ordem_Servico_rows (12).csv");
const SUPABASE_URL = "https://citrhumdkfivdzbmayde.supabase.co";
const SUPABASE_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImNpdHJodW1ka2ZpdmR6Ym1heWRlIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjkxMDgyNzUsImV4cCI6MjA4NDY4NDI3NX0.83x3-NrKoJgtIuSE7Jjsaj0zH-b-XJ3Z8i3XkBkwVoU";

// Robust CSV parser that handles quoted fields with newlines and commas
function parseCSV(text) {
  const rows = [];
  let current = [];
  let field = "";
  let inQuotes = false;
  let i = 0;

  while (i < text.length) {
    const ch = text[i];

    if (inQuotes) {
      if (ch === '"') {
        if (i + 1 < text.length && text[i + 1] === '"') {
          field += '"';
          i += 2;
        } else {
          inQuotes = false;
          i++;
        }
      } else {
        field += ch;
        i++;
      }
    } else {
      if (ch === '"') {
        inQuotes = true;
        i++;
      } else if (ch === ',') {
        current.push(field.trim());
        field = "";
        i++;
      } else if (ch === '\n' || (ch === '\r' && text[i + 1] === '\n')) {
        current.push(field.trim());
        field = "";
        if (current.length > 1) rows.push(current);
        current = [];
        i += (ch === '\r') ? 2 : 1;
      } else {
        field += ch;
        i++;
      }
    }
  }
  if (field || current.length > 0) {
    current.push(field.trim());
    if (current.length > 1) rows.push(current);
  }

  return rows;
}

function decode(val) {
  return (val || "")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"');
}

function toRecord(headers, values) {
  const row = {};
  headers.forEach((h, idx) => {
    row[h] = decode(values[idx] || "");
  });

  // Build the record matching Supabase columns
  const rec = {};
  for (const h of headers) {
    let val = row[h];
    if (val === "") {
      rec[h] = null;
      continue;
    }
    // Numeric fields
    if (["Qtd_HR", "Valor_HR", "Qtd_KM", "Valor_KM", "Valor_Total", "Desconto", "Desconto_Hora", "Desconto_KM"].includes(h)) {
      rec[h] = val ? parseFloat(val) || 0 : null;
    } else {
      rec[h] = val;
    }
  }
  return rec;
}

async function upsert(record) {
  const id = record.Id_Ordem;
  if (!id || !id.startsWith("OS-")) return "skip";

  const res = await fetch(
    `${SUPABASE_URL}/rest/v1/Ordem_Servico?Id_Ordem=eq.${encodeURIComponent(id)}`,
    {
      method: "PATCH",
      headers: {
        apikey: SUPABASE_KEY,
        Authorization: `Bearer ${SUPABASE_KEY}`,
        "Content-Type": "application/json",
        Prefer: "return=representation",
      },
      body: JSON.stringify(record),
    }
  );

  const text = await res.text();
  const data = text ? JSON.parse(text) : [];

  if (Array.isArray(data) && data.length === 0) {
    const res2 = await fetch(`${SUPABASE_URL}/rest/v1/Ordem_Servico`, {
      method: "POST",
      headers: {
        apikey: SUPABASE_KEY,
        Authorization: `Bearer ${SUPABASE_KEY}`,
        "Content-Type": "application/json",
        Prefer: "return=representation",
      },
      body: JSON.stringify([record]),
    });
    if (!res2.ok) {
      const err = await res2.text();
      console.error(`  ERRO INSERT ${id}: ${err}`);
      return "error";
    }
    console.log(`  + Inserido: ${id}`);
    return "inserted";
  }

  if (!res.ok) {
    console.error(`  ERRO PATCH ${id}: ${text}`);
    return "error";
  }
  return "updated";
}

async function main() {
  const csv = fs.readFileSync(CSV_PATH, "utf-8");
  const allRows = parseCSV(csv);
  const headers = allRows[0];
  console.log(`Colunas: ${headers.length} -> ${headers.join(", ")}`);
  console.log(`Registros no CSV: ${allRows.length - 1}`);

  let updated = 0, inserted = 0, errors = 0, skipped = 0;

  for (let i = 1; i < allRows.length; i++) {
    const values = allRows[i];
    // Skip rows that don't have enough columns (corrupted)
    if (values.length < headers.length - 2) {
      console.log(`  Pulando linha ${i}: apenas ${values.length} colunas`);
      skipped++;
      continue;
    }
    const rec = toRecord(headers, values);
    if (!rec.Id_Ordem || !rec.Id_Ordem.startsWith("OS-")) {
      skipped++;
      continue;
    }
    const result = await upsert(rec);
    if (result === "updated") updated++;
    else if (result === "inserted") inserted++;
    else if (result === "skip") skipped++;
    else errors++;

    if (i % 50 === 0) process.stdout.write(`  ${i}/${allRows.length - 1}...\r`);
  }

  console.log(`\nResultado: ${updated} atualizados, ${inserted} inseridos, ${skipped} pulados, ${errors} erros`);

  // Verify OS-0173
  const check = await fetch(
    `${SUPABASE_URL}/rest/v1/Ordem_Servico?Id_Ordem=eq.OS-0173&select=Id_Ordem,Os_Cliente`,
    { headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}` } }
  );
  const verify = await check.json();
  console.log(`\nVerificação OS-0173:`, verify);
}

main().catch(console.error);
