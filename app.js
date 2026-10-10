const STORAGE_KEY = "mesh-network-demo-v1";
const REFRESH_INTERVAL = 15000;

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
    {
      from: "node-001",
      to: "node-002"
    },
    {
      from: "node-001",
      to: "node-003"
    },
    {
      from: "node-002",
      to: "node-004"
    },
    {
      from: "node-003",
      to: "node-004"
    },
    {
      from: "node-002",
      to: "node-005"
    },
    {
      from: "node-003",
      to: "node-006"
    },
    {
      from: "node-004",
      to: "node-006"
    }
  ]
};

let networkData = null;
let refreshTimer = null;
let lastRoute = null;
let isRefreshing = false;

const $ = (id) => document.getElementById(id);

function cloneData(data) {
  return JSON.parse(JSON.stringify(data));
}

function escapeHTML(value) {
  return String(value).replace(/[&<>"']/g, (character) => {
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

  notice.textContent = message;
  notice.dataset.type = type;
}

function setError(message = "") {
  const error = $("appError");

  error.textContent = message;
  error.hidden = !message;
}

function setConnection(state, label) {
  const status = $("connectionStatus");

  status.className = `connection ${state}`;

  status.replaceChildren();

  const dot = document.createElement("span");
  dot.className = "statusDot";

  const text = document.createTextNode(label);

  status.append(dot, text);

  $("connectionInfo").textContent = label;
}

function updateTime() {
  $("lastUpdated").textContent =
    new Date().toLocaleString();
}

function saveNetwork() {
  try {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify(networkData)
    );

    return true;
  } catch (error) {
    console.error("Unable to save demo network:", error);
    return false;
  }
}

function validateNetwork(data) {
  if (
    !data ||
    !Array.isArray(data.nodes) ||
    !Array.isArray(data.links)
  ) {
    throw new Error("The network data has an invalid structure.");
  }

  const ids = new Set();

  for (const node of data.nodes) {
    if (
      !node ||
      typeof node.id !== "string" ||
      !node.id.trim()
    ) {
      throw new Error("Every node must have a valid string ID.");
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
        `A link references an unknown node: ${link.from} → ${link.to}`
      );
    }
  }

  return data;
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
      "Saved network could not be loaded. Restoring defaults.",
      error
    );
  }

  return {
    data: cloneData(DEFAULT_NETWORK),
    restored: false
  };
}

function getNodeById(id) {
  return networkData.nodes.find((node) => node.id === id);
}

function getActiveLinks() {
  return networkData.links.filter((link) => {
    const from = getNodeById(link.from);
    const to = getNodeById(link.to);

    return Boolean(from && to && from.online && to.online);
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
    adjacency.get(link.from).push(link.to);
    adjacency.get(link.to).push(link.from);
  }

  return adjacency;
}

/*
 * Breadth-first search calculates the shortest route when
 * every link has equal cost.
 *
 * This is a calculation on the supplied graph, not a command
 * to physical routers to forward packets.
 */
function findShortestRoute(sourceId, destinationId) {
  const source = getNodeById(sourceId);
  const destination = getNodeById(destinationId);

  if (!source || !destination) {
    return {
      found: false,
      reason: "Choose valid source and destination nodes."
    };
  }

  if (sourceId === destinationId) {
    return {
      found: true,
      path: [sourceId]
    };
  }

  if (!source.online || !destination.online) {
    return {
      found: false,
      reason: "Both nodes must be online to test a route."
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

function renderStats() {
  const nodes = networkData.nodes;

  const online = nodes.filter((node) => node.online);
  const offline = nodes.filter((node) => !node.online);
  const gateways = nodes.filter((node) => node.gateway);

  $("totalNodes").textContent = nodes.length;
  $("onlineNodes").textContent = online.length;
  $("offlineNodes").textContent = offline.length;
  $("gateways").textContent = gateways.length;

  $("linkCount").textContent =
    `${getActiveLinks().length} active links`;

  $("nodeCountBadge").textContent =
    `${nodes.length} nodes`;
}

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

        </div>

        <div class="nodeCardFooter">

          <button
            class="secondaryButton toggleNodeButton"
            type="button"
            data-node-id="${escapeHTML(node.id)}"
            aria-label="${online ? "Set offline" : "Set online"}: ${escapeHTML(node.name)}"
          >
            ${online ? "Set Offline" : "Set Online"}
          </button>

        </div>

      </article>
    `;
  }).join("");
}

function populateRouteSelectors() {
  const sourceSelect = $("fromNode");
  const destinationSelect = $("toNode");

  const previousSource = sourceSelect.value;
  const previousDestination = destinationSelect.value;

  const options = networkData.nodes.map((node) => {
    const state = node.online ? "Online" : "Offline";

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

    if (options.some((item) => item.value === previousValue)) {
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
    getActiveLinks().map((link) =>
      getLinkKey(link.from, link.to)
    )
  );

  const linksMarkup = networkData.links.map((link) => {
    const from = positions.get(link.from);
    const to = positions.get(link.to);

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

function renderInformation() {
  $("dataSource").textContent = "Local Demo Data";
  $("liveUpdates").textContent = "Browser Refresh";

  $("footerMode").textContent = "DEMO MODE";

  setConnection("connected", "DEMO MODE");
}

function renderAll() {
  renderStats();
  renderTopology();
  renderNodeCards();
  populateRouteSelectors();
  renderInformation();
  updateTime();
}

function showRouteMessage(message, type = "") {
  const result = $("routeResult");

  result.className = "routeResult";

  if (type) {
    result.classList.add(type);
  }

  result.textContent = message;
}

function handleRouteTest(event) {
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

  const route = findShortestRoute(
    sourceId,
    destinationId
  );

  if (!route.found) {
    lastRoute = null;

    showRouteMessage(route.reason, "error");

    return;
  }

  lastRoute = route.path;

  const routeNames = route.path.map((id) => {
    return getNodeById(id).name;
  });

  const container = $("routeResult");

  container.className = "routeResult success";
  container.replaceChildren();

  const heading = document.createElement("strong");

  heading.textContent =
    `Route found: ${route.path.length - 1} link(s)`;

  container.append(heading);

  const routeLine = document.createElement("div");
  routeLine.style.marginTop = "10px";

  route.path.forEach((id, index) => {
    const node = getNodeById(id);

    const badge = document.createElement("span");
    badge.className = "routeNode";
    badge.textContent = node.name;

    routeLine.append(badge);

    if (index < route.path.length - 1) {
      routeLine.append(
        document.createTextNode(" → ")
      );
    }
  });

  container.append(routeLine);

  const details = document.createElement("p");

  details.textContent =
    "This is the shortest path in the dashboard's current graph. " +
    "It does not verify physical packet forwarding.";

  container.append(details);
}

function handleNodeToggle(event) {
  const button = event.target.closest(".toggleNodeButton");

  if (!button) {
    return;
  }

  const node = getNodeById(button.dataset.nodeId);

  if (!node) {
    setError("The selected node could not be found.");
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

function resetDemo() {
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

function refreshDashboard() {
  if (isRefreshing) {
    return;
  }

  isRefreshing = true;

  const button = $("refreshButton");
  button.disabled = true;

  try {
    /*
     * The local demo has no physical network service to query.
     * Refreshing re-reads the saved demo state and re-renders it.
     */
    const saved = localStorage.getItem(STORAGE_KEY);

    if (saved) {
      const parsed = JSON.parse(saved);
      validateNetwork(parsed);
      networkData = parsed;
    }

    renderAll();
    setError("");

    setNotice(
      "Dashboard refreshed. Displayed nodes and links are demo data, not live physical-device measurements.",
      "warning"
    );
  } catch (error) {
    console.error("Dashboard refresh failed:", error);

    setError(
      "The saved demo data could not be loaded. Reset the demo network to restore the default data."
    );
  } finally {
    button.disabled = false;
    isRefreshing = false;
  }
}

function startRefreshTimer() {
  if (refreshTimer !== null) {
    clearInterval(refreshTimer);
  }

  refreshTimer = setInterval(() => {
    /*
     * This updates the dashboard timestamp and view.
     * It does not probe physical network devices.
     */
    updateTime();
  }, REFRESH_INTERVAL);
}

function initialize() {
  try {
    const loaded = loadNetwork();

    networkData = loaded.data;

    validateNetwork(networkData);

    renderAll();

    if (loaded.restored) {
      setNotice(
        "Demo network restored from this browser's saved data. Node status and links are simulated.",
        "warning"
      );
    } else {
      const saved = saveNetwork();

      setNotice(
        saved
          ? "Demo network ready. Try the route tester or change a node's status. This is a local simulation."
          : "Demo network ready, but browser storage is unavailable. Changes may not persist after reloading.",
        "warning"
      );
    }

    showRouteMessage(
      "Select two nodes to test a route."
    );

    startRefreshTimer();
  } catch (error) {
    console.error("Dashboard initialization failed:", error);

    setConnection("disconnected", "INITIALIZATION ERROR");

    setNotice(
      "The dashboard could not initialize. Check the browser console for details.",
      "error"
    );

    setError(error.message);
  }
}

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

window.addEventListener("beforeunload", () => {
  if (refreshTimer !== null) {
    clearInterval(refreshTimer);
  }
});

initialize();
