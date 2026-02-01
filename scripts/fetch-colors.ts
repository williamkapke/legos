const KAPTURE_HTTP = "http://localhost:61822";
const TAB_ID = "1457096345";
const OUTPUT_FILE = "bricklink-colors.json";

interface ElementInfo {
  selector: string;
  tagName: string;
}

interface ElementsResponse {
  elements: ElementInfo[];
}

async function getElements(selector: string): Promise<ElementInfo[]> {
  const res = await fetch(
    `${KAPTURE_HTTP}/tab/${TAB_ID}/elements?selector=${encodeURIComponent(selector)}`,
  );
  if (!res.ok) {
    throw new Error(`Failed to get elements: ${res.statusText}`);
  }
  const data: ElementsResponse = await res.json();
  return data.elements || [];
}

async function getDom(selector: string): Promise<string> {
  const res = await fetch(
    `${KAPTURE_HTTP}/tab/${TAB_ID}/dom?selector=${encodeURIComponent(selector)}`,
  );
  if (!res.ok) {
    throw new Error(`Failed to get DOM: ${res.statusText}`);
  }
  const data = await res.json();
  return data.html || "";
}

function extractText(html: string): string {
  return html.replace(/<[^>]+>/g, "").trim();
}

interface ColorEntry {
  name: string;
  rgb: string;
}

async function main() {
  console.log("Getting all color rows...");
  const rows = await getElements("table tbody tr");
  console.log(`Found ${rows.length} colors`);

  const colors: Record<string, ColorEntry> = {};

  for (let i = 0; i < rows.length; i++) {
    const rowSelector = rows[i].selector;

    // Get the first td which contains the RGB color
    const firstCellHtml = await getDom(`${rowSelector} td:nth-child(1)`);
    const rgbMatch = firstCellHtml.match(/background-color:(#[A-Fa-f0-9]{6})/);
    const rgb = rgbMatch?.[1] || "";

    // Get the second td which contains the name and ID
    const cellHtml = await getDom(`${rowSelector} td:nth-child(2)`);

    // Extract name - first bold span
    const nameMatch = cellHtml.match(/boldFontWeight[^>]*>([^<]+)</);
    const name = nameMatch?.[1] || "";

    // Extract ID - span with rightTextAlign
    const idMatch = cellHtml.match(/rightTextAlign[^>]*>(\d+)</);
    const id = idMatch?.[1] || "";

    if (id && name) {
      colors[id] = { name, rgb };
      console.log(`  [${i + 1}/${rows.length}] ${id}: ${name} (${rgb})`);
    }
  }

  await Deno.writeTextFile(OUTPUT_FILE, JSON.stringify(colors, null, 2));
  console.log(`\nDone! Saved ${Object.keys(colors).length} colors to ${OUTPUT_FILE}`);
}

main();
