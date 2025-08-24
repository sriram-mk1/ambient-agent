const ZEP_BASE = process.env.ZEP_BASE_URL || "https://app.getzep.com/api/v2";
const ZEP_API_KEY = process.env.ZEP_API_KEY || "";

function authHeaders() {
  return {
    Authorization: `Api-Key ${ZEP_API_KEY}`,
  } as Record<string, string>;
}

export type NodeDTO = {
  created_at: string;
  name: string;
  summary: string;
  uuid: string;
  attributes?: Record<string, any> | null;
  labels?: string[] | null;
  score?: number | null;
};

export type EdgeDTO = {
  uuid: string;
  source_uuid: string;
  target_uuid: string;
  label: string;
  valid_from?: string | null;
  valid_to?: string | null;
  attributes?: Record<string, any> | null;
};

export async function getGraph(graphId: string) {
  const url = `${ZEP_BASE.replace(/\/$/, "")}/graph/${encodeURIComponent(graphId)}`;
  console.log("[zep] getGraph", { ZEP_BASE, url, headers: Object.keys(authHeaders()) });
  const res = await fetch(url, {
    method: "GET",
    headers: authHeaders(),
    redirect: "manual",
  });
  if (res.status >= 300 && res.status < 400) {
    const loc = res.headers.get("location");
    const txt = await res.text().catch(() => "");
    console.error("[zep] getGraph redirect", res.status, loc, txt.slice(0, 200));
    throw new Error(`graph redirected: ${res.status} -> ${loc}`);
  }
  if (!res.ok) {
    const txt = await res.text().catch(() => "");
    console.error("[zep] getGraph non-ok", res.status, res.statusText, txt.slice(0, 500));
    throw new Error(`graph failed: ${res.status}`);
  }
  return res.json();
}

export async function getNodesByGraph(graphId: string, limit?: number, uuid_cursor?: string): Promise<NodeDTO[]> {
  return listNodesAny(graphId, limit, uuid_cursor);
}

export async function getEdgesForNode(nodeUuid: string): Promise<EdgeDTO[]> {
  const url = `${ZEP_BASE.replace(/\/$/, "")}/graph/node/${encodeURIComponent(nodeUuid)}/edges`;
  console.log("[zep] edges-for-node GET", url);
  const res = await fetch(url, {
    method: "GET",
    headers: authHeaders(),
    redirect: "manual",
  });
  if (res.status >= 300 && res.status < 400) {
    const loc = res.headers.get("location");
    throw new Error(`Redirected: ${res.status} -> ${loc}`);
  }
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    console.error("[zep] edges-for-node non-ok", res.status, res.statusText, text.slice(0, 300));
    throw new Error(`Edges for node failed: ${res.status}`);
  }
  const json = await res.json();
  console.log("[zep] edges-for-node ok", { count: Array.isArray(json) ? json.length : 0 });
  return json;
}

export async function listNodesAny(graphId: string, limit?: number, uuid_cursor?: string): Promise<NodeDTO[]> {
  const base = (process.env.ZEP_BASE_URL || ZEP_BASE).replace(/\/$/, "");
  const params = new URLSearchParams();
  if (limit != null) params.set("limit", String(limit));
  if (uuid_cursor) params.set("uuid_cursor", uuid_cursor);
  const getUrl = `${base}/graph/node/graph/${encodeURIComponent(graphId)}${params.size ? `?${params.toString()}` : ""}`;
  console.log("[zep] listNodesAny GET", getUrl);
  const r1 = await fetch(getUrl, { method: "GET", headers: authHeaders(), redirect: "manual" });
  if (r1.status === 405) {
    const postUrl = `${base}/graph/node/graph/${encodeURIComponent(graphId)}`;
    console.log("[zep] listNodesAny retry POST", postUrl);
    const r2 = await fetch(postUrl, {
      method: "POST",
      headers: { ...authHeaders(), "Content-Type": "application/json" },
      body: JSON.stringify({ limit, uuid_cursor }),
      redirect: "manual",
    });
    if (!r2.ok) throw new Error(`nodes-by-graph (POST) failed: ${r2.status}`);
    return r2.json();
  }
  if (r1.status >= 300 && r1.status < 400) {
    const loc = r1.headers.get("location");
    const txt = await r1.text().catch(() => "");
    console.error("[zep] listNodesAny redirect", r1.status, loc, txt.slice(0, 200));
    throw new Error(`Redirected: ${r1.status} -> ${loc}`);
  }
  if (!r1.ok) {
    const text = await r1.text().catch(() => "");
    console.error("[zep] listNodesAny non-ok", r1.status, r1.statusText, text.slice(0, 500));
    throw new Error(`nodes-by-graph (GET) failed: ${r1.status}`);
  }
  return r1.json();
}

export async function listAllGraphs(): Promise<Array<{
  created_at?: string | null;
  description?: string | null;
  graph_id?: string | null;
  id?: number | null;
  name?: string | null;
  project_uuid?: string | null;
  uuid?: string | null;
}>> {
  const base = (process.env.ZEP_BASE_URL || ZEP_BASE).replace(/\/$/, "");
  const url = `${base}/graph/list-all`;
  console.log("[zep] listAllGraphs GET", url);
  const res = await fetch(url, { method: "GET", headers: authHeaders(), redirect: "manual" });
  if (res.status >= 300 && res.status < 400) {
    const loc = res.headers.get("location");
    throw new Error(`Redirected: ${res.status} -> ${loc}`);
  }
  if (!res.ok) throw new Error(`list-all failed: ${res.status}`);
  return res.json();
}
