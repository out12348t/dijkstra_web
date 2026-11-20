
// Dán API Key mặc định vào đây nếu muốn (hoặc nhập trực tiếp trên thanh header)
const DEFAULT_GEMINI_API_KEY = "YOUR_GEMINI_API_KEY";

const apiKeyInput = document.getElementById("apiKeyInput");
apiKeyInput.value = localStorage.getItem("gemini_api_key") || (DEFAULT_GEMINI_API_KEY !== "YOUR_GEMINI_API_KEY" ? DEFAULT_GEMINI_API_KEY : "");
apiKeyInput.addEventListener("change", () => localStorage.setItem("gemini_api_key", apiKeyInput.value.trim()));

// Dữ liệu mẫu mặc định
let graphState = {
is_directed: true,
edges: [
    { from: "A", to: "C", weight: 1 },
    { from: "A", to: "B", weight: 4 },
    { from: "C", to: "B", weight: 2 },
    { from: "C", to: "D", weight: 5 },
    { from: "B", to: "D", weight: 1 }
]
};

function switchPage(page, el) {
document.querySelectorAll('.nav-item-btn').forEach(b => b.classList.remove('active'));
el.classList.add('active');
['home', 'guide', 'about'].forEach(p => {
    document.getElementById('page-' + p).classList.toggle('d-none', p !== page);
});
}

// =========================================================================
// THUẬT TOÁN DIJKSTRA & PATHFIND (CHUYỂN TỪ CODE PYTHON CỦA BẠN)
// =========================================================================
function buildGraphFromEdges(edges, directed) {
const graph = {};
for (const row of edges) {
    const u = String(row.from || "").trim();
    const v = String(row.to || "").trim();
    if (!u || !v) continue;

    if (row.weight === "" || row.weight === null || row.weight === undefined || Number.isNaN(Number(row.weight))) {
    throw new Error(`Thiếu trọng số ở cạnh ${u} - ${v}`);
    }

    const w = Number(row.weight);
    if (!Number.isInteger(w)) {
    throw new Error(`Trọng số cạnh ${u} - ${v} phải là số nguyên`);
    }
    if (w < 0) {
    throw new Error("Không được sử dụng trọng số âm");
    }

    if (!graph[u]) graph[u] = [];
    graph[u].push([v, w]);

    if (!graph[v]) graph[v] = [];
    if (!directed) {
    graph[v].push([u, w]);
    }
}
return graph;
}

function dijkstra(graph, start) {
if (!(start in graph)) {
    throw new Error("Đỉnh bắt đầu không tồn tại");
}

const dist = {};
const previous = {};
for (const v in graph) {
    dist[v] = Infinity;
    previous[v] = null;
}
dist[start] = 0;

// Hàng đợi ưu tiên mô phỏng heapq
const save = [[0, start]];

while (save.length > 0) {
    save.sort((a, b) => a[0] - b[0]);
    const [d, u] = save.shift();

    if (d > dist[u]) continue;

    for (const [v, w] of graph[u]) {
    if (dist[u] + w < dist[v]) {
        dist[v] = dist[u] + w;
        previous[v] = u;
        save.push([dist[v], v]);
    }
    }
}
return { dist, previous };
}

function pathfind(previous, dist, start, end) {
if (!(end in dist)) {
    throw new Error("Đỉnh kết thúc không tồn tại");
}
if (dist[end] === Infinity) {
    return { path: null, distance: Infinity };
}

const path = [];
const distance = dist[end];
let curr = end;

while (curr !== null) {
    path.push(curr);
    curr = previous[curr];
}
path.reverse();

if (path[0] === start) {
    return { path, distance };
}
return { path: null, distance: Infinity };
}

async function handleRunDijkstra() {
const start = document.getElementById("startNodeSelect").value;
const end = document.getElementById("endNodeSelect").value;
const directed = document.getElementById("isDirectedCheck").checked;

try {
    // Gửi đúng cấu trúc JSON mà Flask đọc: edges, is_directed, start, end.
    const response = await fetch("/api/dijkstra", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
        edges: graphState.edges,
        is_directed: directed,
        start,
        end
    })
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || `HTTP ${response.status}`);
    const path = result.path;
    const distance = result.distance;
    const dist = result.distances;
      console.groupCollapsed("Dijkstra complexity");
      console.log("Time complexity:", result.complexity.time);
      console.log("Space complexity:", result.complexity.space);
      console.table(result.complexity);
      console.groupEnd();

    const box = document.getElementById("pathResultBox");
    if (path === null) {
    box.style.background = "#fee2e2";
    box.style.color = "#7f1d1d";
    box.innerHTML = `<div class="fw-bold">Không tồn tại đường đi từ ${start} đến ${end}</div>`;
    renderGraph([]);
    } else {
    box.style.background = "#dcfce7";
    box.style.color = "#14532d";
    box.innerHTML = `
        <div class="small mb-1">Đường đi ngắn nhất từ <b>${start}</b> đến <b>${end}</b>:</div>
        <h5 class="fw-bold mb-1">${path.join(" → ")}</h5>
        <div class="fw-bold small">Tổng trọng số: <span>${distance}</span></div>
    `;
    renderGraph(path);
    }

    // Cập nhật bảng khoảng cách
    const distBody = document.getElementById("distTableBody");
    distBody.innerHTML = Object.keys(dist).sort().map(node => `
    <tr>
        <td class="fw-bold">${node}</td>
        <td>${dist[node] === null || dist[node] === Infinity ? "∞" : dist[node]}</td>
    </tr>
    `).join("");

} catch (err) {
    alert("Lỗi: " + err.message);
}
}

// =========================================================================
// GỌI TRỰC TIẾP GEMINI 2.0 FLASH-LITE VISION API TỪ TRÌNH DUYỆT
// =========================================================================
function fileToBase64(file) {
return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result.split(",")[1]);
    reader.onerror = reject;
    reader.readAsDataURL(file);
});
}

async function handleImageUpload(event) {
const file = event.target.files[0];
if (!file) return;

const apiKey = apiKeyInput.value.trim();
if (!apiKey) {
    alert("Vui lòng nhập Gemini API Key ở ô góc trên bên phải trước khi tải ảnh!");
    event.target.value = "";
    return;
}

const loading = document.getElementById("loadingStatus");
loading.classList.remove("d-none");

try {
    const formData = new FormData();
    formData.append("image", file, file.name);
    formData.append("api_key", apiKey);
    const res = await fetch("/api/recognize-image", {
    method: "POST",
    body: formData
    });
    const graphData = await res.json();
    if (!res.ok) throw new Error(graphData.error || `HTTP ${res.status}`);
    if (!Array.isArray(graphData.edges) || typeof graphData.is_directed !== "boolean") {
    throw new Error("Dữ liệu nhận diện từ máy chủ không đúng định dạng");
    }
    graphState.is_directed = graphData.is_directed;
    graphState.edges = graphData.edges;
    document.getElementById("isDirectedCheck").checked = graphData.is_directed;

    renderEdgesTable();
    renderGraph();
    handleRunDijkstra();
} catch (err) {
    alert("Lỗi tải/nhận diện ảnh: " + err.message);
} finally {
    loading.classList.add("d-none");
    event.target.value = "";
}
}

// =========================================================================
// RENDER BẢNG DỮ LIỆU & VẼ ĐỒ THỊ TRỰC QUAN
// =========================================================================
function renderEdgesTable() {
const tbody = document.getElementById("edgesTableBody");
tbody.innerHTML = "";
graphState.edges.forEach((edge, idx) => {
    tbody.innerHTML += `
    <tr>
        <td><input type="text" class="form-control form-control-sm text-center fw-bold" value="${edge.from}" onchange="updateEdge(${idx}, 'from', this.value)"></td>
        <td><input type="text" class="form-control form-control-sm text-center fw-bold" value="${edge.to}" onchange="updateEdge(${idx}, 'to', this.value)"></td>
        <td><input type="number" class="form-control form-control-sm text-center" value="${edge.weight}" onchange="updateEdge(${idx}, 'weight', this.value)"></td>
        <td><button class="btn btn-sm btn-outline-danger" onclick="removeEdge(${idx})"><i class="bi bi-trash"></i></button></td>
    </tr>
    `;
});
updateNodeDropdowns();
}

function updateEdge(idx, field, val) {
graphState.edges[idx][field] = field === "weight" ? val : val.trim();
updateNodeDropdowns();
}

function addEdgeRow() {
graphState.edges.push({ from: "", to: "", weight: 1 });
renderEdgesTable();
}

function removeEdge(idx) {
graphState.edges.splice(idx, 1);
renderEdgesTable();
renderGraph();
}

function updateNodeDropdowns() {
const nodes = new Set();
graphState.edges.forEach(e => {
    if (e.from) nodes.add(String(e.from).trim());
    if (e.to) nodes.add(String(e.to).trim());
});
const sortedNodes = Array.from(nodes).sort();
const startSel = document.getElementById("startNodeSelect");
const endSel = document.getElementById("endNodeSelect");
const prevStart = startSel.value || "A";
const prevEnd = endSel.value || "D";

startSel.innerHTML = sortedNodes.map(n => `<option value="${n}">${n}</option>`).join("");
endSel.innerHTML = sortedNodes.map(n => `<option value="${n}">${n}</option>`).join("");

if (sortedNodes.includes(prevStart)) startSel.value = prevStart;
if (sortedNodes.includes(prevEnd)) endSel.value = prevEnd;
}

function renderGraph(highlightPath = []) {
const isDirected = document.getElementById("isDirectedCheck").checked;
graphState.is_directed = isDirected;

const nodeSet = new Set();
graphState.edges.forEach(e => {
    if (e.from) nodeSet.add(String(e.from).trim());
    if (e.to) nodeSet.add(String(e.to).trim());
});

const nodes = Array.from(nodeSet).map(id => ({
    id: id,
    label: id,
    shape: "circle",
    color: {
    background: highlightPath.includes(id) ? "#16a34a" : "#1d4ed8",
    border: highlightPath.includes(id) ? "#14532d" : "#1e3a8a"
    },
    font: { color: "#ffffff", size: 18, bold: true },
    margin: 12
}));

const pathPairs = new Set();
for (let i = 0; i < highlightPath.length - 1; i++) {
    pathPairs.add(`${highlightPath[i]}->${highlightPath[i+1]}`);
    if (!isDirected) pathPairs.add(`${highlightPath[i+1]}->${highlightPath[i]}`);
}

const edges = graphState.edges
    .filter(e => e.from && e.to)
    .map(e => {
    const u = String(e.from).trim();
    const v = String(e.to).trim();
    const isHighlighted = pathPairs.has(`${u}->${v}`);
    return {
        from: u,
        to: v,
        label: String(e.weight),
        arrows: isDirected ? "to" : "",
        color: { color: isHighlighted ? "#16a34a" : "#334155" },
        width: isHighlighted ? 3.5 : 2,
        font: { size: 15, align: "top", bold: true, color: "#0f172a" }
    };
    });

const container = document.getElementById("graphCanvas");
new vis.Network(container, { nodes, edges }, {
    physics: { enabled: true, stabilization: { iterations: 100 } }
});
}

// Khởi tạo giao diện ban đầu
renderEdgesTable();
handleRunDijkstra();
