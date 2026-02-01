import { delay } from "@std/async";

const KAPTURE_HTTP = "http://localhost:61822";
const KAPTURE_WS = "ws://localhost:61822/mcp";
const OUTPUT_FILE = "set-inventory.json";

interface PartEntry {
  partNum: string;
  colorId: string;
  description: string;
  thumbnail: string;
  quantity: string;
  partUrl: string;
}

interface SetInventory {
  [setId: string]: {
    name: string;
    image: string;
    parts: PartEntry[];
  };
}

interface ElementInfo {
  selector: string;
  tagName: string;
  src?: string;
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
          clientInfo: { name: "scrape-inventory", version: "1.0.0" },
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
  const result = await mcpCall("tools/call", {
    name: "new_tab",
    arguments: {},
  }) as { content: { text: string }[] };
  const text = result.content?.[0]?.text || "";
  const match = text.match(/tabId["\s:]+(\d+)/);
  if (!match) {
    throw new Error("Failed to get tabId from new_tab response: " + text);
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
  selector: string,
): Promise<ElementInfo[]> {
  const res = await fetch(
    `${KAPTURE_HTTP}/tab/${tabId}/elements?selector=${encodeURIComponent(selector)}`,
  );
  if (!res.ok) {
    throw new Error(`Failed to get elements: ${res.statusText}`);
  }
  const data: ElementsResponse = await res.json();
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

function extractImgInfo(html: string): { src: string; alt: string; partNum: string } {
  const srcMatch = html.match(/src="([^"]+)"/);
  const altMatch = html.match(/alt="([^"]+)"/);
  let src = srcMatch?.[1] || "";
  if (src.startsWith("//")) {
    src = "https:" + src;
  }
  // Extract part number from URL like: .../ItemImage/PT/0/41335stk01.t1.png
  const partNumMatch = src.match(/\/([^/]+)\.t1\.png$/);
  const partNum = partNumMatch?.[1] || "";
  return {
    src,
    alt: altMatch?.[1] || "",
    partNum,
  };
}

function extractQuantity(html: string): string {
  // Extract text content from the td
  const text = html.replace(/<[^>]+>/g, "").trim();
  return text;
}

function extractPartUrl(html: string): { partUrl: string; colorId: string } {
  const hrefMatch = html.match(/href="([^"]+)"/);
  let href = hrefMatch?.[1] || "";
  if (href.startsWith("/")) {
    href = "https://www.bricklink.com" + href;
  }
  // Decode HTML entities like &amp; -> &
  href = href.replace(/&amp;/g, "&");

  // Extract colorId from URL like: ...?P=11253&idColor=11
  const colorMatch = href.match(/idColor=(\d+)/);
  const colorId = colorMatch?.[1] || "";

  return { partUrl: href, colorId };
}

function extractTextContent(html: string): string {
  return html.replace(/<[^>]+>/g, "").trim();
}

async function loadInventory(): Promise<SetInventory> {
  try {
    const json = await Deno.readTextFile(OUTPUT_FILE);
    return JSON.parse(json);
  } catch {
    return {};
  }
}

async function saveInventory(inventory: SetInventory): Promise<void> {
  await Deno.writeTextFile(OUTPUT_FILE, JSON.stringify(inventory, null, 2));
}

async function main() {
  const setId = Deno.args[0];
  if (!setId) {
    console.error("Usage: deno run -A scrape-inventory.ts <set_id>");
    console.error("Example: deno run -A scrape-inventory.ts 41335-1");
    Deno.exit(1);
  }

  console.log("Opening new browser tab...");
  const tabId = await openNewTab();
  console.log(`Using Kapture tab: ${tabId}`);

  const url = `https://www.bricklink.com/v2/catalog/catalogitem.page?S=${setId}#T=I`;
  console.log(`Navigating to: ${url}`);
  await navigate(tabId, url);
  console.log("Waiting for page to load...");
  await delay(1000);

  // Get the set name
  console.log("Getting set name...");
  const nameHtml = await getDom(tabId, "#item-name-title");
  const setName = extractTextContent(nameHtml);
  console.log(`Set name: ${setName}`);

  // Get the set image
  console.log("Getting set image...");
  const imgElements = await getElements(tabId, "#_idImageMain");
  const setImage = imgElements[0]?.src || "";
  console.log(`Set image: ${setImage}`);

  // Get all inventory rows
  console.log("Getting inventory rows...");
  const rows = await getElements(tabId, ".pciinvItemRow");
  console.log(`Found ${rows.length} parts`);
  console.log("Processing parts...");

  const parts: PartEntry[] = [];

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    const rowSelector = row.selector;

    // Get the image
    const imgHtml = await getDom(tabId, `${rowSelector} td:nth-child(2) img`);
    const { src, alt, partNum } = extractImgInfo(imgHtml);

    // Get the quantity
    const qtyHtml = await getDom(tabId, `${rowSelector} td:nth-child(3)`);
    const quantity = extractQuantity(qtyHtml);

    // Get the part URL
    const urlHtml = await getDom(tabId, `${rowSelector} td:nth-child(4)`);
    const { partUrl, colorId } = extractPartUrl(urlHtml);

    parts.push({
      partNum,
      colorId,
      description: alt,
      thumbnail: src,
      quantity,
      partUrl,
    });

    // Log progress for each part
    console.log(`  [${i + 1}/${rows.length}] ${partNum} - ${alt.substring(0, 50)}`);
  }

  // Load existing inventory and update
  const inventory = await loadInventory();
  inventory[setId] = { name: setName, image: setImage, parts };
  await saveInventory(inventory);

  console.log(`\nDone! Saved ${parts.length} parts for set ${setId} to ${OUTPUT_FILE}`);
}

main();
