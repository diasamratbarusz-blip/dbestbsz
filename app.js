"use strict";

/*
 * MESH NETWORK CONTROL CENTER
 * Frontend dashboard with live backend data and safe demo fallback.
 *
 * Backend base: https://mesh-backend-olive.vercel.app/api
 * Never put MongoDB credentials or API_SECRET in this file.
 *
 * This dashboard displays recorded network topology and calculates
 * routes through that topology. It does not create physical mesh links
 * or forward real network traffic.
 */

const API_BASE = "https://mesh-backend-olive.vercel.app/api";
const STORAGE_KEY = "mesh-network-demo-v1";
const REFRESH_INTERVAL = 15000;
const REQUEST_TIMEOUT = 12000;

let networkData = null;
let refreshTimer = null;
let lastRoute = null;
let isRefreshing = false;
let dataMode = "demo";
let lastBackendError = "";
let lastUpdatedAt = null;

const $ = (id) => document.getElementById(id);

const DEFAULT_NETWORK = {
  nodes: [
    {
      id: "node-001",
      name: "Central Node",
      type: "router",
      online: true,
      gateway: true
    },
    {
      id: "node-002",
      name: "North Node",
      type: "relay",
      online: true,
      gateway: false
    },
    {
      id: "node-003",
      name: "South Node",
      type: "relay",
      online: true,
      gateway: false
    },
    {
      id: "node-004",
      name: "East Node",
      type: "client",
      online: true,
      gateway: false
    },
    {
      id: "node-005",
      name: "West Node",
      type: "client",
      online: false,
      gateway: false
    },
    {
      id: "node-006",
      name: "Gateway Node",
      type: "gateway",
      online: true,
      gateway: true
    }
  ],

  links: [
    { from: "node-001", to: "node-002" },
    { from: "node-001", to: "node-003" },
    { from: "node-002", to: "node-004" },
    { from: "node-003", to: "node-004" },
    { from: "node-002", to: "node-005" },
    { from: "node-003", to: "node-006" },
    { from: "node-004", to: "node-006" }
  ]
};

/* -------------------- General utilities -------------------- */

function cloneData(data) {
  return JSON.parse(JSON.stringify(data));
}

function escapeHTML(value) {
  return String(value ?? "").replace(/[&<>"']/g, (character) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;"
  })[character]);
}

function setNotice(message, type = "info") {
  const notice = $("appNotice");

  if (!notice) return;

  notice.textContent = message;
  notice.dataset.type = type;
}

function setError(message = "") {
  const error = $("appError");

  if (!error) return;

  error.textContent = message;
  error.hidden = !message;
}

function setConnection(state, label) {
  const status = $("connectionStatus");

  if (status) {
    status.className = `connection ${state}`;
    status.replaceChildren();

    const dot = document.createElement("span");
    dot.className = "statusDot";

    status.append(
      dot,
      document.createTextNode(label)
    );
  }

  if ($("connectionInfo")) {
    $("connectionInfo").textContent = label;
  }
}

function updateTime() {
  if ($("lastUpdated")) {
    $("lastUpdated").textContent = lastUpdatedAt
      ? new Date(lastUpdatedAt).toLocaleString()
      : "Not updated";
  }
}

function markUpdated() {
  lastUpdatedAt = new Date().toISOString();
  updateTime();
}

function requiredElement(id) {
  const element = $(id);

  if (!element) {
    throw new Error(
      `Required dashboard element #${id} was not found in index.html.`
    );
  }

  return element;
}

/* -------------------- HTTP request helper -------------------- */

async function apiRequest(path, options = {}) {
  const controller = new AbortController();

  const timeout = setTimeout(
    () => controller.abort(),
    REQUEST_TIMEOUT
  );

  const url = `${API_BASE}${path}`;

  try {
    const response = await fetch(url, {
      ...options,

      signal: controller.signal,
      cache: "no-store",
      mode: "cors",

      headers: {
        Accept: "application/json",
        ...(options.headers || {})
      }
    });

    const rawText = await response.text();

    let result = {};

    if (rawText) {
      try {
        result = JSON.parse(rawText);
      } catch {
        throw new Error(
          `The backend returned non-JSON data for ${path} ` +
          `(HTTP ${response.status}).`
        );
      }
    }

    if (!response.ok) {
      throw new Error(
        result.message ||
        result.error ||
        `Backend request failed with HTTP ${response.status} at ${path}.`
      );
    }

    return result;

  } catch (error) {
    if (error.name === "AbortError") {
      throw new Error(
        `The request to ${path} timed out after ` +
        `${REQUEST_TIMEOUT / 1000} seconds.`
      );
    }

    if (
      error instanceof TypeError &&
      /fetch/i.test(error.message)
    ) {
      throw new Error(
        `Browser could not fetch ${url}. ` +
        `This is commonly caused by CORS, a wrong API route, ` +
        `a deployment error, or a network issue. ` +
        `Check FRONTEND_ORIGIN in the BACKEND Vercel project ` +
        `and set it to the exact frontend origin: ` +
        `https://dbestbsz.vercel.app`
      );
    }

    throw error;

  } finally {
    clearTimeout(timeout);
  }
}

/* -------------------- Validate network data -------------------- */

function validateNetwork(data) {
  if (
    !data ||
    !Array.isArray(data.nodes) ||
    !Array.isArray(data.links)
  ) {
    throw new Error(
      "The network data must contain nodes and links arrays."
    );
  }

  const ids = new Set();

  for (const node of data.nodes) {
    if (
      !node ||
      typeof node.id !== "string" ||
      !node.id.trim()
    ) {
      throw new Error(
        "Every node must have a valid string ID."
      );
    }

    if (ids.has(node.id)) {
      throw new Error(`Duplicate node ID: ${node.id}`);
    }

    ids.add(node.id);

    if (typeof node.online !== "boolean") {
      throw new Error(
        `Node ${node.id} must have a boolean online status.`
      );
    }

    if (typeof node.gateway !== "boolean") {
      throw new Error(
        `Node ${node.id} must have a boolean gateway status.`
      );
    }
  }

  for (const link of data.links) {
    if (
      !link ||
      typeof link.from !== "string" ||
      typeof link.to !== "string" ||
      link.from === link.to
    ) {
      throw new Error("A network link is invalid.");
    }

    if (!ids.has(link.from) || !ids.has(link.to)) {
      throw new Error(
        `A link references an unknown node: ` +
        `${link.from} → ${link.to}`
      );
    }
  }

  return data;
}

/* -------------------- Local demo storage -------------------- */

function saveNetwork() {
  try {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify(networkData)
    );

    return true;

  } catch (error) {
    console.error(
      "Unable to save demo network:",
      error
    );

    return false;
  }
}

function loadNetwork() {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);

    if (saved) {
      const parsed = JSON.parse(saved);

      validateNetwork(parsed);

      return {
        data: parsed,
        restored: true
      };
    }

  } catch (error) {
    console.warn(
      "Saved demo network could not be loaded. Restoring defaults.",
      error
    );
  }

  return {
    data: cloneData(DEFAULT_NETWORK),
    restored: false
  };
}

/* -------------------- Normalize backend response -------------------- */

function normalizeBackendNetwork(response) {
  /*
   * Supports:
   *
   * { nodes: [], links: [] }
   *
   * and:
   *
   * {
   *   success: true,
   *   data: {
   *     nodes: [],
   *     links: []
   *   }
   * }
   */

  const payload =
    response &&
    response.data &&
    !Array.isArray(response.data) &&
    (
      Array.isArray(response.data.nodes) ||
      Array.isArray(response.data.links)
    )
      ? response.data
      : response;

  if (
    !payload ||
    !Array.isArray(payload.nodes) ||
    !Array.isArray(payload.links)
  ) {
    const receivedKeys =
      response && typeof response === "object"
        ? Object.keys(response).join(", ") || "none"
        : typeof response;

    throw new Error(
      "The backend did not return valid node and link arrays. " +
      `Response keys: ${receivedKeys}. ` +
      "Check GET /api/network."
    );
  }

  const nodes = payload.nodes.map((node) => {
    const nodeType = String(
      node.type || "node"
    ).toLowerCase();

    const status = String(
      node.status || ""
    ).toLowerCase();

    const metadata =
      node.metadata && typeof node.metadata === "object"
        ? node.metadata
        : {};

    const online =
      status === "online" ||
      node.online === true;

    const gateway =
      nodeType === "gateway" ||
      node.gateway === true ||
      metadata.gateway === true;

    return {
      id: String(node.id ?? node._id ?? ""),

      name: String(
        node.name ||
        node.id ||
        node._id ||
        "Unnamed Node"
      ),

      type: nodeType,
      online,
      gateway,

      lastSeen:
        node.lastSeen ||
        node.last_seen ||
        null,

      metadata
    };
  });

  const links = payload.links.map((link) => ({
    from: String(
      link.from ??
      link.source ??
      link.sourceId ??
      ""
    ),

    to: String(
      link.to ??
      link.target ??
      link.targetId ??
      ""
    )
  }));

  return validateNetwork({
    nodes,
    links
  });
}

/* -------------------- Backend connection -------------------- */

async function loadRealNetwork() {
  setConnection(
    "connecting",
    "CONNECTING"
  );

  try {
    const response = await apiRequest("/network");

    const normalized =
      normalizeBackendNetwork(response);

    networkData = normalized;
    dataMode = "live";
    lastBackendError = "";

    markUpdated();
    renderAll();

    setConnection(
      "connected",
      "BACKEND CONNECTED"
    );

    if ($("dataSource")) {
      $("dataSource").textContent =
        "MongoDB / Vercel API";
    }

    if ($("liveUpdates")) {
      $("liveUpdates").textContent =
        "15-second polling";
    }

    if ($("footerMode")) {
      $("footerMode").textContent =
        "LIVE API DATA";
    }

    setNotice(
      "Connected to the backend. Displaying network records returned by MongoDB.",
      "success"
    );

    setError("");

    return true;

  } catch (error) {
    lastBackendError =
      error.message ||
      "Unknown backend connection error";

    console.error(
      "Unable to load live network:",
      error
    );

    setConnection(
      "disconnected",
      "BACKEND UNAVAILABLE"
    );

    return false;
  }
}

/* -------------------- Network helpers -------------------- */

function getNodeById(id) {
  return networkData?.nodes.find(
    (node) => node.id === id
  );
}

function getActiveLinks() {
  if (!networkData) return [];

  return networkData.links.filter((link) => {
    const from = getNodeById(link.from);
    const to = getNodeById(link.to);

    return Boolean(
      from &&
      to &&
      from.online &&
      to.online
    );
  });
}

function getLinkKey(from, to) {
  return [from, to]
    .sort()
    .join("::");
}

function getAdjacency() {
  const adjacency = new Map();

  for (const node of networkData.nodes) {
    adjacency.set(node.id, []);
  }

  for (const link of getActiveLinks()) {
    adjacency.get(link.from)?.push(link.to);
    adjacency.get(link.to)?.push(link.from);
  }

  return adjacency;
}

/* -------------------- Local shortest-path calculation -------------------- */

function findShortestRoute(sourceId, destinationId) {
  const source = getNodeById(sourceId);
  const destination = getNodeById(destinationId);

  if (!source || !destination) {
    return {
      found: false,
      reason: "Choose valid source and destination nodes."
    };
  }

  if (!source.online || !destination.online) {
    return {
      found: false,
      reason: "Both nodes must be online to test a route."
    };
  }

  if (sourceId === destinationId) {
    return {
      found: true,
      path: [sourceId]
    };
  }

  const adjacency = getAdjacency();

  const queue = [sourceId];
  const visited = new Set([sourceId]);
  const previous = new Map();

  while (queue.length) {
    const current = queue.shift();

    if (current === destinationId) {
      break;
    }

    for (const neighbor of adjacency.get(current) || []) {
      if (visited.has(neighbor)) {
        continue;
      }

      visited.add(neighbor);
      previous.set(neighbor, current);
      queue.push(neighbor);
    }
  }

  if (!visited.has(destinationId)) {
    return {
      found: false,
      reason: "No route exists through the currently online links."
    };
  }

  const path = [];
  let current = destinationId;

  while (current !== undefined) {
    path.unshift(current);

    if (current === sourceId) {
      break;
    }

    current = previous.get(current);
  }

  if (path[0] !== sourceId) {
    return {
      found: false,
      reason: "Could not reconstruct the route."
    };
  }

  return {
    found: true,
    path
  };
}

/* -------------------- Render statistics -------------------- */

function renderStats() {
  const nodes = networkData.nodes;

  const online = nodes.filter(
    (node) => node.online
  );

  const offline = nodes.filter(
    (node) => !node.online
  );

  const gateways = nodes.filter(
    (node) => node.gateway
  );

  if ($("totalNodes")) {
    $("totalNodes").textContent = nodes.length;
  }

  if ($("onlineNodes")) {
    $("onlineNodes").textContent = online.length;
  }

  if ($("offlineNodes")) {
    $("offlineNodes").textContent = offline.length;
  }

  if ($("gateways")) {
    $("gateways").textContent = gateways.length;
  }

  if ($("linkCount")) {
    $("linkCount").textContent =
      `${getActiveLinks().length} active links`;
  }

  if ($("nodeCountBadge")) {
    $("nodeCountBadge").textContent =
      `${nodes.length} nodes`;
  }
}

/* -------------------- Render node cards -------------------- */

function renderNodeCards() {
  const container = $("nodes");

  if (!container) return;

  if (networkData.nodes.length === 0) {
    container.innerHTML =
      `<div class="emptyState">No nodes are available.</div>`;

    return;
  }

  container.innerHTML = networkData.nodes.map((node) => {
    const online = node.online;

    const lastSeenText = node.lastSeen
      ? new Date(node.lastSeen).toLocaleString()
      : "Not reported";

    return `
      <article class="nodeCard">

        <div class="nodeCardHeader">
          <div>
            <h3>${escapeHTML(node.name)}</h3>
            <span class="nodeId">${escapeHTML(node.id)}</span>
          </div>

          <span class="nodeStatus ${online ? "online" : "offline"}">
            ${online ? "Online" : "Offline"}
          </span>
        </div>

        <div class="nodeMeta">
          <div>
            <span>Node Type</span>
            <strong>${escapeHTML(node.type)}</strong>
          </div>

          <div>
            <span>Gateway</span>
            <strong>${node.gateway ? "Yes" : "No"}</strong>
          </div>

          <div>
            <span>Link State</span>
            <strong>${online ? "Available" : "Unavailable"}</strong>
          </div>

          ${
            dataMode === "live"
              ? `
                <div>
                  <span>Last Seen</span>
                  <strong>${escapeHTML(lastSeenText)}</strong>
                </div>
              `
              : ""
          }
        </div>

        <div class="nodeCardFooter">
          ${
            dataMode === "demo"
              ? `
                <button
                  class="secondaryButton toggleNodeButton"
                  type="button"
                  data-node-id="${escapeHTML(node.id)}"
                >
                  ${online ? "Set Offline" : "Set Online"}
                </button>
              `
              : `
                <span class="nodeId">Managed by backend</span>
              `
          }
        </div>

      </article>
    `;
  }).join("");
}

/* -------------------- Route selectors -------------------- */

function populateRouteSelectors() {
  const sourceSelect = $("fromNode");
  const destinationSelect = $("toNode");

  if (!sourceSelect || !destinationSelect) {
    return;
  }

  const previousSource = sourceSelect.value;
  const previousDestination = destinationSelect.value;

  const options = networkData.nodes.map((node) => ({
    value: node.id,

    label:
      `${node.name} (${node.online ? "Online" : "Offline"})`
  }));

  function fillSelect(select, placeholder, previousValue) {
    select.replaceChildren();

    const defaultOption = document.createElement("option");

    defaultOption.value = "";
    defaultOption.textContent = placeholder;

    select.append(defaultOption);

    for (const item of options) {
      const option = document.createElement("option");

      option.value = item.value;
      option.textContent = item.label;

      select.append(option);
    }

    if (
      options.some(
        (item) => item.value === previousValue
      )
    ) {
      select.value = previousValue;
    }
  }

  fillSelect(
    sourceSelect,
    "Select source",
    previousSource
  );

  fillSelect(
    destinationSelect,
    "Select destination",
    previousDestination
  );
}

/* -------------------- Render network topology -------------------- */

function renderTopology() {
  const container = $("network");

  if (!container) return;

  const nodes = networkData.nodes;

  if (nodes.length === 0) {
    container.innerHTML =
      `<div class="emptyState">No nodes available for the topology diagram.</div>`;

    return;
  }

  const width = 760;
  const height = 330;

  const centerX = width / 2;
  const centerY = height / 2;

  const radiusX = Math.min(255, width * 0.36);
  const radiusY = Math.min(112, height * 0.34);

  const positions = new Map();

  nodes.forEach((node, index) => {
    const angle =
      -Math.PI / 2 +
      (2 * Math.PI * index) / nodes.length;

    positions.set(node.id, {
      x: centerX + radiusX * Math.cos(angle),
      y: centerY + radiusY * Math.sin(angle)
    });
  });

  const activeKeys = new Set(
    getActiveLinks().map(
      (link) => getLinkKey(link.from, link.to)
    )
  );

  const linksMarkup = networkData.links.map((link) => {
    const from = positions.get(link.from);
    const to = positions.get(link.to);

    if (!from || !to) return "";

    const active = activeKeys.has(
      getLinkKey(link.from, link.to)
    );

    return `
      <line
        class="topologyLink ${active ? "" : "linkInactive"}"
        x1="${from.x}"
        y1="${from.y}"
        x2="${to.x}"
        y2="${to.y}"
      />
    `;
  }).join("");

  const nodesMarkup = nodes.map((node) => {
    const point = positions.get(node.id);

    const label =
      node.name.length > 18
        ? `${node.name.slice(0, 16)}…`
        : node.name;

    const circleClass = node.gateway
      ? "gatewayCircle"
      : node.online
        ? "nodeOnline"
        : "nodeOffline";

    return `
      <g
        class="topologyNode"
        tabindex="0"
        role="img"
        aria-label="${escapeHTML(node.name)}, ${node.online ? "online" : "offline"}"
      >
        <title>
          ${escapeHTML(node.name)} — ${node.online ? "Online" : "Offline"}
        </title>

        <circle
          class="nodeCircle ${circleClass}"
          cx="${point.x}"
          cy="${point.y}"
          r="21"
        />

        <text
          x="${point.x}"
          y="${point.y + 4}"
          text-anchor="middle"
          fill="#edf5fc"
          font-size="11"
          font-weight="800"
        >
          ${node.gateway ? "GW" : "N"}
        </text>

        <text
          class="nodeLabel"
          x="${point.x}"
          y="${point.y + 38}"
        >
          ${escapeHTML(label)}
        </text>

        <text
          class="nodeSubLabel"
          x="${point.x}"
          y="${point.y + 52}"
        >
          ${node.online ? "ONLINE" : "OFFLINE"}
        </text>
      </g>
    `;
  }).join("");

  container.innerHTML = `
    <svg
      class="topologySvg"
      viewBox="0 0 ${width} ${height}"
      role="img"
      aria-label="Diagram showing network nodes and their links"
      xmlns="http://www.w3.org/2000/svg"
    >
      ${linksMarkup}
      ${nodesMarkup}
    </svg>
  `;
}

/* -------------------- System information and full render -------------------- */

function renderInformation() {
  if (dataMode === "live") {
    if ($("dataSource")) {
      $("dataSource").textContent = "MongoDB / Vercel API";
    }

    if ($("liveUpdates")) {
      $("liveUpdates").textContent = "15-second polling";
    }

    if ($("footerMode")) {
      $("footerMode").textContent = "LIVE API DATA";
    }

  } else {
    if ($("dataSource")) {
      $("dataSource").textContent = "Local Demo Data";
    }

    if ($("liveUpdates")) {
      $("liveUpdates").textContent = "Browser Refresh";
    }

    if ($("footerMode")) {
      $("footerMode").textContent = "DEMO MODE";
    }
  }
}

function renderAll() {
  renderStats();
  renderTopology();
  renderNodeCards();
  populateRouteSelectors();
  renderInformation();
  updateTime();
}

/* -------------------- Route result display -------------------- */

function showRouteMessage(message, type = "") {
  const result = $("routeResult");

  if (!result) return;

  result.className = "routeResult";

  if (type) {
    result.classList.add(type);
  }

  result.textContent = message;
}

async function findBackendRoute(sourceId, destinationId) {
  const result = await apiRequest("/routes", {
    method: "POST",

    headers: {
      "Content-Type": "application/json"
    },

    body: JSON.stringify({
      from: sourceId,
      to: destinationId
    })
  });

  const path = Array.isArray(result.route)
    ? result.route
    : Array.isArray(result.path)
      ? result.path
      : [];

  const found =
    result.reachable === true ||
    result.found === true ||
    (
      path.length > 0 &&
      result.success !== false
    );

  return {
    found,
    path,
    message: result.message || "",

    hops: Number.isInteger(result.hops)
      ? result.hops
      : Math.max(0, path.length - 1)
  };
}

async function handleRouteTest(event) {
  event.preventDefault();

  const sourceId = $("fromNode")?.value;
  const destinationId = $("toNode")?.value;

  if (!sourceId || !destinationId) {
    showRouteMessage(
      "Select both a source node and a destination node.",
      "error"
    );

    return;
  }

  if (dataMode === "live") {
    await handleLiveRouteTest(
      sourceId,
      destinationId
    );

    return;
  }

  const route = findShortestRoute(
    sourceId,
    destinationId
  );

  if (!route.found) {
    lastRoute = null;

    showRouteMessage(
      route.reason,
      "error"
    );

    return;
  }

  lastRoute = route.path;

  displayRoute(
    route.path,
    "Demo route calculated locally."
  );
}

async function handleLiveRouteTest(sourceId, destinationId) {
  const button = $("routeButton");

  if (button) {
    button.disabled = true;
    button.textContent = "Checking...";
  }

  showRouteMessage(
    "Requesting route information from the backend..."
  );

  try {
    const route = await findBackendRoute(
      sourceId,
      destinationId
    );

    if (!route.found || route.path.length === 0) {
      lastRoute = null;

      showRouteMessage(
        route.message ||
        "The backend could not find a route between these nodes.",
        "error"
      );

      return;
    }

    if (
      !route.path.every(
        (id) => typeof id === "string"
      )
    ) {
      throw new Error(
        "The backend returned an invalid route."
      );
    }

    lastRoute = route.path;

    displayRoute(
      route.path,
      route.message ||
      "Route calculated using backend network data."
    );

  } catch (error) {
    console.error(
      "Backend route test failed:",
      error
    );

    showRouteMessage(
      `Backend route test failed: ${error.message}. ` +
      "Check /api/routes and Vercel logs.",
      "error"
    );

  } finally {
    if (button) {
      button.disabled = false;
      button.textContent = "Find Route";
    }
  }
}

function displayRoute(path, description) {
  const routeNames = path.map(
    (id) => getNodeById(id)?.name || id
  );

  const container = $("routeResult");

  if (!container) return;

  container.className = "routeResult success";
  container.replaceChildren();

  const heading = document.createElement("strong");

  heading.textContent =
    `Route found: ${Math.max(0, path.length - 1)} link(s)`;

  container.append(heading);

  const routeLine = document.createElement("div");

  routeLine.style.marginTop = "10px";

  path.forEach((id, index) => {
    const badge = document.createElement("span");

    badge.className = "routeNode";
    badge.textContent = routeNames[index] || id;

    routeLine.append(badge);

    if (index < path.length - 1) {
      routeLine.append(
        document.createTextNode(" → ")
      );
    }
  });

  container.append(routeLine);

  const details = document.createElement("p");

  details.textContent =
    `${description} This confirms a calculated path in the recorded topology; ` +
    "it does not prove that physical devices are forwarding packets.";

  container.append(details);
}

/* -------------------- Demo-only node toggle -------------------- */

function handleNodeToggle(event) {
  const button = event.target.closest(
    ".toggleNodeButton"
  );

  if (!button || dataMode !== "demo") {
    return;
  }

  const node = getNodeById(
    button.dataset.nodeId
  );

  if (!node) {
    setError(
      "The selected node could not be found."
    );

    return;
  }

  node.online = !node.online;

  saveNetwork();

  setError("");

  setNotice(
    `${node.name} is now marked ` +
    `${node.online ? "online" : "offline"} in the demo network.`,
    "warning"
  );

  renderAll();

  if (lastRoute) {
    const stillValid = lastRoute.every((id) => {
      const currentNode = getNodeById(id);

      return currentNode && currentNode.online;
    });

    if (!stillValid) {
      lastRoute = null;

      showRouteMessage(
        "The previous route changed because a node went offline. Test the route again."
      );
    }
  }
}

/* -------------------- Reset demo network -------------------- */

function resetDemo() {
  if (dataMode === "live") {
    setNotice(
      "Live MongoDB data is displayed. Reset Demo will not change backend records.",
      "warning"
    );

    return;
  }

  networkData = cloneData(DEFAULT_NETWORK);
  lastRoute = null;

  const saved = saveNetwork();

  renderAll();

  showRouteMessage(
    "Select two nodes to test a route."
  );

  setError("");

  setNotice(
    saved
      ? "The demo network has been reset and saved in this browser."
      : "The demo network was reset, but browser storage is unavailable.",
    saved ? "success" : "warning"
  );
}

/* -------------------- Refresh dashboard -------------------- */

async function refreshDashboard() {
  if (isRefreshing) return;

  isRefreshing = true;

  const button = $("refreshButton");

  if (button) {
    button.disabled = true;

    button.dataset.originalText =
      button.dataset.originalText ||
      button.textContent;

    button.textContent = "Refreshing...";
  }

  try {
    const connected = await loadRealNetwork();

    if (connected) {
      setNotice(
        "Dashboard refreshed successfully using live backend data.",
        "success"
      );

      setError("");

      return;
    }

    dataMode = "demo";

    networkData = loadNetwork().data;

    validateNetwork(networkData);

    renderAll();

    setConnection(
      "disconnected",
      "BACKEND UNAVAILABLE"
    );

    if ($("dataSource")) {
      $("dataSource").textContent =
        "Local Demo Fallback";
    }

    if ($("footerMode")) {
      $("footerMode").textContent =
        "DEMO FALLBACK";
    }

    setNotice(
      `Could not load live backend data. ` +
      `Showing the local demo instead. ` +
      `Backend error: ${lastBackendError}`,
      "warning"
    );

    setError(
      `Backend connection failed: ${lastBackendError}`
    );

  } catch (error) {
    console.error(
      "Dashboard refresh failed:",
      error
    );

    setError(error.message);

  } finally {
    if (button) {
      button.disabled = false;

      button.textContent =
        button.dataset.originalText ||
        "Refresh";
    }

    isRefreshing = false;
  }
}

/* -------------------- Automatic refresh -------------------- */

function startRefreshTimer() {
  if (refreshTimer !== null) {
    clearInterval(refreshTimer);
  }

  refreshTimer = setInterval(
    refreshDashboard,
    REFRESH_INTERVAL
  );
}

/* -------------------- Initialization -------------------- */

async function initialize() {
  try {
    setConnection(
      "connecting",
      "CONNECTING"
    );

    setNotice(
      "Connecting to the Mesh Network backend..."
    );

    networkData = loadNetwork().data;

    validateNetwork(networkData);

    dataMode = "demo";

    renderAll();

    const connected = await loadRealNetwork();

    if (!connected) {
      dataMode = "demo";

      networkData = loadNetwork().data;

      validateNetwork(networkData);

      renderAll();

      setConnection(
        "disconnected",
        "BACKEND UNAVAILABLE"
      );

      if ($("dataSource")) {
        $("dataSource").textContent =
          "Local Demo Fallback";
      }

      if ($("footerMode")) {
        $("footerMode").textContent =
          "DEMO FALLBACK";
      }

      setNotice(
        `The backend could not load network data. ` +
        `The demo is displayed instead. ` +
        `Backend error: ${lastBackendError}`,
        "warning"
      );

      setError(
        `Backend connection failed: ${lastBackendError}`
      );
    }

    showRouteMessage(
      "Select two nodes to test a route."
    );

    startRefreshTimer();

  } catch (error) {
    console.error(
      "Dashboard initialization failed:",
      error
    );

    setConnection(
      "disconnected",
      "INITIALIZATION ERROR"
    );

    setNotice(
      "The dashboard could not initialize. Check that index.html contains the expected element IDs.",
      "error"
    );

    setError(error.message);
  }
}

/* -------------------- Event listeners -------------------- */

function bindEvents() {
  const routeForm = $("routeForm");
  const nodes = $("nodes");
  const refreshButton = $("refreshButton");
  const resetButton = $("resetDemoButton");

  if (routeForm) {
    routeForm.addEventListener(
      "submit",
      handleRouteTest
    );
  }

  if (nodes) {
    nodes.addEventListener(
      "click",
      handleNodeToggle
    );
  }

  if (refreshButton) {
    refreshButton.addEventListener(
      "click",
      refreshDashboard
    );
  }

  if (resetButton) {
    resetButton.addEventListener(
      "click",
      resetDemo
    );
  }

  window.addEventListener(
    "beforeunload",
    () => {
      if (refreshTimer !== null) {
        clearInterval(refreshTimer);
      }
    }
  );
}

/* -------------------- Start application -------------------- */

bindEvents();
initialize();
