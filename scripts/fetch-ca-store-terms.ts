import { delay } from "@std/async";

const KAPTURE_HTTP = "http://localhost:61822";
const KAPTURE_WS = "ws://localhost:61822/mcp";
const DATA_FILE = "data/ca-stores.json";

interface StoreTerms {
  [storeName: string]: string;
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
          clientInfo: { name: "fetch-ca-store-terms", version: "1.0.0" },
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

  // Parse the tabId from the response
  const text = result.content?.[0]?.text || "";
  const match = text.match(/tabId['":\s]+([a-f0-9-]+)/i);
  if (match) {
    return match[1];
  }
  throw new Error(`Failed to parse tabId from new_tab response: ${text}`);
}

async function getTabId(): Promise<string> {
  const res = await fetch(`${KAPTURE_HTTP}/tabs`);
  const data = await res.json();
  if (!Array.isArray(data) || data.length === 0) {
    return await openNewTab();
  }
  return data[0].tabId;
}

async function navigate(tabId: string, url: string): Promise<void> {
  await mcpCall("tools/call", {
    name: "navigate",
    arguments: { tabId, url },
  });
}

async function getDom(tabId: string, selector: string): Promise<string> {
  const result = await mcpCall("tools/call", {
    name: "dom",
    arguments: { tabId, selector },
  }) as { content: { type: string; text: string }[] };

  const text = result.content?.[0]?.text || "";
  const data = JSON.parse(text);
  return data.html || "";
}

async function loadData(): Promise<StoreTerms> {
  const json = await Deno.readTextFile(DATA_FILE);
  return JSON.parse(json);
}

async function saveData(data: StoreTerms): Promise<void> {
  await Deno.writeTextFile(DATA_FILE, JSON.stringify(data, null, 2) + "\n");
}

async function main() {
  const tabId = await getTabId();
  console.log(`Using Kapture tab: ${tabId}`);

  const data = await loadData();
  const storeNames = Object.keys(data);
  console.log(`Found ${storeNames.length} stores to process`);

  let processed = 0;
  let skipped = 0;

  for (const storeName of storeNames) {
    // Skip if already has terms
    if (data[storeName]) {
      console.log(`[${processed + skipped + 1}/${storeNames.length}] Skipping ${storeName} (already has terms)`);
      skipped++;
      continue;
    }

    const url = `https://store.bricklink.com/${storeName}#/terms`;
    console.log(`[${processed + skipped + 1}/${storeNames.length}] Fetching terms for ${storeName}...`);

    try {
      await navigate(tabId, url);
      await delay(2000); // Wait for page to load (SPA with hash routing)

      const html = await getDom(tabId, "#store-term");

      if (html) {
        data[storeName] = html;
        console.log(`  Found terms (${html.length} chars)`);
      } else {
        data[storeName] = "(no terms)";
        console.log(`  No terms found`);
      }

      await saveData(data);
      processed++;
    } catch (err) {
      console.error(`  Error: ${err}`);
      data[storeName] = `(error: ${err})`;
      await saveData(data);
      processed++;
    }
  }

  console.log(`\nDone! Processed ${processed}, skipped ${skipped}`);
}

main();
