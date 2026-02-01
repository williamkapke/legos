import { delay } from "@std/async";

const KAPTURE_HTTP = "http://localhost:61822";
const KAPTURE_WS = "ws://localhost:61822/mcp";

interface LegoSet {
  list_id: number;
  quantity: number;
  include_spares: boolean;
  set: {
    set_num: string;
    name: string;
    year: number;
    theme_id: number;
    num_parts: number;
    set_img_url: string;
    set_url: string;
    last_modified_dt: string;
  };
  images?: string[];
}

async function getTabId(): Promise<string> {
  const res = await fetch(`${KAPTURE_HTTP}/tabs`);
  const data = await res.json();
  if (!Array.isArray(data) || data.length === 0) {
    throw new Error("No Kapture tabs connected");
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
      // Initialize MCP connection
      ws.send(JSON.stringify({
        jsonrpc: "2.0",
        id: requestId++,
        method: "initialize",
        params: {
          protocolVersion: "2024-11-05",
          capabilities: {},
          clientInfo: { name: "fetch-images", version: "1.0.0" },
        },
      }));
    };

    ws.onmessage = (event) => {
      const msg = JSON.parse(event.data);

      if (msg.result?.protocolVersion) {
        // Initialized, now send the actual request
        ws.send(JSON.stringify({
          jsonrpc: "2.0",
          id: requestId++,
          method,
          params,
        }));
      }
      else if (msg.id === 2) {
        ws.close();
        if (msg.error) {
          reject(new Error(msg.error.message));
        }
        else {
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

async function downloadImages(setNum: string, urls: string[]): Promise<void> {
  const dir = `./images/${setNum}`;
  await Deno.mkdir(dir, { recursive: true });

  await Promise.all(urls.map(async (url) => {
    const filename = url.split("/").pop() || "image.jpg";
    const destPath = `${dir}/${filename}`;
    try {
      await downloadImage(url, destPath);
      console.log(`    Downloaded: ${filename}`);
    }
    catch (err) {
      console.error(`    Failed to download ${filename}: ${err}`);
    }
  }));
}

function extractImageUrls(html: string): string[] {
  const urls: string[] = [];
  const imgTags = html.match(/<img[^>]*>/gi) || [];
  for (const imgTag of imgTags) {
    // Prefer data-src, fall back to src (but ignore base64 data URIs)
    const dataSrcMatch = imgTag.match(/data-src="([^"]+)"/i);
    const srcMatch = imgTag.match(/(?<![a-z-])src="(https?:\/\/[^"]+)"/i);
    const url = dataSrcMatch?.[1] ?? srcMatch?.[1];
    if (!url) continue;
    // Remove query string, CDN resize suffix, and /thumbs path
    const cleanUrl = url.split("?")[0]
      .replace(/\/\d+x\d+p?\.[a-z]+$/i, "")
      .replace("/thumbs", "");
    if (!urls.includes(cleanUrl)) {
      urls.push(cleanUrl);
    }
  }
  return urls;
}

async function main() {
  const setsJson = await Deno.readTextFile("sets.json");
  const sets: LegoSet[] = JSON.parse(setsJson);

  const tabId = await getTabId();
  console.log(`Using Kapture tab: ${tabId}`);

  for (let i = 0; i < sets.length; i++) {
    const item = sets[i];
    const setUrl = item.set.set_url;
    console.log(
      `[${i + 1}/${sets.length}] ${item.set.name} (${item.set.set_num})`,
    );

    try {
      await navigate(tabId, setUrl);
      await delay(500);
      const html = await getDom(tabId, ".slides");
      const images = extractImageUrls(html);
      item.images = images;
      console.log(`  Found ${images.length} images`);
      await downloadImages(item.set.set_num, images);
    }
    catch (err) {
      console.error(`  Error: ${err}`);
      item.images = [];
    }

    await Deno.writeTextFile("sets.json", JSON.stringify(sets, null, 2));
  }

  console.log("Done!");
}

main();
