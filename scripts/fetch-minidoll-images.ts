import { delay } from "@std/async";

const KAPTURE_HTTP = "http://localhost:61822";
const KAPTURE_WS = "ws://localhost:61822/mcp";

const args = {
  minidolls: Deno.args.includes("-minidolls"),
  parts: Deno.args.includes("-parts"),
};

if (!args.minidolls && !args.parts) {
  console.log("Usage: deno run -A fetch-minidoll-images.ts [-minidolls] [-parts]");
  console.log("  -minidolls  Fetch images for minidolls");
  console.log("  -parts      Fetch images for parts");
  Deno.exit(1);
}

interface Part {
  part_num: string;
  name: string;
  part_img_url: string | null;
  part_url: string;
  color_name: string;
  color_rgb: string;
  quantity: number;
}

interface Minidoll {
  set_num: string;
  name: string;
  num_parts: number;
  set_img_url: string | null;
  set_url: string;
  last_modified_dt: string;
  sets?: unknown[];
  parts?: Part[];
}

interface ImageMap {
  [key: string]: string[];
}

async function getTabId(): Promise<string> {
  const res = await fetch(`${KAPTURE_HTTP}/tabs`);
  const data = await res.json();
  if (!Array.isArray(data) || data.length === 0) {
    throw new Error("No Kapture tabs connected. Open a browser tab with Kapture DevTools.");
  }
  return data[0].tabId;
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
          clientInfo: { name: "fetch-minidoll-images", version: "1.0.0" },
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

async function navigate(tabId: string, url: string): Promise<void> {
  await mcpCall("tools/call", {
    name: "navigate",
    arguments: { tabId, url },
  });
}

interface ElementInfo {
  src?: string;
}

interface ElementsResponse {
  elements: ElementInfo[];
}

async function getElements(tabId: string, selector: string): Promise<ElementInfo[]> {
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

async function downloadImage(url: string, destPath: string): Promise<void> {
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`Failed to fetch ${url}: ${res.statusText}`);
  }
  const data = new Uint8Array(await res.arrayBuffer());
  await Deno.writeFile(destPath, data);
}

async function downloadImages(type: string, id: string, urls: string[]): Promise<string[]> {
  const dir = `./images/${type}/${id}`;
  await Deno.mkdir(dir, { recursive: true });

  const localPaths: string[] = [];

  for (const url of urls) {
    const filename = url.split("/").pop() || "image.jpg";
    const destPath = `${dir}/${filename}`;
    try {
      await downloadImage(url, destPath);
      localPaths.push(destPath);
      console.log(`    Downloaded: ${filename}`);
    } catch (err) {
      console.error(`    Failed to download ${filename}: ${err}`);
    }
  }

  return localPaths;
}

const PART_IMAGE_SELECTOR = "#content .container > .row > div:first-child > .row img.img-responsive";
const MINIDOLL_IMAGE_SELECTOR = ".slides";

function extractImageUrlsFromElements(elements: ElementInfo[]): string[] {
  const urls: string[] = [];
  for (const el of elements) {
    const url = el.src;
    if (!url) continue;
    if (url.includes("nil.png") || url.startsWith("data:")) continue;
    const cleanUrl = cleanImageUrl(url);
    if (!urls.includes(cleanUrl)) {
      urls.push(cleanUrl);
    }
  }
  return urls;
}

function extractImageUrlsFromHtml(html: string): string[] {
  const urls: string[] = [];
  const imgTags = html.match(/<img[^>]*>/gi) || [];
  for (const imgTag of imgTags) {
    // Prefer data-src, fall back to src (but ignore base64 data URIs)
    const dataSrcMatch = imgTag.match(/data-src="([^"]+)"/i);
    const srcMatch = imgTag.match(/(?<![a-z-])src="(https?:\/\/[^"]+)"/i);
    const url = dataSrcMatch?.[1] ?? srcMatch?.[1];
    if (!url) continue;
    if (url.includes("nil.png") || url.startsWith("data:")) continue;
    const cleanUrl = cleanImageUrl(url);
    if (!urls.includes(cleanUrl)) {
      urls.push(cleanUrl);
    }
  }
  return urls;
}

function cleanImageUrl(url: string): string {
  // Remove query string, CDN resize suffix, and /thumbs path
  return url.split("?")[0]
    .replace(/\/\d+x\d+p?\.[a-z]+$/i, "")
    .replace("/thumbs", "");
}

async function loadImageMap(filename: string): Promise<ImageMap> {
  try {
    const text = await Deno.readTextFile(filename);
    return JSON.parse(text);
  } catch {
    return {};
  }
}

async function saveImageMap(filename: string, map: ImageMap): Promise<void> {
  await Deno.writeTextFile(filename, JSON.stringify(map, null, 2));
}

async function fetchMinidollImages(minidolls: Minidoll[], tabId: string): Promise<void> {
  const imageMap = await loadImageMap("minidoll-images.json");

  for (let i = 0; i < minidolls.length; i++) {
    const doll = minidolls[i];

    // Skip if already fetched
    if (imageMap[doll.set_num]) {
      console.log(`[${i + 1}/${minidolls.length}] ${doll.name} - skipped (already fetched)`);
      continue;
    }

    console.log(`[${i + 1}/${minidolls.length}] ${doll.name} (${doll.set_num})`);

    try {
      await navigate(tabId, doll.set_url);
      await delay(500);
      const html = await getDom(tabId, MINIDOLL_IMAGE_SELECTOR);
      const images = extractImageUrlsFromHtml(html);
      console.log(`  Found ${images.length} images`);
      imageMap[doll.set_num] = images;
    } catch (err) {
      console.error(`  Error: ${err}`);
      imageMap[doll.set_num] = [];
    }

    await saveImageMap("minidoll-images.json", imageMap);
    await delay(300);
  }
}

async function fetchPartImages(minidolls: Minidoll[], tabId: string): Promise<void> {
  const imageMap = await loadImageMap("part-images.json");

  // Collect all unique parts
  const uniqueParts = new Map<string, Part>();
  for (const doll of minidolls) {
    if (!doll.parts) continue;
    for (const part of doll.parts) {
      const key = part.part_num;
      if (!uniqueParts.has(key)) {
        uniqueParts.set(key, part);
      }
    }
  }

  const parts = Array.from(uniqueParts.values());
  console.log(`Found ${parts.length} unique parts to fetch`);

  for (let i = 0; i < parts.length; i++) {
    const part = parts[i];

    // Skip if already fetched
    if (imageMap[part.part_num]) {
      console.log(`[${i + 1}/${parts.length}] ${part.name} - skipped (already fetched)`);
      continue;
    }

    console.log(`[${i + 1}/${parts.length}] ${part.name} (${part.part_num})`);

    try {
      await navigate(tabId, part.part_url);
      await delay(500);
      const elements = await getElements(tabId, PART_IMAGE_SELECTOR);
      const images = extractImageUrlsFromElements(elements);
      console.log(`  Found ${images.length} images`);
      imageMap[part.part_num] = images;
    } catch (err) {
      console.error(`  Error: ${err}`);
      imageMap[part.part_num] = [];
    }

    await saveImageMap("part-images.json", imageMap);
    await delay(300);
  }
}

async function main() {
  const minidollsJson = await Deno.readTextFile("minidolls.json");
  const minidolls: Minidoll[] = JSON.parse(minidollsJson);

  const tabId = await getTabId();
  console.log(`Using Kapture tab: ${tabId}\n`);

  if (args.minidolls) {
    console.log("=== Fetching Minidoll Images ===\n");
    await fetchMinidollImages(minidolls, tabId);
  }

  if (args.parts) {
    console.log("\n=== Fetching Part Images ===\n");
    await fetchPartImages(minidolls, tabId);
  }

  console.log("\nDone!");
}

main();
