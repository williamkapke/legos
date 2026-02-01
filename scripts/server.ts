#!/usr/bin/env -S deno run --allow-net --allow-read --allow-write

const JSON_PATH = "./minidolls.bricklink.json";
const PORT = 8787;

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

type Minidoll = {
  id: string;
  owned?: boolean;
  note?: string;
  setId?: string;
  [key: string]: unknown;
};

async function updateMinidoll(
  id: string,
  updater: (doll: Minidoll) => void
): Promise<Response> {
  // Read current data
  const data: Minidoll[] = JSON.parse(await Deno.readTextFile(JSON_PATH));

  // Find the minidoll
  const doll = data.find((d) => d.id === id);
  if (!doll) {
    return new Response("Minidoll not found", { status: 404, headers: corsHeaders });
  }

  // Apply update
  updater(doll);

  // Write back
  await Deno.writeTextFile(JSON_PATH, JSON.stringify(data, null, 2));

  return new Response(JSON.stringify({ ok: true }), {
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

async function handleOwned(req: Request): Promise<Response> {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }
  if (req.method !== "POST") {
    return new Response("Method not allowed", { status: 405, headers: corsHeaders });
  }

  try {
    const { id, owned } = await req.json();
    if (!id || typeof id !== "string") {
      return new Response("Invalid id", { status: 400, headers: corsHeaders });
    }

    const result = await updateMinidoll(id, (doll) => {
      if (owned) {
        doll.owned = true;
      } else {
        delete doll.owned;
      }
    });

    console.log(`Updated ${id}: owned=${owned}`);
    return result;
  } catch (err) {
    console.error("Error:", err);
    return new Response("Internal error", { status: 500, headers: corsHeaders });
  }
}

async function handleNote(req: Request): Promise<Response> {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }
  if (req.method !== "POST") {
    return new Response("Method not allowed", { status: 405, headers: corsHeaders });
  }

  try {
    const { id, note } = await req.json();
    if (!id || typeof id !== "string") {
      return new Response("Invalid id", { status: 400, headers: corsHeaders });
    }

    const result = await updateMinidoll(id, (doll) => {
      if (note) {
        doll.note = note;
      } else {
        delete doll.note;
      }
    });

    console.log(`Updated ${id}: note=${note ? `"${note}"` : "(deleted)"}`);
    return result;
  } catch (err) {
    console.error("Error:", err);
    return new Response("Internal error", { status: 500, headers: corsHeaders });
  }
}

async function handleSetId(req: Request): Promise<Response> {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }
  if (req.method !== "POST") {
    return new Response("Method not allowed", { status: 405, headers: corsHeaders });
  }

  try {
    const { id, setId } = await req.json();
    if (!id || typeof id !== "string") {
      return new Response("Invalid id", { status: 400, headers: corsHeaders });
    }

    const result = await updateMinidoll(id, (doll) => {
      if (setId) {
        doll.setId = setId;
      } else {
        delete doll.setId;
      }
    });

    console.log(`Updated ${id}: setId=${setId ? `"${setId}"` : "(deleted)"}`);
    return result;
  } catch (err) {
    console.error("Error:", err);
    return new Response("Internal error", { status: 500, headers: corsHeaders });
  }
}

Deno.serve({ port: PORT }, (req) => {
  const url = new URL(req.url);

  if (url.pathname === "/minidolls/owned") {
    return handleOwned(req);
  }
  if (url.pathname === "/minidolls/note") {
    return handleNote(req);
  }
  if (url.pathname === "/minidolls/setId") {
    return handleSetId(req);
  }

  return new Response("Not found", { status: 404 });
});

console.log(`Server running on http://localhost:${PORT}`);
