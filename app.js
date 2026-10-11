"use strict";

/*
 * MESH NETWORK CONTROL CENTER
 *
 * Frontend:
 *   Existing HTML dashboard
 *
 * Backend:
 *   https://mesh-backend-olive.vercel.app
 *
 * MongoDB data is accessed through the backend.
 * Never put your MongoDB URI or API_SECRET in this file.
 *
 * IMPORTANT:
 * This dashboard displays recorded network topology.
 * It does not independently establish physical mesh links
 * or forward real network traffic.
 */

const API_BASE = "https://mesh-backend-olive.vercel.app/api";

const STORAGE_KEY = "mesh-network-demo-v1";
const REFRESH_INTERVAL = 15000;
const REQUEST_TIMEOUT = 10000;

let networkData = null;
let refreshTimer = null;
let lastRoute = null;
let isRefreshing = false;
let dataMode = "demo";
let lastBackendError = "";
let lastUpdatedAt = null;

const $ = (id) => document.getElementById(id);


/* =========================================================
   DEFAULT DEMO NETWORK
   Preserved so the dashboard can still work without the API.
   ========================================================= */

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


/* =========================================================
   GENERAL UTILITIES
   ========================================================= */

function cloneData(data) {
  return JSON.parse(JSON.stringify(data));
}

function escapeHTML(value) {
  return String(value ?? "").replace(/[&<>"']/g, (character) => {
    const entities = {
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#39;"
    };

    return entities[character];
  });
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

  const connectionInfo = $("connectionInfo");

  if (connectionInfo) {
    connectionInfo.textContent = label;
  }
}

function updateTime() {
  if ($("lastUpdated")) {
    $("lastUpdated").textContent =
      lastUpdatedAt
        ? new Date(lastUpdatedAt).toLocaleString()
        : "Not updated";
  }
}

function markUpdated() {
  lastUpdatedAt = new Date().toISOString();
  updateTime();
}


/* =========================================================
   HTTP REQUEST HELPER
   ========================================================= */

async function apiRequest(path, options = {}) {
  const controller = new AbortController();

  const timeout = setTimeout(() => {
    controller.abort();
  }, REQUEST_TIMEOUT);

  try {
    const response = await fetch(`${API_BASE}${path}`, {
      ...options,
      signal: controller.signal,
      cache: "no-store",
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
          `The backend returned invalid JSON for ${path}.`
        );
      }
    }

    if (!response.ok) {
      const message =
        result.message ||
        result.error ||
        `Backend request failed with HTTP ${response.status}.`;

      throw new Error(message);
    }

    return result;
  } catch (error) {
    if (error.name === "AbortError") {
      throw new Error(
        `The request to ${path} timed out.`
      );
    }

    throw error;
  } finally {
    clearTimeout(timeout);
  }
}


/* =========================================================
   VALIDATE LOCAL NETWORK DATA
   ========================================================= */

function validateNetwork(data) {
  if (
    !data ||
    !Array.isArray(data.nodes) ||
    !Array.isArray(data.links)
  ) {
    throw new Error(
      "The network data has an invalid structure."
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
      throw new Error(
        `Duplicate node ID: ${node.id}`
      );
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
      throw new Error(
        "A network link is invalid."
      );
    }

    if (
      !ids.has(link.from) ||
      !ids.has(link.to)
    ) {
      throw new Error(
        `A link references an unknown node: ${link.from} → ${link.to}`
      );
    }
  }

  return data;
}


/* =========================================================
   DEMO STORAGE
   ========================================================= */

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


/* =========================================================
   NORMALIZE MONGODB API RESPONSE
   ========================================================= */

/*
 * The backend currently returns nodes in this general format:
 *
 * {
 *   id: "...",
 *   name: "...",
 *   type: "gateway",
 *   status: "online",
 *   lastSeen: "...",
 *   metadata: {}
 * }
 *
 * The existing dashboard uses:
 *
 * {
 *   id: "...",
 *   name: "...",
 *   type: "...",
 *   online: true,
 *   gateway: false
 * }
 *
 * This function converts the backend format into the format
 * used by the existing dashboard.
 */

function normalizeBackendNetwork(response) {
  if (
    !response ||
    !Array.isArray(response.nodes) ||
    !Array.isArray(response.links)
  ) {
    throw new Error(
      "The backend did not return valid node and link arrays."
    );
  }

  const nodes = response.nodes.map((node) => {
    const nodeType = String(
      node.type || "node"
    ).toLowerCase();

    const status = String(
      node.status || ""
    ).toLowerCase();

    const metadata =
      node.metadata &&
      typeof node.metadata === "object"
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
        "Unnamed Node"
      ),
      type: nodeType,
      online,
      gateway,
      lastSeen: node.lastSeen || null,
      metadata
    };
  });

  const links = response.links.map((link) => ({
    from: String(link.from ?? ""),
    to: String(link.to ?? "")
  }));

  const normalized = {
    nodes,
    links
  };

  validateNetwork(normalized);

  return normalized;
}


/* =========================================================
   BACKEND CONNECTION
   ========================================================= */

async function loadRealNetwork() {
  setConnection(
    "connecting",
    "CONNECTING"
  );

  try {
    const response = await apiRequest("/network");

    const normalized = normalizeBackendNetwork(response);

    networkData = normalized;
    dataMode = "live";
    lastBackendError = "";

    markUpdated();

    renderAll();

    setConnection(
      "connected",
      "BACKEND CONNECTED"
    );

    $("dataSource").textContent =
      "MongoDB / Vercel API";

    $("liveUpdates").textContent =
      "15-second polling";

    $("footerMode").textContent =
      "LIVE API DATA";

    setNotice(
      "Connected to the backend. The dashboard is displaying network records returned by MongoDB.",
      "success"
    );

    setError("");

    return true;
  } catch (error) {
    lastBackendError = error.message;

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


/* =========================================================
   NETWORK ACCESS HELPERS
   ========================================================= */

function getNodeById(id) {
  if (!networkData) return undefined;

  return networkData.nodes.find(
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
  return [from, to].sort().join("::");
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


/* =========================================================
   LOCAL SHORTEST-PATH CALCULATION
   Used only for demo mode.
   ========================================================= */

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

  while (queue.length > 0) {
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
      reason:
        "No route exists through the currently online links."
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


/* =========================================================
   RENDER STATISTICS
   ========================================================= */

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

  $("totalNodes").textContent = nodes.length;
  $("onlineNodes").textContent = online.length;
  $("offlineNodes").textContent = offline.length;
  $("gateways").textContent = gateways.length;

  $("linkCount").textContent =
    `${getActiveLinks().length} active links`;

  $("nodeCountBadge").textContent =
    `${nodes.length} nodes`;
}


/* =========================================================
   RENDER NODE CARDS
   ========================================================= */

function renderNodeCards() {
  const container = $("nodes");

  if (networkData.nodes.length === 0) {
    container.innerHTML = `
      <div class="emptyState">
        No nodes are available.
      </div>
    `;

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

            <span class="nodeId">
              ${escapeHTML(node.id)}
            </span>
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
                <span class="nodeId">
                  Managed by backend
                </span>
              `
          }

        </div>

      </article>
    `;
  }).join("");
}


/* =========================================================
   ROUTE SELECTORS
   ========================================================= */

function populateRouteSelectors() {
  const sourceSelect = $("fromNode");
  const destinationSelect = $("toNode");

  const previousSource = sourceSelect.value;
  const previousDestination = destinationSelect.value;

  const options = networkData.nodes.map((node) => {
    const state = node.online
      ? "Online"
      : "Offline";

    return {
      value: node.id,
      label: `${node.name} (${state})`
    };
  });

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


/* =========================================================
   RENDER NETWORK TOPOLOGY
   ========================================================= */

function renderTopology() {
  const container = $("network");
  const nodes = networkData.nodes;

  if (nodes.length === 0) {
    container.innerHTML = `
      <div class="emptyState">
        No nodes available for the topology diagram.
      </div>
    `;

    return;
  }

  const width = 760;
  const height = 330;

  const centerX = width / 2;
  const centerY = height / 2;

  const radiusX = Math.min(
    255,
    width * 0.36
  );

  const radiusY = Math.min(
    112,
    height * 0.34
  );

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
    getActiveLinks().map((link) =>
      getLinkKey(link.from, link.to)
    )
  );

  const linksMarkup = networkData.links.map((link) => {
    const from = positions.get(link.from);
    const to = positions.get(link.to);

    if (!from || !to) {
      return "";
    }

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

    const label = node.name.length > 18
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


/* =========================================================
   SYSTEM INFORMATION
   ========================================================= */

function renderInformation() {
  if (dataMode === "live") {
    $("dataSource").textContent =
      "MongoDB / Vercel API";

    $("liveUpdates").textContent =
      "15-second polling";

    $("footerMode").textContent =
      "LIVE API DATA";

    return;
  }

  $("dataSource").textContent =
    "Local Demo Data";

  $("liveUpdates").textContent =
    "Browser Refresh";

  $("footerMode").textContent =
    "DEMO MODE";
}


/* =========================================================
   RENDER COMPLETE DASHBOARD
   ========================================================= */

function renderAll() {
  renderStats();
  renderTopology();
  renderNodeCards();
  populateRouteSelectors();
  renderInformation();
  updateTime();
}


/* =========================================================
   ROUTE RESULT DISPLAY
   ========================================================= */

function showRouteMessage(message, type = "") {
  const result = $("routeResult");

  result.className = "routeResult";

  if (type) {
    result.classList.add(type);
  }

  result.textContent = message;
}


/* =========================================================
   BACKEND ROUTE TESTING
   ========================================================= */

/*
 * Backend endpoint:
 *
 * POST /api/routes
 *
 * JSON body:
 * {
 *   "from": "source-node-id",
 *   "to": "destination-node-id"
 * }
 *
 * This calls the backend's graph calculation.
 * It does not configure physical routers.
 */

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
    result.found === true;

  return {
    found,
    path,
    message: result.message || "",
    hops: Number.isInteger(result.hops)
      ? result.hops
      : Math.max(0, path.length - 1)
  };
}


/* =========================================================
   ROUTE TEST FORM HANDLER
   ========================================================= */

async function handleRouteTest(event) {
  event.preventDefault();

  const sourceId = $("fromNode").value;
  const destinationId = $("toNode").value;

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


/* =========================================================
   LIVE ROUTE HANDLER
   ========================================================= */

async function handleLiveRouteTest(sourceId, destinationId) {
  const button = $("routeButton");

  button.disabled = true;
  button.textContent = "Checking...";

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

    const validPath = route.path.every(
      (id) => typeof id === "string"
    );

    if (!validPath) {
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
      `The backend route test failed: ${error.message}. Check /api/routes and its Vercel logs.`,
      "error"
    );
  } finally {
    button.disabled = false;
    button.textContent = "Find Route";
  }
}


/* =========================================================
   DISPLAY ROUTE
   ========================================================= */

function displayRoute(path, description) {
  const routeNames = path.map((id) => {
    const node = getNodeById(id);

    return node
      ? node.name
      : id;
  });

  const container = $("routeResult");

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

    badge.textContent =
      routeNames[index] || id;

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
    `${description} This confirms a calculated path in the recorded topology; it does not prove that physical devices are forwarding packets.`;

  container.append(details);
}


/* =========================================================
   DEMO-ONLY NODE TOGGLE
   ========================================================= */

function handleNodeToggle(event) {
  const button = event.target.closest(
    ".toggleNodeButton"
  );

  if (!button) {
    return;
  }

  /*
   * Never change backend node status from this demo button.
   * Live node status should be updated by trusted node agents
   * calling the backend heartbeat endpoint.
   */

  if (dataMode !== "demo") {
    setNotice(
      "Node status is controlled by the backend. Demo controls are disabled while live data is displayed.",
      "warning"
    );

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
    `${node.name} is now marked ${node.online ? "online" : "offline"} in the demo network.`,
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


/* =========================================================
   RESET DEMO NETWORK
   ========================================================= */

function resetDemo() {
  /*
   * Resetting demo data must not delete MongoDB records.
   * When live mode is active, do not replace the real data.
   */

  if (dataMode === "live") {
    setNotice(
      "The live MongoDB network is currently displayed. The demo reset button will not change live network records.",
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


/* =========================================================
   REFRESH DASHBOARD
   ========================================================= */

async function refreshDashboard() {
  if (isRefreshing) {
    return;
  }

  isRefreshing = true;

  const button = $("refreshButton");

  button.disabled = true;

  const originalText = button.textContent;

  button.textContent = "Refreshing...";

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

    /*
     * Keep the demo visible if the backend fails.
     * Do not pretend that demo data is live.
     */

    dataMode = "demo";

    const loaded = loadNetwork();

    networkData = loaded.data;

    validateNetwork(networkData);

    renderAll();

    setConnection(
      "disconnected",
      "BACKEND UNAVAILABLE"
    );

    $("dataSource").textContent =
      "Local Demo Fallback";

    $("footerMode").textContent =
      "DEMO FALLBACK";

    setNotice(
      `Could not load live backend data. Showing the local demo instead. Backend error: ${lastBackendError}`,
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
    button.disabled = false;
    button.textContent = originalText;
    isRefreshing = false;
  }
}


/* =========================================================
   AUTOMATIC REFRESH
   ========================================================= */

function startRefreshTimer() {
  if (refreshTimer !== null) {
    clearInterval(refreshTimer);
  }

  refreshTimer = setInterval(() => {
    refreshDashboard();
  }, REFRESH_INTERVAL);
}


/* =========================================================
   INITIALIZATION
   ========================================================= */

async function initialize() {
  try {
    setConnection(
      "connecting",
      "CONNECTING"
    );

    setNotice(
      "Connecting to the Mesh Network backend..."
    );

    /*
     * Load demo first so the page can still show a working
     * dashboard if the backend is temporarily unavailable.
     */

    const loaded = loadNetwork();

    networkData = loaded.data;

    validateNetwork(networkData);

    dataMode = "demo";

    renderAll();

    const connected = await loadRealNetwork();

    if (!connected) {
      dataMode = "demo";

      const fallback = loadNetwork();

      networkData = fallback.data;

      validateNetwork(networkData);

      renderAll();

      setConnection(
        "disconnected",
        "BACKEND UNAVAILABLE"
      );

      $("dataSource").textContent =
        "Local Demo Fallback";

      $("footerMode").textContent =
        "DEMO FALLBACK";

      setNotice(
        `The backend could not load network data. The demo is displayed instead. Backend error: ${lastBackendError}`,
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
      "The dashboard could not initialize. Check the browser console.",
      "error"
    );

    setError(error.message);
  }
}


/* =========================================================
   EVENT LISTENERS
   ========================================================= */

$("routeForm").addEventListener(
  "submit",
  handleRouteTest
);

$("nodes").addEventListener(
  "click",
  handleNodeToggle
);

$("refreshButton").addEventListener(
  "click",
  refreshDashboard
);

$("resetDemoButton").addEventListener(
  "click",
  resetDemo
);

window.addEventListener(
  "beforeunload",
  () => {
    if (refreshTimer !== null) {
      clearInterval(refreshTimer);
    }
  }
);


/* =========================================================
   START APPLICATION
   ========================================================= */

initialize();
