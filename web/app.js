/* 今昔対照 — 旧版地形図と地理院地図の連動ビューア */

const GSI_MAPS = [
  { id: "std", name: "標準地図", ext: "png", max: 18 },
  { id: "pale", name: "淡色地図", ext: "png", max: 18 },
  { id: "blank", name: "白地図", ext: "png", max: 14 },
  { id: "seamlessphoto", name: "写真", ext: "jpg", max: 18 },
  { id: "relief", name: "色別標高図", ext: "png", max: 15 },
  { id: "hillshademap", name: "陰影起伏図", ext: "png", max: 16 },
];

const LINE_KINDS = [
  ["solid", "実線"],
  ["dash", "破線"],
  ["dot", "点線"],
  ["chain", "一点鎖線"],
  ["chain2", "二点鎖線"],
];

const PALETTE = ["#c4452d", "#1d4e89", "#2f6b4f", "#1a1a1a", "#c47b16", "#6b3fa0", "#0e7490", "#9f1239"];
const NAMED_COLORS = [
  ["#d40000", "赤"],
  ["#f0c400", "黄"],
  ["#1c8c32", "緑"],
  ["#1a4fd8", "青"],
  ["#7428b0", "紫"],
  ["#ffffff", "白"],
  ["#161616", "黒"],
];
const TRANSPARENT =
  "data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7";
const STORE_KEY = "konjaku-taisho-v1";

const $ = (id) => document.getElementById(id);

const state = {
  folder: DATASETS[0].folder,
  eraFolder: DATASETS[0].eras[0].folder,
  gsi: "std",
  resBias: 0,
  overlay: 0,
  showCompass: true,
  showScale: true,
  showCenter: true,
  showOnRight: false,
  compassSize: 1,
  scaleSize: 1,
  pitchMode: "auto",
  segments: 4,
  pinArmed: false,
  saveRatio: 1.5,
  layers: [],
  styles: {},
  pin: null,
};

let seq = 1;
let syncing = false;
let leftMap;
let rightMap;
let oldTiles;
let nowTiles;
let overlayTiles;
let pinLeft;
let pinRight;

function dataset() {
  return DATASETS.find((d) => d.folder === state.folder) || DATASETS[0];
}

function era() {
  const ds = dataset();
  return ds.eras.find((e) => e.folder === state.eraFolder) || ds.eras[0];
}

function gsiSpec() {
  return GSI_MAPS.find((g) => g.id === state.gsi) || GSI_MAPS[0];
}

function scaleName(scale) {
  if (scale === 20000) return "2万分1";
  if (scale === 25000) return "2万5千分1";
  if (scale === 50000) return "5万分1";
  return `1/${scale}`;
}

function yearText(item) {
  return item.start === item.end ? `${item.start}年` : `${item.start}-${item.end}年`;
}

function eraLabel(item) {
  return `${yearText(item)}　${scaleName(item.scale)}`;
}

function fileBase(ds, item) {
  const y = yearText(item);
  const dup = ds.eras.filter((e) => e.start === item.start && e.end === item.end).length > 1;
  return dup ? `${y}_${scaleName(item.scale)}` : y;
}

function clamp(n, a, b) {
  return Math.max(a, Math.min(b, n));
}

function project(lat, lng, zoom) {
  const scale = 256 * 2 ** zoom;
  const x = ((lng + 180) / 360) * scale;
  const sin = Math.sin((lat * Math.PI) / 180);
  const y = (0.5 - Math.log((1 + sin) / (1 - sin)) / (4 * Math.PI)) * scale;
  return { x, y };
}

function unproject(x, y, zoom) {
  const scale = 256 * 2 ** zoom;
  const lng = (x / scale) * 360 - 180;
  const n = Math.PI - (2 * Math.PI * y) / scale;
  const lat = (180 / Math.PI) * Math.atan(Math.sinh(n));
  return L.latLng(lat, lng);
}

function metersPerPixel(lat, zoom) {
  return (156543.03392 * Math.cos((lat * Math.PI) / 180)) / 2 ** zoom;
}

function formatDist(meters) {
  if (meters === 0) return "0";
  if (meters >= 1000) {
    const km = meters / 1000;
    const text = Number.isInteger(km) || km >= 10 ? String(km) : km.toFixed(1);
    return `${text} km`;
  }
  return `${meters} m`;
}

function autoPitch(mpp, segments, size) {
  const targetPx = 156 * size;
  const raw = (mpp * targetPx) / segments;
  const steps = [5, 10, 20, 25, 50, 100, 200, 250, 500, 1000, 2000, 2500, 5000, 10000, 20000, 50000, 100000];
  let best = steps[0];
  for (const step of steps) {
    if (step <= raw * 1.25) best = step;
  }
  return best;
}

function scaleSpec(map) {
  const mpp = metersPerPixel(map.getCenter().lat, map.getZoom());
  const pitch = state.pitchMode === "auto" ? autoPitch(mpp, state.segments, state.scaleSize) : state.pitchMode;
  const px = pitch / mpp;
  return {
    pitch,
    segments: state.segments,
    px,
    total: pitch * state.segments,
    totalPx: px * state.segments,
  };
}

function dashArray(kind, width) {
  const s = Math.max(1, width);
  const table = {
    solid: null,
    dash: `${8 * s} ${3.2 * s}`,
    dot: `${Math.max(1, s * 0.7)} ${2.4 * s}`,
    chain: `${8 * s} ${2.4 * s} ${Math.max(1, s * 0.7)} ${2.4 * s}`,
    chain2: `${8 * s} ${2.2 * s} ${Math.max(1, s * 0.65)} ${2.2 * s} ${Math.max(1, s * 0.65)} ${2.2 * s}`,
  };
  return table[kind] || null;
}

function isLightColor(color) {
  const hex = String(color).replace("#", "");
  if (hex.length !== 6) return false;
  const red = parseInt(hex.slice(0, 2), 16);
  const green = parseInt(hex.slice(2, 4), 16);
  const blue = parseInt(hex.slice(4, 6), 16);
  return red > 230 && green > 230 && blue > 230;
}

function lineStyle(layer) {
  return {
    color: layer.color,
    weight: layer.width,
    opacity: layer.opacity,
    dashArray: dashArray(layer.dash, layer.width),
    lineCap: "butt",
    lineJoin: "round",
  };
}

function pointStyle(layer) {
  return {
    radius: Math.max(3, layer.width + 1),
    color: layer.color,
    weight: 1.5,
    opacity: layer.opacity,
    fillColor: layer.color,
    fillOpacity: layer.opacity,
  };
}

function toast(message) {
  const el = $("toast");
  el.textContent = message;
  el.hidden = false;
  clearTimeout(toast._t);
  toast._t = setTimeout(() => {
    el.hidden = true;
  }, 3400);
}

function loadStore() {
  try {
    const saved = JSON.parse(localStorage.getItem(STORE_KEY) || "null");
    if (!saved) return;
    Object.assign(state, {
      folder: saved.folder || state.folder,
      eraFolder: saved.eraFolder || state.eraFolder,
      gsi: saved.gsi || state.gsi,
      resBias: Number.isFinite(saved.resBias) ? saved.resBias : 0,
      overlay: Number.isFinite(saved.overlay) ? saved.overlay : 0,
      showCompass: saved.showCompass !== false,
      showScale: saved.showScale !== false,
      showCenter: saved.showCenter !== false,
      showOnRight: !!saved.showOnRight,
      compassSize: saved.compassSize || 1,
      scaleSize: saved.scaleSize || 1,
      pitchMode: saved.pitchMode ?? "auto",
      segments: saved.segments || 4,
      styles: saved.styles || {},
    });
  } catch {
    /* 保存データが壊れていても起動する */
  }
  if (!DATASETS.some((d) => d.folder === state.folder)) state.folder = DATASETS[0].folder;
  if (!dataset().eras.some((e) => e.folder === state.eraFolder)) state.eraFolder = dataset().eras[0].folder;
  if (!GSI_MAPS.some((g) => g.id === state.gsi)) state.gsi = "std";
}

function saveStore() {
  const styles = {};
  for (const layer of state.layers) {
    styles[layer.name] = {
      color: layer.color,
      dash: layer.dash,
      width: layer.width,
      opacity: layer.opacity,
      visible: layer.visible,
    };
  }
  state.styles = { ...state.styles, ...styles };
  localStorage.setItem(
    STORE_KEY,
    JSON.stringify({
      folder: state.folder,
      eraFolder: state.eraFolder,
      gsi: state.gsi,
      resBias: state.resBias,
      overlay: state.overlay,
      showCompass: state.showCompass,
      showScale: state.showScale,
      showCenter: state.showCenter,
      showOnRight: state.showOnRight,
      compassSize: state.compassSize,
      scaleSize: state.scaleSize,
      pitchMode: state.pitchMode,
      segments: state.segments,
      styles: state.styles,
    })
  );
}

function tileOptions(ds) {
  const bias = state.resBias;
  return {
    tms: true,
    crossOrigin: "anonymous",
    detectRetina: false,
    minZoom: 5,
    maxZoom: 18,
    zoomOffset: bias,
    tileSize: 256 / 2 ** bias,
    maxNativeZoom: ds.maxZ - bias,
    minNativeZoom: ds.minZ - bias,
    errorTileUrl: TRANSPARENT,
  };
}

function konjakuTemplate(ds, item) {
  return `https://ktgis.net/kjmapw/kjtilemap/${ds.folder}/${item.folder}/{z}/{x}/{y}.png`;
}

function gsiTemplate(spec) {
  return `https://cyberjapandata.gsi.go.jp/xyz/${spec.id}/{z}/{x}/{y}.${spec.ext}`;
}

function refreshOldTiles() {
  const ds = dataset();
  const item = era();
  if (oldTiles) leftMap.removeLayer(oldTiles);
  oldTiles = L.tileLayer(konjakuTemplate(ds, item), tileOptions(ds)).addTo(leftMap);
  $("left-title").textContent = eraLabel(item);
  refreshOverlay();
  updateResHint();
}

function refreshNowTiles() {
  const spec = gsiSpec();
  if (nowTiles) rightMap.removeLayer(nowTiles);
  nowTiles = L.tileLayer(gsiTemplate(spec), {
    crossOrigin: "anonymous",
    detectRetina: false,
    maxZoom: 18,
    maxNativeZoom: spec.max,
    errorTileUrl: TRANSPARENT,
  }).addTo(rightMap);
  if (overlayTiles) overlayTiles.bringToFront();
  $("right-title").textContent = spec.name;
}

function refreshOverlay() {
  if (overlayTiles) {
    rightMap.removeLayer(overlayTiles);
    overlayTiles = null;
  }
  if (state.overlay <= 0) return;
  const ds = dataset();
  overlayTiles = L.tileLayer(konjakuTemplate(ds, era()), {
    ...tileOptions(ds),
    opacity: state.overlay,
  }).addTo(rightMap);
  overlayTiles.bringToFront();
}

function follow(from, to) {
  if (syncing) return;
  syncing = true;
  to.setView(from.getCenter(), from.getZoom(), { animate: false });
  syncing = false;
}

function bindCursor(from, el) {
  from.on("mousemove", (event) => {
    const point = event.containerPoint;
    el.hidden = false;
    el.style.transform = `translate(${point.x}px, ${point.y}px)`;
    const ll = event.latlng;
    $("coord-readout").textContent =
      `${ll.lat.toFixed(5)}, ${ll.lng.toFixed(5)}　ズーム ${from.getZoom()}`;
  });
  from.on("mouseout", () => {
    el.hidden = true;
  });
}

function mirrorCursor(from, to, el) {
  from.on("mousemove", (event) => {
    const point = to.latLngToContainerPoint(event.latlng);
    el.hidden = false;
    el.style.transform = `translate(${point.x}px, ${point.y}px)`;
  });
  from.on("mouseout", () => {
    el.hidden = true;
  });
}

function fillDatasets() {
  const select = $("dataset");
  let group = "";
  let optgroup = null;
  for (const item of DATASETS) {
    if (item.group !== group) {
      group = item.group;
      optgroup = document.createElement("optgroup");
      optgroup.label = group;
      select.append(optgroup);
    }
    const option = document.createElement("option");
    option.value = item.folder;
    option.textContent = item.name;
    optgroup.append(option);
  }
  select.value = state.folder;
}

function fillEras() {
  const select = $("era");
  select.innerHTML = "";
  for (const item of dataset().eras) {
    const option = document.createElement("option");
    option.value = item.folder;
    option.textContent = eraLabel(item);
    select.append(option);
  }
  select.value = era().folder;
}

function fillGsi() {
  const select = $("gsi");
  for (const item of GSI_MAPS) {
    const option = document.createElement("option");
    option.value = item.id;
    option.textContent = item.name;
    select.append(option);
  }
  select.value = state.gsi;
}

function applyControlValues() {
  $("show-compass").checked = state.showCompass;
  $("show-scale").checked = state.showScale;
  $("show-center").checked = state.showCenter;
  $("show-right-deco").checked = state.showOnRight;
  $("compass-size").value = String(Math.round(state.compassSize * 100));
  $("scale-size").value = String(Math.round(state.scaleSize * 100));
  $("pitch").value = String(state.pitchMode);
  $("segments").value = String(state.segments);
  $("overlay").value = String(Math.round(state.overlay * 100));
  $("overlay-val").textContent = `${Math.round(state.overlay * 100)}%`;
  $("compass-val").textContent = `${Math.round(state.compassSize * 100)}%`;
  $("scale-val").textContent = `${Math.round(state.scaleSize * 100)}%`;
  for (const button of $("res-bias").querySelectorAll("button")) {
    button.classList.toggle("is-on", Number(button.dataset.bias) === state.resBias);
  }
}

function updateResHint() {
  const ds = dataset();
  const zoom = leftMap ? leftMap.getZoom() : ds.zoom;
  const el = $("res-hint");
  if (state.resBias > 0 && zoom + 1 > ds.maxZ) {
    el.textContent = `この拡大率では、それ以上細かいタイルがありません（この地域の上限はズーム ${ds.maxZ}）。一段引くと高解像度の差が出ます。`;
    return;
  }
  if (state.resBias < 0 && zoom - 1 < ds.minZ) {
    el.textContent = "ここまで引くと、低解像度用の粗いタイルがありません。標準と同じ表示になります。";
    return;
  }
  el.textContent =
    state.resBias > 0
      ? "高は一段細かいタイルを縮小して出すので、文字や線がはっきりします。最大まで拡大すると標準と同じです。"
      : state.resBias < 0
        ? "低は一段粗いタイルを拡大します。読み込みは軽いですが、地形図は少しぼけます。"
        : "標準は、その拡大率のタイルをそのまま使います。";
}

function compassSvg(size) {
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("class", "compass-svg");
  svg.setAttribute("width", String(size));
  svg.setAttribute("height", String(size));
  svg.setAttribute("viewBox", "0 0 80 80");
  svg.innerHTML = `
    <circle cx="40" cy="40" r="30" fill="#f7f2e8" stroke="#241c16" stroke-width="1.4"/>
    <circle cx="40" cy="40" r="24" fill="none" stroke="#241c16" stroke-width="0.6"/>
    <polygon points="40,12 46,40 40,36 34,40" fill="#c4452d"/>
    <polygon points="40,68 34,40 40,44 46,40" fill="#241c16"/>
    <text x="40" y="11" text-anchor="middle" font-size="9" font-family="Shippori Mincho, serif" fill="#241c16">北</text>
  `;
  return svg;
}

function scalePlate(spec) {
  const plate = document.createElement("div");
  plate.className = "scale-plate";
  plate.style.setProperty("--bar-h", `${Math.max(6, 8 * state.scaleSize)}px`);
  plate.style.setProperty("--label", `${Math.max(9, 11 * state.scaleSize)}px`);
  const bar = document.createElement("div");
  bar.className = "scale-bar";
  bar.style.width = `${spec.totalPx}px`;
  for (let i = 0; i < spec.segments; i += 1) {
    const seg = document.createElement("i");
    seg.style.width = `${spec.px}px`;
    if (i % 2 === 1) seg.style.background = "#f7f2e8";
    bar.append(seg);
  }
  const labels = document.createElement("div");
  labels.className = "scale-labels";
  labels.style.width = `${spec.totalPx}px`;
  const crowded = spec.px < 46;
  for (let i = 0; i <= spec.segments; i += 1) {
    const span = document.createElement("span");
    const show = !crowded || i === 0 || i === spec.segments;
    span.textContent = show ? formatDist(spec.pitch * i) : "";
    labels.append(span);
  }
  plate.append(bar, labels);
  return plate;
}

function renderDecos() {
  const spec = scaleSpec(leftMap);
  const readout = $("scale-readout");
  const mapWidth = leftMap.getSize().x || 1;
  readout.textContent = `1目盛り ${formatDist(spec.pitch)}　全長 ${formatDist(spec.total)}　画面上 ${Math.round(spec.totalPx)} px`;
  readout.classList.toggle("warn", state.showScale && spec.totalPx > mapWidth * 0.42);

  for (const [el, enabled] of [
    [$("deco-old"), true],
    [$("deco-now"), state.showOnRight],
  ]) {
    el.replaceChildren();
    if (!enabled) continue;
    if (state.showCompass) el.append(compassSvg(Math.round(72 * state.compassSize)));
    if (state.showScale) el.append(scalePlate(spec));
  }
  $("cross-old").classList.toggle("is-off", !state.showCenter);
  $("cross-now").classList.toggle("is-off", !state.showCenter);
}

function childByLocalName(el, name) {
  for (const node of el.children) {
    if (node.localName === name) return node;
  }
  return null;
}

function descendants(el, name) {
  return [...el.getElementsByTagName("*")].filter((node) => node.localName === name);
}

function parseCoordText(text) {
  const points = [];
  for (const token of text.trim().split(/\s+/)) {
    if (!token) continue;
    const [lng, lat] = token.split(",").map(Number);
    if (Number.isFinite(lat) && Number.isFinite(lng)) points.push([lat, lng]);
  }
  return points;
}

function parseKml(text) {
  const doc = new DOMParser().parseFromString(text, "text/xml");
  if (doc.querySelector("parsererror")) throw new Error("KMLを読めませんでした");
  const lines = [];
  const points = [];
  const placemarks = descendants(doc, "Placemark");
  const roots = placemarks.length ? placemarks : [doc];
  for (const root of roots) {
    for (const track of descendants(root, "Track")) {
      const line = [];
      for (const coord of track.children) {
        if (coord.localName !== "coord") continue;
        const parts = coord.textContent.trim().split(/\s+/).map(Number);
        if (parts.length >= 2 && Number.isFinite(parts[0]) && Number.isFinite(parts[1])) {
          line.push([parts[1], parts[0]]);
        }
      }
      if (line.length >= 2) lines.push(line);
    }
    for (const node of descendants(root, "LineString").concat(descendants(root, "LinearRing"))) {
      const coords = childByLocalName(node, "coordinates") || descendants(node, "coordinates")[0];
      if (!coords) continue;
      const line = parseCoordText(coords.textContent);
      if (line.length >= 2) lines.push(line);
    }
    for (const node of descendants(root, "Point")) {
      const coords = childByLocalName(node, "coordinates") || descendants(node, "coordinates")[0];
      if (!coords) continue;
      const parsed = parseCoordText(coords.textContent);
      if (parsed[0]) points.push(parsed[0]);
    }
  }
  if (!lines.length && !points.length) throw new Error("線も点も見つかりませんでした");
  return { lines, points };
}

function paintLayer(layer) {
  layer.groupOld.clearLayers();
  layer.groupNow.clearLayers();
  const style = lineStyle(layer);
  const marker = pointStyle(layer);
  const halo = isLightColor(layer.color)
    ? { ...style, color: "#241c16", weight: layer.width + 2 }
    : null;
  for (const line of layer.lines) {
    if (halo) {
      L.polyline(line, halo).addTo(layer.groupOld);
      L.polyline(line, halo).addTo(layer.groupNow);
    }
    L.polyline(line, style).addTo(layer.groupOld);
    L.polyline(line, style).addTo(layer.groupNow);
  }
  if (halo) {
    marker.color = "#241c16";
    marker.weight = 2;
  }
  for (const point of layer.points) {
    L.circleMarker(point, marker).addTo(layer.groupOld);
    L.circleMarker(point, marker).addTo(layer.groupNow);
  }
  if (layer.visible) {
    layer.groupOld.addTo(leftMap);
    layer.groupNow.addTo(rightMap);
  } else {
    layer.groupOld.remove();
    layer.groupNow.remove();
  }
  stackLayers();
}

function stackLayers() {
  for (let i = state.layers.length - 1; i >= 0; i -= 1) {
    const layer = state.layers[i];
    if (!layer.visible) continue;
    layer.groupOld.bringToFront();
    layer.groupNow.bringToFront();
  }
}

function moveLayer(index, delta) {
  const next = index + delta;
  if (next < 0 || next >= state.layers.length) return;
  const [layer] = state.layers.splice(index, 1);
  state.layers.splice(next, 0, layer);
  stackLayers();
  renderLayerList();
  saveStore();
}

function renderLayerList() {
  const list = $("layers");
  list.innerHTML = "";
  state.layers.forEach((layer, index) => {
    const item = document.createElement("li");
    const head = document.createElement("div");
    head.className = "layer-head";
    const visible = document.createElement("input");
    visible.type = "checkbox";
    visible.checked = layer.visible;
    visible.addEventListener("change", () => {
      layer.visible = visible.checked;
      paintLayer(layer);
      saveStore();
    });
    const name = document.createElement("strong");
    name.textContent = layer.name;
    name.title = layer.name;
    const remove = document.createElement("button");
    remove.type = "button";
    remove.className = "ghost";
    remove.textContent = "削除";
    remove.addEventListener("click", () => {
      layer.groupOld.remove();
      layer.groupNow.remove();
      state.layers = state.layers.filter((entry) => entry !== layer);
      renderLayerList();
      saveStore();
    });
    const order = document.createElement("div");
    order.className = "layer-order";
    const up = document.createElement("button");
    up.type = "button";
    up.textContent = "↑";
    up.title = "前面へ";
    up.setAttribute("aria-label", `${layer.name}を前面へ`);
    up.disabled = index === 0;
    up.addEventListener("click", () => moveLayer(index, -1));
    const down = document.createElement("button");
    down.type = "button";
    down.textContent = "↓";
    down.title = "背面へ";
    down.setAttribute("aria-label", `${layer.name}を背面へ`);
    down.disabled = index === state.layers.length - 1;
    down.addEventListener("click", () => moveLayer(index, 1));
    order.append(up, down);
    head.append(visible, name, order, remove);

    const controls = document.createElement("div");
    controls.className = "layer-controls";
    const colors = document.createElement("div");
    colors.className = "layer-colors";
    const color = document.createElement("input");
    color.type = "color";
    color.value = layer.color;
    color.title = "RGB";
    const swatches = [];
    const markSwatches = () => {
      for (const swatch of swatches) {
        swatch.classList.toggle("is-on", swatch.dataset.color.toLowerCase() === layer.color.toLowerCase());
      }
    };
    for (const [value, label] of NAMED_COLORS) {
      const swatch = document.createElement("button");
      swatch.type = "button";
      swatch.className = "swatch";
      swatch.dataset.color = value;
      swatch.title = label;
      swatch.setAttribute("aria-label", label);
      swatch.style.background = value;
      swatch.addEventListener("click", () => {
        layer.color = value;
        color.value = value;
        markSwatches();
        paintLayer(layer);
        saveStore();
      });
      swatches.push(swatch);
      colors.append(swatch);
    }
    const rgb = document.createElement("label");
    rgb.className = "rgb";
    rgb.append("RGB", color);
    colors.append(rgb);
    color.addEventListener("input", () => {
      layer.color = color.value;
      markSwatches();
      paintLayer(layer);
      saveStore();
    });
    markSwatches();
    const dash = document.createElement("select");
    for (const [value, label] of LINE_KINDS) {
      const option = document.createElement("option");
      option.value = value;
      option.textContent = label;
      dash.append(option);
    }
    dash.value = layer.dash;
    dash.addEventListener("change", () => {
      layer.dash = dash.value;
      paintLayer(layer);
      saveStore();
    });
    const width = document.createElement("input");
    width.type = "number";
    width.min = "1";
    width.max = "16";
    width.value = String(layer.width);
    width.title = "太さ";
    width.addEventListener("change", () => {
      layer.width = clamp(Number(width.value) || 2, 1, 16);
      width.value = String(layer.width);
      paintLayer(layer);
      saveStore();
    });
    controls.append(dash, width);
    item.append(head, colors, controls);
    list.append(item);
  });
  $("fit-kml").disabled = state.layers.every((layer) => !layer.visible);
}

function addKmlLayer(name, parsed) {
  const known = state.styles[name] || {};
  const layer = {
    id: seq,
    name,
    color: known.color || PALETTE[(seq - 1) % PALETTE.length],
    dash: known.dash || "solid",
    width: known.width || 3,
    opacity: known.opacity ?? 0.95,
    visible: known.visible !== false,
    lines: parsed.lines,
    points: parsed.points,
    groupOld: L.featureGroup(),
    groupNow: L.featureGroup(),
  };
  seq += 1;
  state.layers.push(layer);
  paintLayer(layer);
  renderLayerList();
  saveStore();
}

function readKmlFile(file) {
  const reader = new FileReader();
  reader.onload = () => {
    try {
      addKmlLayer(file.name.replace(/\.kml$/i, ""), parseKml(String(reader.result)));
    } catch (error) {
      toast(error.message || "KMLを読み込めませんでした");
    }
  };
  reader.readAsText(file);
}

async function loadSamples() {
  for (const path of ["sample-a.kml", "sample-b.kml"]) {
    const res = await fetch(path);
    if (!res.ok) throw new Error("サンプルを取得できませんでした");
    const name = path === "sample-a.kml" ? "東京駅-皇居" : "皇居の堀";
    addKmlLayer(name, parseKml(await res.text()));
  }
  const ds = DATASETS.find((item) => item.folder === "tokyo50");
  if (ds && state.folder !== "tokyo50") {
    state.folder = "tokyo50";
    state.eraFolder = ds.eras[0].folder;
    $("dataset").value = "tokyo50";
    fillEras();
    refreshOldTiles();
  }
  leftMap.setView([35.6845, 139.758], 15);
}

function fitKml() {
  const bounds = L.latLngBounds([]);
  for (const layer of state.layers) {
    if (!layer.visible) continue;
    for (const line of layer.lines) bounds.extend(line);
    for (const point of layer.points) bounds.extend(point);
  }
  if (!bounds.isValid()) {
    toast("表示中の線がありません");
    return;
  }
  leftMap.fitBounds(bounds, { padding: [36, 36], maxZoom: 16 });
}

function setPin(latlng) {
  state.pin = latlng;
  const icon = L.divIcon({
    className: "pin",
    html: '<span class="pin-dot"></span>',
    iconSize: [16, 16],
    iconAnchor: [8, 8],
  });
  if (pinLeft) leftMap.removeLayer(pinLeft);
  if (pinRight) rightMap.removeLayer(pinRight);
  pinLeft = L.marker(latlng, { icon, interactive: false }).addTo(leftMap);
  pinRight = L.marker(latlng, { icon, interactive: false }).addTo(rightMap);
  $("pin-readout").textContent = `ピン　${latlng.lat.toFixed(5)}, ${latlng.lng.toFixed(5)}`;
}

function clearPin() {
  state.pin = null;
  if (pinLeft) leftMap.removeLayer(pinLeft);
  if (pinRight) rightMap.removeLayer(pinRight);
  pinLeft = null;
  pinRight = null;
  $("pin-readout").textContent = "ピンは左右の同じ地点に出ます。明治側で、いま見ている場所を固定できます。";
}

function urlZoomFor(mapZoom, bias, minZ, maxZ) {
  const tileZoom = clamp(mapZoom, minZ - bias, maxZ - bias);
  return tileZoom + bias;
}

function tilesForView(map, urlZoom) {
  const size = map.getSize();
  const corners = [
    [0, 0],
    [size.x, 0],
    [0, size.y],
    [size.x, size.y],
  ].map((point) => map.containerPointToLatLng(point));
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  for (const corner of corners) {
    const p = project(corner.lat, corner.lng, urlZoom);
    x0 = Math.min(x0, p.x);
    y0 = Math.min(y0, p.y);
    x1 = Math.max(x1, p.x);
    y1 = Math.max(y1, p.y);
  }
  const limit = 2 ** urlZoom;
  const tiles = [];
  const xa = clamp(Math.floor(x0 / 256), 0, limit - 1);
  const xb = clamp(Math.floor(x1 / 256), 0, limit - 1);
  const ya = clamp(Math.floor(y0 / 256), 0, limit - 1);
  const yb = clamp(Math.floor(y1 / 256), 0, limit - 1);
  for (let x = xa; x <= xb; x += 1) {
    for (let y = ya; y <= yb; y += 1) tiles.push({ x, y, z: urlZoom });
  }
  return tiles;
}

function loadImage(url) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error(url));
    img.src = url;
  });
}

async function loadTile(url) {
  try {
    return await loadImage(url);
  } catch {
    const proxied = `/proxy?url=${encodeURIComponent(url)}`;
    return loadImage(proxied);
  }
}

async function drawTileSet(ctx, map, tiles, urlOf, ratio, ox, oy, width, height, onStep) {
  ctx.save();
  ctx.beginPath();
  ctx.rect(ox, oy, width, height);
  ctx.clip();
  let done = 0;
  const queue = tiles.slice();
  async function worker() {
    while (queue.length) {
      const tile = queue.shift();
      const yTms = 2 ** tile.z - 1 - tile.y;
      try {
        const img = await loadTile(urlOf(tile, yTms));
        const nw = unproject(tile.x * 256, tile.y * 256, tile.z);
        const se = unproject((tile.x + 1) * 256, (tile.y + 1) * 256, tile.z);
        const a = map.latLngToContainerPoint(nw);
        const b = map.latLngToContainerPoint(se);
        ctx.drawImage(
          img,
          ox + a.x * ratio - 0.5,
          oy + a.y * ratio - 0.5,
          (b.x - a.x) * ratio + 1,
          (b.y - a.y) * ratio + 1
        );
      } catch {
        /* 範囲外のタイルは紙色のまま */
      }
      done += 1;
      onStep(done, tiles.length);
    }
  }
  await Promise.all(Array.from({ length: 6 }, () => worker()));
  ctx.restore();
}

function drawVectors(ctx, map, ratio, ox, oy) {
  for (let i = state.layers.length - 1; i >= 0; i -= 1) {
    const layer = state.layers[i];
    if (!layer.visible) continue;
    ctx.save();
    ctx.translate(ox, oy);
    ctx.globalAlpha = layer.opacity;
    ctx.strokeStyle = layer.color;
    ctx.fillStyle = layer.color;
    ctx.lineWidth = layer.width * ratio;
    ctx.lineJoin = "round";
    ctx.lineCap = "butt";
    const dash = dashArray(layer.dash, layer.width);
    const dashPx = dash ? dash.split(" ").map((n) => Number(n) * ratio) : [];
    const trace = () => {
      for (const line of layer.lines) {
        ctx.beginPath();
        line.forEach((point, index) => {
          const p = map.latLngToContainerPoint(point);
          if (index === 0) ctx.moveTo(p.x * ratio, p.y * ratio);
          else ctx.lineTo(p.x * ratio, p.y * ratio);
        });
        ctx.stroke();
      }
    };
    ctx.setLineDash(dashPx);
    if (isLightColor(layer.color)) {
      ctx.strokeStyle = "#241c16";
      ctx.lineWidth = (layer.width + 2) * ratio;
      trace();
    }
    ctx.strokeStyle = layer.color;
    ctx.lineWidth = layer.width * ratio;
    trace();
    ctx.setLineDash([]);
    for (const point of layer.points) {
      const p = map.latLngToContainerPoint(point);
      const radius = Math.max(3, layer.width + 1) * ratio;
      ctx.beginPath();
      ctx.arc(p.x * ratio, p.y * ratio, radius, 0, Math.PI * 2);
      if (isLightColor(layer.color)) {
        ctx.lineWidth = 2 * ratio;
        ctx.strokeStyle = "#241c16";
        ctx.stroke();
      }
      ctx.fillStyle = layer.color;
      ctx.fill();
    }
    ctx.restore();
  }
  if (state.pin) {
    const p = map.latLngToContainerPoint(state.pin);
    ctx.save();
    ctx.translate(ox + p.x * ratio, oy + p.y * ratio);
    ctx.beginPath();
    ctx.arc(0, 0, 7 * ratio, 0, Math.PI * 2);
    ctx.fillStyle = "#c4452d";
    ctx.fill();
    ctx.lineWidth = 2 * ratio;
    ctx.strokeStyle = "#fffaf3";
    ctx.stroke();
    ctx.restore();
  }
  if (state.showCenter) {
    ctx.save();
    ctx.translate(ox, oy);
    ctx.strokeStyle = "rgba(36,28,22,0.9)";
    ctx.lineWidth = 1.5 * ratio;
    const cx = (map.getSize().x / 2) * ratio;
    const cy = (map.getSize().y / 2) * ratio;
    const arm = 11 * ratio;
    ctx.beginPath();
    ctx.moveTo(cx, cy - arm);
    ctx.lineTo(cx, cy + arm);
    ctx.moveTo(cx - arm, cy);
    ctx.lineTo(cx + arm, cy);
    ctx.stroke();
    ctx.restore();
  }
}

function drawCompassCanvas(ctx, x, y, size) {
  const r = size / 2;
  ctx.save();
  ctx.translate(x + r, y + r);
  ctx.fillStyle = "rgba(247,242,232,0.94)";
  ctx.strokeStyle = "#241c16";
  ctx.lineWidth = Math.max(1, size / 56);
  ctx.beginPath();
  ctx.arc(0, 0, r * 0.78, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(0, -r * 0.68);
  ctx.lineTo(r * 0.14, 0);
  ctx.lineTo(0, -r * 0.08);
  ctx.lineTo(-r * 0.14, 0);
  ctx.closePath();
  ctx.fillStyle = "#c4452d";
  ctx.fill();
  ctx.beginPath();
  ctx.moveTo(0, r * 0.68);
  ctx.lineTo(-r * 0.14, 0);
  ctx.lineTo(0, r * 0.08);
  ctx.lineTo(r * 0.14, 0);
  ctx.closePath();
  ctx.fillStyle = "#241c16";
  ctx.fill();
  ctx.fillStyle = "#241c16";
  ctx.font = `${Math.max(10, size * 0.16)}px "Shippori Mincho", serif`;
  ctx.textAlign = "center";
  ctx.fillText("北", 0, -r * 0.82);
  ctx.restore();
}

function drawScaleCanvas(ctx, x, y, spec, ratio) {
  const h = Math.max(6, 8 * state.scaleSize) * ratio;
  const label = Math.max(9, 11 * state.scaleSize) * ratio;
  const width = spec.totalPx * ratio;
  ctx.save();
  ctx.fillStyle = "rgba(247,242,232,0.94)";
  ctx.fillRect(x - 6 * ratio, y - 4 * ratio, width + 12 * ratio, h + label + 12 * ratio);
  ctx.strokeStyle = "rgba(36,28,22,0.38)";
  ctx.strokeRect(x - 6 * ratio, y - 4 * ratio, width + 12 * ratio, h + label + 12 * ratio);
  for (let i = 0; i < spec.segments; i += 1) {
    ctx.fillStyle = i % 2 === 0 ? "#241c16" : "#f7f2e8";
    ctx.fillRect(x + spec.px * ratio * i, y, spec.px * ratio + 0.5, h);
  }
  ctx.strokeStyle = "#241c16";
  ctx.lineWidth = ratio;
  ctx.strokeRect(x, y, width, h);
  ctx.fillStyle = "#241c16";
  ctx.font = `${label}px "Zen Kaku Gothic New", sans-serif`;
  ctx.textBaseline = "top";
  const crowded = spec.px < 46;
  for (let i = 0; i <= spec.segments; i += 1) {
    if (crowded && i !== 0 && i !== spec.segments) continue;
    const text = formatDist(spec.pitch * i);
    const tx = x + spec.px * ratio * i;
    ctx.textAlign = i === 0 ? "left" : i === spec.segments ? "right" : "center";
    ctx.fillText(text, tx, y + h + 2 * ratio);
  }
  ctx.restore();
}

function drawCaption(ctx, item, ratio) {
  const pad = 14 * ratio;
  const year = yearText(item);
  const kind = `${scaleName(item.scale)}地形図`;
  ctx.save();
  ctx.fillStyle = "#000000";
  ctx.textBaseline = "top";
  ctx.font = `500 ${16 * ratio}px "Zen Kaku Gothic New", "Yu Gothic", sans-serif`;
  ctx.fillText(year, pad, pad);
  ctx.font = `500 ${14 * ratio}px "Zen Kaku Gothic New", "Yu Gothic", sans-serif`;
  ctx.fillText(kind, pad, pad + 22 * ratio);
  ctx.restore();
}

function drawCredit(ctx, width, height, ratio, target) {
  const parts = [];
  if (target !== "gsi") parts.push("今昔マップ on the web（谷謙二）");
  if (target !== "old") parts.push("地理院タイル（国土地理院）");
  const text = parts.join("／");
  ctx.save();
  ctx.font = `${11 * ratio}px "Zen Kaku Gothic New", sans-serif`;
  ctx.textAlign = "right";
  ctx.fillStyle = "rgba(36,28,22,0.78)";
  ctx.fillText(text, width - 10 * ratio, height - 10 * ratio);
  ctx.restore();
}

function openSave() {
  const ds = dataset();
  const select = $("save-era");
  select.innerHTML = "";
  for (const item of ds.eras) {
    const option = document.createElement("option");
    option.value = item.folder;
    option.textContent = eraLabel(item);
    select.append(option);
  }
  select.value = era().folder;
  state.saveRatio = 1.5;
  for (const button of $("save-ratio").querySelectorAll("button")) {
    button.classList.toggle("is-on", Number(button.dataset.ratio) === state.saveRatio);
  }
  $("save-progress").textContent = "";
  $("save-go").disabled = false;
  updateSavePreview();
  $("save-modal").hidden = false;
}

function saveTarget() {
  const button = $("save-target").querySelector("button.is-on");
  return button ? button.dataset.target : "old";
}

function updateSavePreview() {
  const ds = dataset();
  const item = ds.eras.find((entry) => entry.folder === $("save-era").value) || era();
  const target = saveTarget();
  const gsiOnly = target === "gsi";
  $("save-era-field").hidden = gsiOnly;
  $("save-caption-field").hidden = gsiOnly;
  $("save-hint").textContent = gsiOnly
    ? "いま表示している地理院地図を保存します。ファイル名は地図の種類になります。"
    : "この地域で今昔マップにある年代から選びます。ファイル名はその年代になります。";
  $("save-name").textContent = gsiOnly ? `地理院地図_${gsiSpec().name}.jpg` : `${fileBase(ds, item)}.jpg`;
  const size = leftMap.getSize();
  const ratio = state.saveRatio;
  const panes = target === "pair" ? 2 : 1;
  const w = Math.round(size.x * ratio) * panes;
  const h = Math.round(size.y * ratio);
  const label = ratio === 1 ? "低" : ratio === 2 ? "高" : "標準";
  $("save-pixels").textContent = `${label}　${w} × ${h} ピクセル`;
}

function drawFrameDecorations(ctx, map, ratio, ox, height) {
  if (state.showCompass) {
    drawCompassCanvas(
      ctx,
      ox + 14 * ratio,
      height - 16 * ratio - 72 * state.compassSize * ratio - (state.showScale ? 28 * state.scaleSize * ratio : 0),
      72 * state.compassSize * ratio
    );
  }
  if (state.showScale) {
    drawScaleCanvas(ctx, ox + 14 * ratio, height - 18 * ratio - 22 * state.scaleSize * ratio, scaleSpec(map), ratio);
  }
}

async function exportJpeg() {
  const ds = dataset();
  const item = ds.eras.find((entry) => entry.folder === $("save-era").value) || era();
  const ratio = state.saveRatio;
  const target = saveTarget();
  const pair = target === "pair";
  const drawOld = target !== "gsi";
  const drawNow = target !== "old";
  const size = leftMap.getSize();
  const width = Math.round(size.x * ratio);
  const height = Math.round(size.y * ratio);
  const canvas = document.createElement("canvas");
  canvas.width = width * (pair ? 2 : 1);
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "#e6dcc8";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";

  const zoom = leftMap.getZoom();
  const oldZoom = urlZoomFor(zoom, state.resBias, ds.minZ, ds.maxZ);
  const spec = gsiSpec();
  const nowZoom = clamp(zoom, 0, spec.max);
  const oldTiles = drawOld ? tilesForView(leftMap, oldZoom) : [];
  const nowTileList = drawNow ? tilesForView(rightMap, nowZoom) : [];
  const total = oldTiles.length + nowTileList.length;
  let finished = 0;
  const progress = () => {
    finished += 1;
    $("save-progress").textContent = `地図画像を集めています　${finished} / ${total}`;
  };

  $("save-go").disabled = true;
  await document.fonts.ready;
  if (drawOld) {
    await drawTileSet(
      ctx,
      leftMap,
      oldTiles,
      (tile) => `https://ktgis.net/kjmapw/kjtilemap/${ds.folder}/${item.folder}/${tile.z}/${tile.x}/${2 ** tile.z - 1 - tile.y}.png`,
      ratio,
      0,
      0,
      width,
      height,
      progress
    );
  }
  if (drawNow) {
    await drawTileSet(
      ctx,
      rightMap,
      nowTileList,
      (tile) => `https://cyberjapandata.gsi.go.jp/xyz/${spec.id}/${tile.z}/${tile.x}/${tile.y}.${spec.ext}`,
      ratio,
      pair ? width : 0,
      0,
      width,
      height,
      progress
    );
  }
  if (drawOld) drawVectors(ctx, leftMap, ratio, 0, 0);
  if (drawNow) drawVectors(ctx, rightMap, ratio, pair ? width : 0, 0);

  if (drawOld) drawFrameDecorations(ctx, leftMap, ratio, 0, height);
  if (pair && state.showOnRight) drawFrameDecorations(ctx, rightMap, ratio, width, height);
  if (target === "gsi") drawFrameDecorations(ctx, rightMap, ratio, 0, height);
  if (drawOld && $("save-caption").checked) drawCaption(ctx, item, ratio);
  drawCredit(ctx, canvas.width, canvas.height, ratio, target);

  const blob = await new Promise((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.92));
  if (!blob) throw new Error("画像を作れませんでした");
  const link = document.createElement("a");
  link.href = URL.createObjectURL(blob);
  link.download = target === "gsi" ? `地理院地図_${spec.name}.jpg` : `${fileBase(ds, item)}.jpg`;
  link.click();
  setTimeout(() => URL.revokeObjectURL(link.href), 4000);
  $("save-progress").textContent = `${link.download} を保存しました`;
  $("save-go").disabled = false;
}

async function searchPlace(query) {
  const endpoint = `https://msearch.gsi.go.jp/address-search/AddressSearch?q=${encodeURIComponent(query)}`;
  let res = await fetch(endpoint).catch(() => null);
  if (!res || !res.ok) {
    res = await fetch(`/proxy?url=${encodeURIComponent(endpoint)}`).catch(() => null);
  }
  if (!res || !res.ok) throw new Error("検索に失敗しました");
  const data = await res.json();
  const hits = $("search-hits");
  hits.innerHTML = "";
  if (!Array.isArray(data) || !data.length) {
    hits.hidden = true;
    toast("その地名は見つかりませんでした");
    return;
  }
  hits.hidden = false;
  for (const feature of data.slice(0, 6)) {
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = feature.properties.title;
    button.addEventListener("click", () => {
      const [lng, lat] = feature.geometry.coordinates;
      leftMap.setView([lat, lng], Math.max(leftMap.getZoom(), 15));
      hits.hidden = true;
      hits.innerHTML = "";
    });
    hits.append(button);
  }
  if (data.length === 1) hits.querySelector("button").click();
}

function bindUi() {
  $("dataset").addEventListener("change", () => {
    state.folder = $("dataset").value;
    state.eraFolder = dataset().eras[0].folder;
    fillEras();
    const ds = dataset();
    leftMap.setView([ds.lat, ds.lng], ds.zoom);
    refreshOldTiles();
    saveStore();
  });
  $("era").addEventListener("change", () => {
    state.eraFolder = $("era").value;
    refreshOldTiles();
    saveStore();
  });
  $("era-prev").addEventListener("click", () => stepEra(-1));
  $("era-next").addEventListener("click", () => stepEra(1));
  $("gsi").addEventListener("change", () => {
    state.gsi = $("gsi").value;
    refreshNowTiles();
    saveStore();
  });
  $("overlay").addEventListener("input", () => {
    state.overlay = Number($("overlay").value) / 100;
    $("overlay-val").textContent = `${$("overlay").value}%`;
    refreshOverlay();
    saveStore();
  });
  $("res-bias").addEventListener("click", (event) => {
    const button = event.target.closest("button");
    if (!button) return;
    state.resBias = Number(button.dataset.bias);
    applyControlValues();
    refreshOldTiles();
    saveStore();
  });
  $("kml-file").addEventListener("change", () => {
    for (const file of $("kml-file").files) readKmlFile(file);
    $("kml-file").value = "";
  });
  const drop = $("drop");
  drop.addEventListener("dragover", (event) => {
    event.preventDefault();
    drop.classList.add("is-over");
  });
  drop.addEventListener("dragleave", () => drop.classList.remove("is-over"));
  drop.addEventListener("drop", (event) => {
    event.preventDefault();
    drop.classList.remove("is-over");
  });
  window.addEventListener("dragover", (event) => event.preventDefault());
  window.addEventListener("drop", (event) => {
    event.preventDefault();
    const files = [...event.dataTransfer.files].filter((file) => /\.kml$/i.test(file.name));
    if (!files.length) {
      toast("KMLファイルをドロップしてください");
      return;
    }
    for (const file of files) readKmlFile(file);
  });
  $("load-sample").addEventListener("click", () => {
    loadSamples().catch((error) => toast(error.message));
  });
  $("fit-kml").addEventListener("click", fitKml);
  for (const [id, key, label] of [
    ["show-compass", "showCompass"],
    ["show-scale", "showScale"],
    ["show-center", "showCenter"],
    ["show-right-deco", "showOnRight"],
  ]) {
    $(id).addEventListener("change", () => {
      state[key] = $(id).checked;
      renderDecos();
      saveStore();
    });
    void label;
  }
  $("compass-size").addEventListener("input", () => {
    state.compassSize = Number($("compass-size").value) / 100;
    $("compass-val").textContent = `${$("compass-size").value}%`;
    renderDecos();
    saveStore();
  });
  $("scale-size").addEventListener("input", () => {
    state.scaleSize = Number($("scale-size").value) / 100;
    $("scale-val").textContent = `${$("scale-size").value}%`;
    renderDecos();
    saveStore();
  });
  $("pitch").addEventListener("change", () => {
    state.pitchMode = $("pitch").value === "auto" ? "auto" : Number($("pitch").value);
    renderDecos();
    saveStore();
  });
  $("segments").addEventListener("change", () => {
    state.segments = Number($("segments").value);
    renderDecos();
    saveStore();
  });
  $("pin-arm").addEventListener("click", () => {
    state.pinArmed = !state.pinArmed;
    $("pin-arm").classList.toggle("is-on", state.pinArmed);
    $("pin-arm").textContent = state.pinArmed ? "ピン置きを終了" : "クリックでピンを置く";
    document.querySelectorAll(".map-wrap").forEach((el) => el.classList.toggle("is-arm", state.pinArmed));
  });
  $("pin-clear").addEventListener("click", clearPin);
  for (const button of document.querySelectorAll("[data-open-save]")) {
    button.addEventListener("click", openSave);
  }
  $("save-cancel").addEventListener("click", () => {
    $("save-modal").hidden = true;
  });
  $("save-modal").addEventListener("click", (event) => {
    if (event.target === $("save-modal")) $("save-modal").hidden = true;
  });
  $("save-era").addEventListener("change", updateSavePreview);
  $("save-target").addEventListener("click", (event) => {
    const button = event.target.closest("button");
    if (!button) return;
    for (const item of $("save-target").querySelectorAll("button")) {
      item.classList.toggle("is-on", item === button);
    }
    updateSavePreview();
  });
  $("save-ratio").addEventListener("click", (event) => {
    const button = event.target.closest("button");
    if (!button) return;
    state.saveRatio = Number(button.dataset.ratio);
    for (const item of $("save-ratio").querySelectorAll("button")) {
      item.classList.toggle("is-on", item === button);
    }
    updateSavePreview();
  });
  $("save-go").addEventListener("click", () => {
    exportJpeg().catch((error) => {
      $("save-go").disabled = false;
      $("save-progress").textContent = error.message || "保存に失敗しました";
    });
  });
  $("search-form").addEventListener("submit", (event) => {
    event.preventDefault();
    const query = $("search-q").value.trim();
    if (!query) return;
    searchPlace(query).catch((error) => toast(error.message));
  });
}

function stepEra(dir) {
  const eras = dataset().eras;
  const index = eras.findIndex((item) => item.folder === era().folder);
  const next = eras[index + dir];
  if (!next) return;
  state.eraFolder = next.folder;
  $("era").value = next.folder;
  refreshOldTiles();
  saveStore();
}

function setupMaps() {
  const common = {
    zoomControl: false,
    attributionControl: false,
    zoomSnap: 1,
    minZoom: 5,
    maxZoom: 18,
  };
  const ds = dataset();
  leftMap = L.map("map-old", common).setView([ds.lat, ds.lng], ds.zoom);
  rightMap = L.map("map-now", common).setView([ds.lat, ds.lng], ds.zoom);
  L.control.zoom({ position: "topright" }).addTo(leftMap);
  L.control.zoom({ position: "topright" }).addTo(rightMap);
  leftMap.on("move", () => follow(leftMap, rightMap));
  rightMap.on("move", () => follow(rightMap, leftMap));
  leftMap.on("moveend zoomend", () => {
    renderDecos();
    updateResHint();
  });
  bindCursor(leftMap, $("cursor-old"));
  bindCursor(rightMap, $("cursor-now"));
  mirrorCursor(leftMap, rightMap, $("cursor-now"));
  mirrorCursor(rightMap, leftMap, $("cursor-old"));
  for (const map of [leftMap, rightMap]) {
    map.on("click", (event) => {
      if (!state.pinArmed) return;
      setPin(event.latlng);
    });
  }
  refreshNowTiles();
  refreshOldTiles();
  renderDecos();
  requestAnimationFrame(() => {
    leftMap.invalidateSize();
    rightMap.invalidateSize();
    renderDecos();
  });
  window.addEventListener("resize", () => {
    leftMap.invalidateSize();
    rightMap.invalidateSize();
    renderDecos();
  });
}

function main() {
  if (location.protocol === "file:") {
    toast("start.bat から開いてください。JPEG保存と地名検索には、その起動が必要です。");
  }
  const local = location.hostname === "localhost" || location.hostname === "127.0.0.1" || location.protocol === "file:";
  if (!local) $("launch-note").hidden = true;
  loadStore();
  fillDatasets();
  fillEras();
  fillGsi();
  applyControlValues();
  setupMaps();
  bindUi();
  renderLayerList();
}

main();
