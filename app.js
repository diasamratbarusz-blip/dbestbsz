/*
  Mesh Network Frontend

  This frontend is designed to work with
  the Node.js backend we created earlier.

  If the frontend is deployed on Vercel and
  the backend is deployed somewhere else,
  change API_BASE below to your backend URL.

  Example:

  const API_BASE =
    "https://your-backend.onrender.com";
*/

const API_BASE = "";


let network = {
  nodes: [],
  links: []
};


let currentRoute = null;


/* -----------------------------
   API REQUEST
----------------------------- */

async function apiRequest(
  path,
  options = {}
) {

  const response =
    await fetch(
      `${API_BASE}${path}`,
      options
    );

  if (!response.ok) {

    throw new Error(
      `Request failed: ${response.status}`
    );
  }

  return response.json();
}


/* -----------------------------
   LOAD NETWORK
----------------------------- */

async function loadNetwork() {

  const data =
    await apiRequest(
      "/api/network"
    );

  network.nodes =
    data.nodes || [];

  network.links =
    data.links || [];

  renderNetwork();

  renderNodes();

  renderSelects();
}


/* -----------------------------
   LOAD STATS
----------------------------- */

async function loadStats() {

  const data =
    await apiRequest(
      "/api/stats"
    );


  document.getElementById(
    "totalNodes"
  ).textContent =
    data.totalNodes;


  document.getElementById(
    "onlineNodes"
  ).textContent =
    data.onlineNodes;


  document.getElementById(
    "offlineNodes"
  ).textContent =
    data.offlineNodes;


  document.getElementById(
    "gateways"
  ).textContent =
    data.gateways;


  document.getElementById(
    "linkCount"
  ).textContent =
    `${data.links} links`;
}


/* -----------------------------
   RENDER NETWORK
----------------------------- */

function renderNetwork() {

  const container =
    document.getElementById(
      "network"
    );

  container.innerHTML = "";


  if (
    network.links.length === 0
  ) {

    container.innerHTML = `
      <div class="loading">
        No network links available.
      </div>
    `;

    return;
  }


  network.links.forEach(
    ([a, b]) => {

      const row =
        document.createElement(
          "div"
        );

      row.className =
        "networkLink";


      row.innerHTML = `
        <span class="nodeA">
          ${escapeHTML(a)}
        </span>

        <span class="line"></span>

        <span class="nodeA">
          ${escapeHTML(b)}
        </span>
      `;


      container.appendChild(row);
    }
  );
}


/* -----------------------------
   RENDER NODES
----------------------------- */

function renderNodes() {

  const container =
    document.getElementById(
      "nodes"
    );

  container.innerHTML = "";


  if (
    network.nodes.length === 0
  ) {

    container.innerHTML = `
      <div class="loading">
        No nodes found.
      </div>
    `;

    return;
  }


  network.nodes.forEach(
    node => {

      const div =
        document.createElement(
          "div"
        );


      div.className =
        `node ${
          node.online
            ? "online"
            : "offline"
        }`;


      const buttonText =
        node.online
          ? "Disable"
          : "Enable";


      div.innerHTML = `
        <div>

          <div class="nodeName">
            ${escapeHTML(node.name)}
          </div>

          <span class="nodeId">
            ${escapeHTML(node.id)}
          </span>

          <div
            class="nodeStatus ${
              node.online
                ? "onlineText"
                : "offlineText"
            }"
          >
            ${
              node.online
                ? "● ONLINE"
                : "● OFFLINE"
            }
          </div>

        </div>

        <button
          type="button"
          data-node-id="${escapeHTML(node.id)}"
          data-online="${!node.online}"
        >
          ${buttonText}
        </button>
      `;


      const button =
        div.querySelector(
          "button"
        );


      button.addEventListener(
        "click",
        () => {

          toggleNode(
            node.id,
            !node.online
          );

        }
      );


      container.appendChild(div);
    }
  );
}


/* -----------------------------
   RENDER SELECTS
----------------------------- */

function renderSelects() {

  const from =
    document.getElementById(
      "fromNode"
    );

  const to =
    document.getElementById(
      "toNode"
    );


  const previousFrom =
    from.value;


  const previousTo =
    to.value;


  from.innerHTML = `
    <option value="">
      Select source
    </option>
  `;


  to.innerHTML = `
    <option value="">
      Select destination
    </option>
  `;


  network.nodes.forEach(
    node => {

      const optionFrom =
        document.createElement(
          "option"
        );

      optionFrom.value =
        node.id;

      optionFrom.textContent =
        `${node.name} (${node.id})`;


      from.appendChild(
        optionFrom
      );


      const optionTo =
        document.createElement(
          "option"
        );

      optionTo.value =
        node.id;

      optionTo.textContent =
        `${node.name} (${node.id})`;


      to.appendChild(
        optionTo
      );
    }
  );


  if (
    network.nodes.some(
      node =>
        node.id === previousFrom
    )
  ) {

    from.value =
      previousFrom;
  }


  if (
    network.nodes.some(
      node =>
        node.id === previousTo
    )
  ) {

    to.value =
      previousTo;
  }


  if (!from.value) {

    const first =
      network.nodes[0];

    if (first) {
      from.value =
        first.id;
    }
  }


  if (!to.value) {

    const gateway =
      network.nodes.find(
        node =>
          node.gateway &&
          node.online
      );


    if (gateway) {

      to.value =
        gateway.id;

    } else if (
      network.nodes.length > 1
    ) {

      to.value =
        network.nodes[
          network.nodes.length - 1
        ].id;
    }
  }
}


/* -----------------------------
   TOGGLE NODE
----------------------------- */

async function toggleNode(
  id,
  online
) {

  try {

    await apiRequest(
      `/api/nodes/${encodeURIComponent(
        id
      )}/status`,
      {
        method: "POST",

        headers: {
          "Content-Type":
            "application/json"
        },

        body:
          JSON.stringify({
            online
          })
      }
    );


    await loadNetwork();

    await loadStats();


    if (
      document.getElementById(
        "fromNode"
      ).value &&
      document.getElementById(
        "toNode"
      ).value
    ) {

      await findRoute();
    }

  } catch (error) {

    console.error(
      "Node update failed:",
      error
    );

    showConnectionError();
  }
}


/* -----------------------------
   FIND ROUTE
----------------------------- */

async function findRoute() {

  const from =
    document.getElementById(
      "fromNode"
    ).value;


  const to =
    document.getElementById(
      "toNode"
    ).value;


  const result =
    document.getElementById(
      "routeResult"
    );


  if (!from || !to) {

    result.innerHTML = `
      Select both source and
      destination nodes.
    `;

    return;
  }


  if (from === to) {

    result.innerHTML = `
      <div class="routeSuccess">
        ✓ Source and destination
        are the same node.
      </div>
    `;

    return;
  }


  result.innerHTML = `
    Finding route...
  `;


  try {

    const data =
      await apiRequest(
        `/api/routes?from=${encodeURIComponent(
          from
        )}&to=${encodeURIComponent(
          to
        )}`
      );


    currentRoute =
      data;


    if (data.reachable) {

      result.innerHTML = `
        <div class="routeSuccess">
          ✓ Route found
        </div>

        <div class="routePath">
          ${data.route
            .map(
              item =>
                escapeHTML(item)
            )
            .join(" → ")}
        </div>

        <div>
          ${
            data.route.length - 1
          }
          hops
        </div>
      `;

    } else {

      result.innerHTML = `
        <div class="routeFailure">
          ✕ No route available
        </div>

        <div>
          The selected nodes are
          currently unreachable.
        </div>
      `;
    }

  } catch (error) {

    console.error(
      "Route request failed:",
      error
    );


    result.innerHTML = `
      <div class="routeFailure">
        ✕ Backend unavailable
      </div>

      <div>
        The frontend is running,
        but the network API could
        not be reached.
      </div>
    `;
  }
}


/* -----------------------------
   WEBSOCKET
----------------------------- */

function connectWebSocket() {

  if (!API_BASE) {

    setConnectionStatus(
      "CONNECTING",
      "connecting"
    );

    return;
  }


  const protocol =
    API_BASE.startsWith(
      "https://"
    )
      ? "wss:"
      : "ws:";


  const host =
    API_BASE
      .replace(
        /^https?:\/\//,
        ""
      )
      .replace(
        /\/$/,
        ""
      );


  const socket =
    new WebSocket(
      `${protocol}//${host}/ws`
    );


  socket.onopen = () => {

    setConnectionStatus(
      "NETWORK ONLINE",
      "online"
    );

    document.getElementById(
      "connectionInfo"
    ).textContent =
      "WebSocket Online";
  };


  socket.onclose = () => {

    setConnectionStatus(
      "DISCONNECTED",
      "offline"
    );

    document.getElementById(
      "connectionInfo"
    ).textContent =
      "Disconnected";


    setTimeout(
      connectWebSocket,
      5000
    );
  };


  socket.onerror = () => {

    setConnectionStatus(
      "SOCKET ERROR",
      "offline"
    );
  };


  socket.onmessage = event => {

    try {

      const data =
        JSON.parse(
          event.data
        );


      if (
        data.type ===
        "NETWORK_STATE"
      ) {

        network.nodes =
          data.nodes || [];

        network.links =
          data.links || [];


        renderNetwork();

        renderNodes();

        renderSelects();
      }


      if (
        data.type ===
        "NODE_STATUS_CHANGED"
      ) {

        loadNetwork();

        loadStats();
      }

    } catch (error) {

      console.error(
        "WebSocket data error:",
        error
      );
    }
  };
}


/* -----------------------------
   CONNECTION STATUS
----------------------------- */

function setConnectionStatus(
  text,
  state
) {

  const element =
    document.getElementById(
      "connectionStatus"
    );


  element.className =
    `connection ${state}`;


  element.innerHTML = `
    <span class="statusDot"></span>
    ${escapeHTML(text)}
  `;
}


/* -----------------------------
   CONNECTION ERROR
----------------------------- */

function showConnectionError() {

  setConnectionStatus(
    "SERVER OFFLINE",
    "offline"
  );


  document.getElementById(
    "connectionInfo"
  ).textContent =
    "Backend Offline";
}


/* -----------------------------
   HTML SAFETY
----------------------------- */

function escapeHTML(value) {

  return String(value)
    .replace(
      /&/g,
      "&amp;"
    )
    .replace(
      /</g,
      "&lt;"
    )
    .replace(
      />/g,
      "&gt;"
    )
    .replace(
      /"/g,
      "&quot;"
    )
    .replace(
      /'/g,
      "&#039;"
    );
}


/* -----------------------------
   START
----------------------------- */

async function start() {

  setConnectionStatus(
    "CONNECTING",
    "connecting"
  );


  try {

    await Promise.all([
      loadNetwork(),
      loadStats()
    ]);


    setConnectionStatus(
      "API CONNECTED",
      "online"
    );


    document.getElementById(
      "connectionInfo"
    ).textContent =
      "API Connected";


    connectWebSocket();

  } catch (error) {

    console.error(
      "Frontend startup error:",
      error
    );


    showConnectionError();
  }
}


/* -----------------------------
   ROUTE BUTTON
----------------------------- */

document
  .getElementById(
    "routeButton"
  )
  .addEventListener(
    "click",
    findRoute
  );


/* START */

start();
