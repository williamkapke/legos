import { delay } from "@std/async";

const KAPTURE_HTTP = "http://localhost:61822";
const KAPTURE_WS = "ws://localhost:61822/mcp";
const START_URL =
  "https://www.bricklink.com/catalogList.asp?catType=M&catString=771&pg=1";
const OUTPUT_FILE = "minidolls.bricklink.json";

interface PartEntry {
  partNum: string;
  colorId: string;
  description: string;
  image: string;
}

interface MinidollEntry {
  id: string;
  thumbnail: string;
  image: string;
  description: string;
  name: string;
  parts: PartEntry[];
}

interface ElementInfo {
  selector: string;
  tagName: string;
  src?: string;
  href?: string;
}

interface ElementsResponse {
  elements: ElementInfo[];
}

function mcpCall(
  method: string,
  params: Record<string, unknown>,
): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(KAPTURE_WS);
    let requestId = 1;

    ws.onopen = () => {
      ws.send(JSON.stringify({
        jsonrpc: "2.0",
        id: requestId++,
        method: "initialize",
        params: {
          protocolVersion: "2024-11-05",
          capabilities: {},
          clientInfo: { name: "scrape-bricklink", version: "1.0.0" },
        },
      }));
    };

    ws.onmessage = (event) => {
      const msg = JSON.parse(event.data);

      if (msg.result?.protocolVersion) {
        ws.send(JSON.stringify({
          jsonrpc: "2.0",
          id: requestId++,
          method,
          params,
        }));
      } else if (msg.id === 2) {
        ws.close();
        if (msg.error) {
          reject(new Error(msg.error.message));
        } else {
          resolve(msg.result);
        }
      }
    };

    ws.onerror = (err) => {
      reject(err);
    };
  });
}

async function openNewTab(): Promise<string> {
  console.log("Opening new Kapture tab...");
  const result = await mcpCall("tools/call", {
    name: "new_tab",
    arguments: {},
  }) as { content: { text: string }[] };
  const text = result.content?.[0]?.text || "";
  const match = text.match(/tabId['":\s]+([a-f0-9-]+)/i);
  if (!match) {
    throw new Error(`Failed to parse tabId from new_tab response: ${text}`);
  }
  return match[1];
}

async function navigate(tabId: string, url: string): Promise<void> {
  await mcpCall("tools/call", {
    name: "navigate",
    arguments: { tabId, url },
  });
}

async function getElements(
  tabId: string,
  options: { selector?: string; xpath?: string },
): Promise<ElementInfo[]> {
  const params = new URLSearchParams();
  if (options.selector) params.set("selector", options.selector);
  if (options.xpath) params.set("xpath", options.xpath);

  const url = `${KAPTURE_HTTP}/tab/${tabId}/elements?${params.toString()}`;
  console.log(`  DEBUG getElements: ${url}`);
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`Failed to get elements: ${res.statusText}`);
  }
  const data: ElementsResponse = await res.json();
  console.log(`  DEBUG response keys: ${Object.keys(data)}, elements: ${data.elements?.length ?? 'undefined'}`);
  return data.elements || [];
}

async function getDom(tabId: string, selector: string): Promise<string> {
  const res = await fetch(
    `${KAPTURE_HTTP}/tab/${tabId}/dom?selector=${encodeURIComponent(selector)}`,
  );
  if (!res.ok) {
    throw new Error(`Failed to get DOM: ${res.statusText}`);
  }
  const data = await res.json();
  return data.html || "";
}

function extractAltFromHtml(html: string): string {
  // Extract alt attribute from img tag HTML
  const match = html.match(/alt="([^"]+)"/);
  if (!match) return "";

  // Parse the alt text: "Minifig No: frnd0279  Name: Baby / Infant - ..."
  const alt = match[1];
  const nameMatch = alt.match(/Name:\s*(.+?)(?:\s*\(\d+\))?$/);
  return nameMatch ? nameMatch[1].trim() : alt;
}

function extractIdFromSrc(src: string): string | null {
  // Extract ID from URL like: https://img.bricklink.com/ItemImage/MT/0/frnd0430.t1.png
  const match = src.match(/\/([a-zA-Z0-9]+)\.t1\.png$/);
  return match ? match[1] : null;
}

function extractName(description: string): string {
  // Pattern: "Friends Name - outfit description"
  const match = description.match(/^Friends\s+([^-]+?)(?:\s+-|$)/);
  if (match) {
    return match[1].trim();
  }
  return "";
}

function thumbnailToImage(thumbnail: string): string {
  // Convert MT->MN and t1->original
  return thumbnail.replace("/MT/", "/MN/").replace(".t1.png", ".png");
}

function extractPartInfo(html: string): { partNum: string; colorId: string } {
  // Extract part number and color ID from link like:
  // <a href="/v2/catalog/catalogitem.page?P=90396&idColor=11">90396</a>
  const hrefMatch = html.match(/href="[^"]*P=([^&"]+)(?:&amp;|&)idColor=(\d+)/);
  if (hrefMatch) {
    return { partNum: hrefMatch[1], colorId: hrefMatch[2] };
  }
  // Fallback: just extract part number from text
  const textMatch = html.match(/>([^<]+)</);
  return { partNum: textMatch?.[1] || "", colorId: "" };
}

function extractPartDescription(html: string): string {
  // Extract description from the bold text in column 4
  // <b>Black Minifigure, Hair Female Mid-Length Wavy with Center Part </b>
  const match = html.match(/<b>([^<]+)<\/b>/);
  return match ? match[1].trim() : "";
}

function extractPartImage(html: string): string {
  // Extract image src from column 1
  const match = html.match(/src="([^"]+)"/);
  let src = match?.[1] || "";
  if (src.startsWith("//")) {
    src = "https:" + src;
  }
  return src;
}

async function scrapeMinidollParts(
  tabId: string,
  minidollId: string,
): Promise<PartEntry[]> {
  const url = `https://www.bricklink.com/catalogItemInv.asp?M=${minidollId}`;
  await navigate(tabId, url);
  await delay(1000);

  const rows = await getElements(tabId, { selector: "tr.IV_ITEM" });
  const parts: PartEntry[] = [];

  for (const row of rows) {
    // Get part number and color from column 3
    const linkHtml = await getDom(tabId, `${row.selector} td:nth-child(3)`);
    const { partNum, colorId } = extractPartInfo(linkHtml);
    if (!partNum) continue;

    // Get description from column 4
    const descHtml = await getDom(tabId, `${row.selector} td:nth-child(4)`);
    const description = extractPartDescription(descHtml);

    // Get image from column 1
    const imgHtml = await getDom(tabId, `${row.selector} td:nth-child(1) img`);
    const image = extractPartImage(imgHtml);

    parts.push({ partNum, colorId, description, image });
  }

  return parts;
}

async function scrapeCurrentPage(tabId: string): Promise<MinidollEntry[]> {
  const elements = await getElements(tabId, {
    selector: "span[data-itemid] > img",
  });

  const entries: MinidollEntry[] = [];
  for (const el of elements) {
    if (!el.src) continue;
    const id = extractIdFromSrc(el.src);
    if (!id) continue;

    // Get the DOM to extract alt text (description)
    const html = await getDom(tabId, el.selector);
    const description = extractAltFromHtml(html);

    entries.push({
      id,
      thumbnail: el.src,
      image: thumbnailToImage(el.src),
      description,
      name: extractName(description),
      parts: [],
    });
  }
  return entries;
}

async function getNextPageUrl(tabId: string): Promise<string | null> {
  const elements = await getElements(tabId, {
    xpath: "//a[normalize-space()='Next']",
  });

  if (elements.length === 0 || !elements[0].href) {
    return null;
  }
  return elements[0].href;
}

async function loadExistingData(): Promise<Map<string, MinidollEntry>> {
  const map = new Map<string, MinidollEntry>();
  try {
    const json = await Deno.readTextFile(OUTPUT_FILE);
    const entries: MinidollEntry[] = JSON.parse(json);
    for (const entry of entries) {
      map.set(entry.id, entry);
    }
    console.log(`Loaded ${map.size} existing minidolls from ${OUTPUT_FILE}`);
  } catch {
    console.log(`No existing data found at ${OUTPUT_FILE}, starting fresh`);
  }
  return map;
}

async function saveData(entries: Map<string, MinidollEntry>): Promise<void> {
  const arr = Array.from(entries.values());
  await Deno.writeTextFile(OUTPUT_FILE, JSON.stringify(arr, null, 2));
}

async function main() {
  const tabId = await openNewTab();
  console.log(`Using Kapture tab: ${tabId}`);

  // Load existing data to preserve manual changes
  const existingData = await loadExistingData();

  let currentUrl: string | null = START_URL;
  let pageNum = 1;
  let newCount = 0;
  let skippedCount = 0;

  while (currentUrl) {
    console.log(`\nPage ${pageNum}: ${currentUrl}`);
    await navigate(tabId, currentUrl);
    await delay(1500);

    const entries = await scrapeCurrentPage(tabId);
    console.log(`  Found ${entries.length} minidolls`);

    // Get next page URL before navigating away
    const nextUrl = await getNextPageUrl(tabId);

    // Scrape parts for each minidoll (skip if already has parts)
    for (let i = 0; i < entries.length; i++) {
      const entry = entries[i];
      const existing = existingData.get(entry.id);

      if (existing && existing.parts && existing.parts.length > 0) {
        // Keep existing entry with all its data (preserves manual changes)
        console.log(`    [${i + 1}/${entries.length}] Skipping ${entry.id} (already has ${existing.parts.length} parts)`);
        skippedCount++;
      } else {
        // Fetch parts for new entry
        console.log(`    [${i + 1}/${entries.length}] Scraping parts for ${entry.id}...`);
        entry.parts = await scrapeMinidollParts(tabId, entry.id);
        console.log(`      Found ${entry.parts.length} parts`);
        // Merge: update existing or add new, preserving any extra fields from existing
        existingData.set(entry.id, existing ? { ...existing, ...entry } : entry);
        newCount++;

        // Save after each minidoll
        await saveData(existingData);
      }
    }

    if (nextUrl) {
      // Convert relative URL to absolute if needed
      currentUrl = nextUrl.startsWith("http")
        ? nextUrl
        : `https://www.bricklink.com${nextUrl}`;
      pageNum++;
    } else {
      currentUrl = null;
    }
  }

  console.log(`\nDone! Processed ${newCount} new, skipped ${skippedCount} existing. Total: ${existingData.size} minidolls in ${OUTPUT_FILE}`);
}

main();
