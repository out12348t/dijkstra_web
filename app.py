import json
import os
import time
import urllib.error
import urllib.request

from flask import Flask, jsonify, render_template, request


app = Flask(__name__, template_folder="template", static_folder="template", static_url_path="")
GEMINI_MODEL = "gemini-3.5-flash-lite"


@app.get("/")
def home():
    return render_template("dijkstra.html")


def read_graph(data):
    edges = data.get("edges")
    directed = data.get("is_directed", True)
    if not isinstance(edges, list) or not isinstance(directed, bool):
        raise ValueError("Dữ liệu đồ thị không hợp lệ")

    graph = {}
    for edge in edges:
        if not isinstance(edge, dict):
            raise ValueError("Thông tin cạnh không hợp lệ")
        u = str(edge.get("from", "")).strip()
        v = str(edge.get("to", "")).strip()
        if not u or not v:
            raise ValueError("Mỗi cạnh cần có đủ đỉnh đầu và đỉnh cuối")
        try:
            weight = int(edge.get("weight"))
        except (TypeError, ValueError):
            raise ValueError(f"Trọng số cạnh {u} - {v} phải là số nguyên")
        if weight < 0:
            raise ValueError("Không được sử dụng trọng số âm")

        graph.setdefault(u, []).append((v, weight))
        graph.setdefault(v, [])
        if not directed:
            graph[v].append((u, weight))
    return graph


@app.post("/api/dijkstra")
def run_dijkstra():
    try:
        data = request.get_json(silent=True) or {}
        graph = read_graph(data)
        start = str(data.get("start", "")).strip()
        end = str(data.get("end", "")).strip()
        if start not in graph:
            raise ValueError("Đỉnh bắt đầu không tồn tại")
        if end not in graph:
            raise ValueError("Đỉnh kết thúc không tồn tại")

        distances = {node: float("inf") for node in graph}
        previous = {node: None for node in graph}
        distances[start] = 0
        queue = [(0, start)]
        import heapq

        vertex_count = len(graph)
        edge_count = sum(len(neighbors) for neighbors in graph.values())
        edge_checks = 0
        heap_pushes = 1
        heap_pops = 0
        max_queue_size = len(queue)
        started_at = time.perf_counter()

        while queue:
            distance, node = heapq.heappop(queue)
            heap_pops += 1
            if distance > distances[node]:
                continue
            for neighbor, weight in graph[node]:
                edge_checks += 1
                candidate = distance + weight
                if candidate < distances[neighbor]:
                    distances[neighbor] = candidate
                    previous[neighbor] = node
                    heapq.heappush(queue, (candidate, neighbor))
                    heap_pushes += 1
                    max_queue_size = max(max_queue_size, len(queue))

        elapsed_ms = (time.perf_counter() - started_at) * 1000
        complexity = {
            "time": "O((V + E) log E) with heapq (lazy duplicates)",
            "space": "O(V + E), including the adjacency list",
            "vertices": vertex_count,
            "directed_edges": edge_count,
            "edge_checks": edge_checks,
            "heap_pushes": heap_pushes,
            "heap_pops": heap_pops,
            "max_queue_size": max_queue_size,
            "elapsed_ms": round(elapsed_ms, 3),
        }
        app.logger.info(
            "Dijkstra complexity: time=%s, space=%s, V=%d, E=%d, "
            "edge_checks=%d, heap_pushes=%d, heap_pops=%d, "
            "max_queue_size=%d, elapsed=%.3f ms",
            complexity["time"], complexity["space"], vertex_count, edge_count,
            edge_checks, heap_pushes, heap_pops, max_queue_size, elapsed_ms,
        )

        if distances[end] == float("inf"):
            path = None
        else:
            path = []
            node = end
            while node is not None:
                path.append(node)
                node = previous[node]
            path.reverse()

        return jsonify({
            "path": path,
            "distance": distances[end] if path is not None else None,
            "distances": {node: (value if value != float("inf") else None)
                          for node, value in distances.items()},
            "complexity": complexity,
        })
    except ValueError as error:
        return jsonify({"error": str(error)}), 400


@app.post("/api/recognize-image")
def recognize_image():
    image = request.files.get("image")
    api_key = request.form.get("api_key", "").strip() or os.getenv("GEMINI_API_KEY", "").strip()
    if image is None:
        return jsonify({"error": "Không nhận được tệp ảnh (field cần tên image)"}), 400
    if not api_key:
        return jsonify({"error": "Thiếu Gemini API Key"}), 400
    if not image.mimetype or not image.mimetype.startswith("image/"):
        return jsonify({"error": "Tệp tải lên phải là hình ảnh"}), 400

    prompt = (
        "Phân tích hình ảnh đồ thị toán học này. Xác định đồ thị có hướng hay vô hướng. "
        "Trích xuất mọi cạnh dưới dạng from, to, weight; trọng số không ghi thì dùng 1. "
        "Chỉ trả JSON có is_directed (boolean) và edges (mảng các object from/to/weight)."
    )
    payload = {
        "contents": [{"parts": [
            {"text": prompt},
            {"inline_data": {
                "mime_type": image.mimetype,
                "data": __import__("base64").b64encode(image.read()).decode("ascii"),
            }},
        ]}],
        "generationConfig": {
            "temperature": 0.1,
            "response_mime_type": "application/json",
            "response_schema": {
                "type": "OBJECT",
                "properties": {
                    "is_directed": {"type": "BOOLEAN"},
                    "edges": {"type": "ARRAY", "items": {
                        "type": "OBJECT",
                        "properties": {
                            "from": {"type": "STRING"},
                            "to": {"type": "STRING"},
                            "weight": {"type": "INTEGER"},
                        },
                        "required": ["from", "to", "weight"],
                    }},
                },
                "required": ["is_directed", "edges"],
            },
        },
    }
    endpoint = (
        "https://generativelanguage.googleapis.com/v1beta/models/"
        f"{GEMINI_MODEL}:generateContent?key={api_key}"
    )
    req = urllib.request.Request(
        endpoint,
        data=json.dumps(payload).encode("utf-8"),
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    try:
        with urllib.request.urlopen(req, timeout=60) as response:
            result = json.loads(response.read().decode("utf-8"))
        content = result["candidates"][0]["content"]["parts"][0]["text"]
        graph_data = json.loads(content)
        # Validate the model response before returning it to the browser.
        read_graph(graph_data)
        return jsonify(graph_data)
    except urllib.error.HTTPError as error:
        detail = error.read().decode("utf-8", errors="replace")
        try:
            detail = json.loads(detail).get("error", {}).get("message", detail)
        except json.JSONDecodeError:
            pass
        return jsonify({"error": detail or f"Gemini trả về HTTP {error.code}"}), 502
    except (urllib.error.URLError, KeyError, IndexError, TypeError, json.JSONDecodeError, ValueError) as error:
        return jsonify({"error": str(error) or "Không thể nhận diện ảnh"}), 502


if __name__ == "__main__":
    app.run(debug=True)
