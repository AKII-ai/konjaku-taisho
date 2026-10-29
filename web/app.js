/* 今昔対照 — 旧版地形図と地理院地図の連動ビューア */

const GSI_MAPS = [
  { id: "std", name: "標準地図", ext: "png", max: 18 },
  { id: "pale", name: "淡色地図", ext: "png", max: 18 },
  { id: "blank", name: "白地図", ext: "png", max: 14 },
  { id: "seamlessphoto", name: "写真", ext: "jpg", max: 18 },
  { id: "relief", name: "色別標高図", ext: "png", max: 15 },
  { id: "hillshademap", name: "陰影起伏図", ext: "png", max: 16 },
];

const AIR_PHOTOS = [
  {
    id: "seamlessphoto",
    name: "全国最新",
    file: "全国最新",
    ext: "jpg",
    minZ: 14,
    maxZ: 18,
    group: "最新",
    note: "各地域のいちばん新しい空中写真です。ズーム14から表示されます。",
  },
];
for (let year = 2026; year >= 2007; year -= 1) {
  AIR_PHOTOS.push({
    id: `nendophoto${year}`,
    name: `${year}年度`,
    file: `${year}年度`,
    ext: "png",
    minZ: 14,
    maxZ: 18,
    group: "年度別（2007年以降）",
    note: "その年度に撮影された範囲だけ出ます。ズーム14から表示されます。",
  });
}
AIR_PHOTOS.push(
  { id: "gazo4", name: "1987-1990年", file: "1987-1990年", ext: "jpg", minZ: 10, maxZ: 17, group: "それ以前", note: "ズーム10から表示されます。" },
  { id: "gazo3", name: "1984-1986年", file: "1984-1986年", ext: "jpg", minZ: 10, maxZ: 17, group: "それ以前", note: "ズーム10から表示されます。" },
  { id: "gazo2", name: "1979-1983年", file: "1979-1983年", ext: "jpg", minZ: 10, maxZ: 17, group: "それ以前", note: "ズーム10から表示されます。" },
  { id: "gazo1", name: "1974-1978年", file: "1974-1978年", ext: "jpg", minZ: 10, maxZ: 17, group: "それ以前", note: "ズーム10から表示されます。" },
  { id: "ort_old10", name: "1961-1969年", file: "1961-1969年", ext: "png", minZ: 10, maxZ: 17, group: "それ以前", note: "ズーム10から表示されます。" },
  { id: "ort_USA10", name: "1945-1950年", file: "1945-1950年", ext: "png", minZ: 10, maxZ: 17, group: "それ以前", note: "ズーム10から表示されます。" },
  { id: "ort_riku10", name: "1936-1942年頃", file: "1936-1942年頃", ext: "png", minZ: 13, maxZ: 18, group: "それ以前", note: "東京23区と大阪周辺です。ズーム13から表示されます。" },
  { id: "ort_1928", name: "1928年頃", file: "1928年頃", ext: "png", minZ: 13, maxZ: 18, group: "それ以前", note: "大阪市域です。ズーム13から表示されます。" }
);

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
  airId: "seamlessphoto",
  airRatio: 1.5,
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
  panelWidth: 332,
  panelCollapsed: false,
  showOld: true,
  showAir: true,
  nowBase: "gsi",
};

let seq = 1;
let syncing = false;
let leftMap;
let rightMap;
let airMap;
let oldTiles;
let nowTiles;
let overlayTiles;
let airTiles;
let pinLeft;
let pinRight;
let pinAir;

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

function airPhoto() {
  return AIR_PHOTOS.find((item) => item.id === state.airId) || AIR_PHOTOS[0];
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

let wipeGoogleKey = false;

function loadStore() {
  try {
    const saved = JSON.parse(localStorage.getItem(STORE_KEY) || "null");
    if (!saved) return;
    wipeGoogleKey = typeof saved.googleKey === "string" && saved.googleKey.length > 0;
    Object.assign(state, {
      folder: saved.folder || state.folder,
      eraFolder: saved.eraFolder || state.eraFolder,
      gsi: saved.gsi || state.gsi,
      airId: saved.airId || state.airId,
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
      panelWidth: Number.isFinite(saved.panelWidth) ? saved.panelWidth : 332,
      panelCollapsed: !!saved.panelCollapsed,
      showOld: saved.showOld !== false,
      showAir: saved.showAir !== false,
      nowBase: saved.nowBase === "osm" || saved.nowBase === "google" ? "osm" : "gsi",
    });
  } catch {
    /* 保存データが壊れていても起動する */
  }
  if (!DATASETS.some((d) => d.folder === state.folder)) state.folder = DATASETS[0].folder;
  if (!dataset().eras.some((e) => e.folder === state.eraFolder)) state.eraFolder = dataset().eras[0].folder;
  if (!GSI_MAPS.some((g) => g.id === state.gsi)) state.gsi = "std";
  if (!AIR_PHOTOS.some((item) => item.id === state.airId)) state.airId = "seamlessphoto";
  state.panelWidth = Math.min(460, Math.max(200, Math.round(state.panelWidth)));
}

function saveStore() {
  const styles = { ...state.styles };
  for (const layer of state.layers) {
    if (layer.drawn) {
      delete styles[layer.name];
      continue;
    }
    styles[layer.name] = {
      color: layer.color,
      dash: layer.dash,
      width: layer.width,
      opacity: layer.opacity,
      visible: layer.visible,
    };
  }
  state.styles = styles;
  localStorage.setItem(
    STORE_KEY,
    JSON.stringify({
      folder: state.folder,
      eraFolder: state.eraFolder,
      gsi: state.gsi,
      airId: state.airId,
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
      panelWidth: state.panelWidth,
      panelCollapsed: state.panelCollapsed,
      showOld: state.showOld,
      showAir: state.showAir,
      nowBase: state.nowBase,
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

function usingOsm() {
  return state.nowBase === "osm";
}

function applyNowBaseUi() {
  for (const button of $("now-base").querySelectorAll("button")) {
    button.classList.toggle("is-on", button.dataset.base === state.nowBase);
  }
  $("gsi-field").hidden = usingOsm();
  $("osm-attr").hidden = !usingOsm();
  for (const button of document.querySelectorAll("[data-target='gsi']")) {
    button.textContent = usingOsm() ? "OpenStreetMap" : "地理院地図";
  }
}

function refreshNowTiles() {
  const spec = gsiSpec();
  if (nowTiles) {
    rightMap.removeLayer(nowTiles);
    nowTiles = null;
  }
  if (usingOsm()) {
    nowTiles = L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
      maxZoom: 18,
      maxNativeZoom: 19,
      errorTileUrl: TRANSPARENT,
    }).addTo(rightMap);
    $("now-kind").textContent = "OpenStreetMap";
    $("right-title").textContent = "OpenStreetMap";
  } else {
    nowTiles = L.tileLayer(gsiTemplate(spec), {
      crossOrigin: "anonymous",
      detectRetina: false,
      maxZoom: 18,
      maxNativeZoom: spec.max,
      errorTileUrl: TRANSPARENT,
    }).addTo(rightMap);
    $("now-kind").textContent = spec.id === "std" ? "標準地図" : "地理院地図";
    $("right-title").textContent = spec.name;
  }
  if (overlayTiles) overlayTiles.bringToFront();
  stackLayers();
  applyNowBaseUi();
}

function refreshAirTiles() {
  const photo = airPhoto();
  if (airTiles) airMap.removeLayer(airTiles);
  airTiles = L.tileLayer(`https://cyberjapandata.gsi.go.jp/xyz/${photo.id}/{z}/{x}/{y}.${photo.ext}`, {
    crossOrigin: "anonymous",
    detectRetina: false,
    minZoom: photo.minZ,
    maxZoom: 18,
    maxNativeZoom: photo.maxZ,
    errorTileUrl: TRANSPARENT,
  }).addTo(airMap);
  $("air-title").textContent = photo.name;
  updateAirHint();
  updateAirButtons();
}

function updateAirHint() {
  const photo = airPhoto();
  const zoom = airMap ? airMap.getZoom() : 0;
  const zoomNote = zoom && zoom < photo.minZ ? `いまのズーム${zoom}では出ません。` : "";
  $("air-hint").textContent = `${photo.note}${zoomNote}撮影のない場所は空白になります。`;
}

function updateAirButtons() {
  const index = AIR_PHOTOS.findIndex((item) => item.id === airPhoto().id);
  $("air-older").disabled = index >= AIR_PHOTOS.length - 1;
  $("air-newer").disabled = index <= 0;
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

function follow(from) {
  if (syncing) return;
  syncing = true;
  const center = from.getCenter();
  const zoom = from.getZoom();
  for (const map of [leftMap, rightMap, airMap]) {
    if (map !== from) map.setView(center, zoom, { animate: false });
  }
  syncing = false;
}

function bindCursor(from, el) {
  from.on("mousemove", (event) => {
    const point = event.containerPoint;
    el.hidden = false;
    el.style.transform = `translate(${point.x}px, ${point.y}px)`;
    const ll = event.latlng;
    $("coord-readout").textContent =
      `${ll.lat.toFixed(5)}, ${ll.lng.toFixed(5)}　ズーム ${formatZoom(from.getZoom())}`;
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

function fillAir() {
  const select = $("air");
  let group = "";
  let optgroup = null;
  for (const item of AIR_PHOTOS) {
    if (item.group !== group) {
      group = item.group;
      optgroup = document.createElement("optgroup");
      optgroup.label = group;
      select.append(optgroup);
    }
    const option = document.createElement("option");
    option.value = item.id;
    option.textContent = item.name;
    optgroup.append(option);
  }
  select.value = airPhoto().id;
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
  applyNowBaseUi();
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
  const anchor = state.showOld ? leftMap : rightMap;
  const spec = scaleSpec(anchor);
  const readout = $("scale-readout");
  const mapWidth = anchor.getSize().x || 1;
  readout.textContent = `1目盛り ${formatDist(spec.pitch)}　全長 ${formatDist(spec.total)}　画面上 ${Math.round(spec.totalPx)} px`;
  readout.classList.toggle("warn", state.showScale && spec.totalPx > mapWidth * 0.42);

  for (const [el, enabled] of [
    [$("deco-old"), state.showOld],
    [$("deco-now"), state.showOnRight || !state.showOld],
    [$("deco-air"), state.showOnRight && state.showAir],
  ]) {
    el.replaceChildren();
    if (!enabled) continue;
    if (state.showCompass) el.append(compassSvg(Math.round(72 * state.compassSize)));
    if (state.showScale) el.append(scalePlate(spec));
  }
  $("cross-old").classList.toggle("is-off", !state.showCenter);
  $("cross-now").classList.toggle("is-off", !state.showCenter);
  $("cross-air").classList.toggle("is-off", !state.showCenter);
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
  layer.groupAir.clearLayers();
  const style = lineStyle(layer);
  const marker = pointStyle(layer);
  const halo = isLightColor(layer.color)
    ? { ...style, color: "#241c16", weight: layer.width + 2 }
    : null;
  const groups = [layer.groupOld, layer.groupNow, layer.groupAir];
  for (const line of layer.lines) {
    for (const group of groups) {
      if (halo) L.polyline(line, halo).addTo(group);
      L.polyline(line, style).addTo(group);
    }
  }
  if (halo) {
    marker.color = "#241c16";
    marker.weight = 2;
  }
  for (const point of layer.points) {
    for (const group of groups) L.circleMarker(point, marker).addTo(group);
  }
  const targets = [
    [layer.groupOld, leftMap],
    [layer.groupNow, rightMap],
    [layer.groupAir, airMap],
  ];
  for (const [group, map] of targets) {
    if (layer.visible) group.addTo(map);
    else group.remove();
  }
  stackLayers();
}

function stackLayers() {
  for (let i = state.layers.length - 1; i >= 0; i -= 1) {
    const layer = state.layers[i];
    if (!layer.visible) continue;
    layer.groupOld.bringToFront();
    layer.groupNow.bringToFront();
    layer.groupAir.bringToFront();
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
    remove.className = "layer-remove";
    remove.textContent = "削除";
    remove.setAttribute("aria-label", `${layer.name}を削除`);
    remove.addEventListener("click", () => removeLayer(layer));
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
    const kind = document.createElement("label");
    kind.className = "layer-kind";
    const kindName = document.createElement("span");
    kindName.textContent = "線種";
    const dash = document.createElement("select");
    dash.setAttribute("aria-label", `${layer.name}の線種`);
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
    kind.append(kindName, dash);
    const thickness = document.createElement("label");
    thickness.className = "layer-width";
    const thicknessName = document.createElement("span");
    thicknessName.textContent = "太さ";
    const applyWidth = (value) => {
      layer.width = clamp(Number(value) || 2, 1, 16);
      range.value = String(layer.width);
      width.value = String(layer.width);
      paintLayer(layer);
      saveStore();
    };
    const range = document.createElement("input");
    range.type = "range";
    range.min = "1";
    range.max = "16";
    range.value = String(layer.width);
    range.setAttribute("aria-label", `${layer.name}の太さ`);
    const width = document.createElement("input");
    width.type = "number";
    width.min = "1";
    width.max = "16";
    width.value = String(layer.width);
    width.title = "太さ";
    width.setAttribute("aria-label", `${layer.name}の太さの数値`);
    range.addEventListener("input", () => applyWidth(range.value));
    width.addEventListener("change", () => applyWidth(width.value));
    thickness.append(thicknessName, range, width);
    controls.append(kind, thickness);
    item.append(head, colors, controls);
    list.append(item);
  });
  $("fit-kml").disabled = state.layers.every((layer) => !layer.visible);
  const exportKml = $("export-kml");
  if (exportKml) exportKml.disabled = !state.layers.some((layer) => layer.drawn);
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
    groupAir: L.featureGroup(),
  };
  seq += 1;
  state.layers.push(layer);
  paintLayer(layer);
  renderLayerList();
  saveStore();
}

const draw = {
  mode: null,
  vertices: [],
  previews: [],
  pointLayer: null,
};

function uniqueDrawName(base) {
  const names = new Set(state.layers.map((layer) => layer.name));
  if (!names.has(base)) return base;
  let n = 2;
  while (names.has(`${base} ${n}`)) n += 1;
  return `${base} ${n}`;
}

function removeLayer(layer) {
  layer.groupOld.remove();
  layer.groupNow.remove();
  layer.groupAir.remove();
  if (draw.pointLayer === layer) draw.pointLayer = null;
  state.layers = state.layers.filter((entry) => entry !== layer);
  if (layer.drawn) delete state.styles[layer.name];
  renderLayerList();
  saveStore();
}

function addDrawnLayer(name, parsed) {
  delete state.styles[name];
  addKmlLayer(name, parsed);
  const layer = state.layers[state.layers.length - 1];
  layer.drawn = true;
  renderLayerList();
  saveStore();
  return layer;
}

function clearDrawPreview() {
  for (const item of draw.previews) item.remove();
  draw.previews = [];
}

function updateDrawPreview() {
  clearDrawPreview();
  if (!draw.vertices.length || !leftMap) return;
  for (const map of [leftMap, rightMap, airMap]) {
    if (draw.vertices.length >= 2) {
      draw.previews.push(L.polyline(draw.vertices, {
        color: "#c4452d",
        weight: 3,
        opacity: 0.95,
        dashArray: "7 4",
        interactive: false,
      }).addTo(map));
    }
    for (const vertex of draw.vertices) {
      draw.previews.push(L.circleMarker(vertex, {
        radius: 4,
        color: "#c4452d",
        weight: 2,
        fillColor: "#fffaf3",
        fillOpacity: 1,
        interactive: false,
      }).addTo(map));
    }
  }
}

function updateDrawStatus() {
  const status = $("draw-status");
  const finish = $("draw-finish");
  const undo = $("draw-undo");
  if (draw.mode === "point") {
    status.textContent = "地図をクリックすると点が追加されます";
    finish.hidden = true;
    undo.hidden = true;
    return;
  }
  finish.hidden = false;
  undo.hidden = false;
  status.textContent = draw.vertices.length
    ? `頂点 ${draw.vertices.length}　ダブルクリックか「線を確定」で終了`
    : "地図をクリックして頂点を追加";
  finish.disabled = draw.vertices.length < 2;
  undo.disabled = draw.vertices.length === 0;
}

function setDrawMode(mode) {
  if (draw.mode === mode) mode = null;
  if (draw.mode === "line") {
    draw.vertices = [];
    clearDrawPreview();
  }
  if (mode !== "point") draw.pointLayer = null;
  draw.mode = mode;
  if (leftMap) {
    for (const map of [leftMap, rightMap, airMap]) {
      if (mode === "line") map.doubleClickZoom.disable();
      else map.doubleClickZoom.enable();
    }
  }
  document.querySelectorAll(".map-wrap").forEach((el) => el.classList.toggle("is-draw", !!mode));
  $("draw-line").classList.toggle("is-on", mode === "line");
  $("draw-point").classList.toggle("is-on", mode === "point");
  $("draw-bar").hidden = !mode;
  updateDrawStatus();
}

function finishDrawnLine() {
  while (draw.vertices.length >= 2) {
    const last = draw.vertices[draw.vertices.length - 1];
    const prev = draw.vertices[draw.vertices.length - 2];
    const same = Math.abs(last[0] - prev[0]) < 1e-7 && Math.abs(last[1] - prev[1]) < 1e-7;
    if (!same) break;
    draw.vertices.pop();
  }
  if (draw.vertices.length >= 2) {
    addDrawnLayer(uniqueDrawName("描いた線"), { lines: [draw.vertices.slice()], points: [] });
    toast("線をKMLの一覧に追加しました");
  }
  draw.vertices = [];
  clearDrawPreview();
  updateDrawStatus();
}

function addDrawnPoint(latlng) {
  const point = [latlng.lat, latlng.lng];
  if (!draw.pointLayer || !state.layers.includes(draw.pointLayer)) {
    draw.pointLayer = addDrawnLayer(uniqueDrawName("描いた点"), { lines: [], points: [point] });
    return;
  }
  draw.pointLayer.points.push(point);
  paintLayer(draw.pointLayer);
  renderLayerList();
}

function handleMapClick(event) {
  if (draw.mode === "point") {
    addDrawnPoint(event.latlng);
    return;
  }
  if (draw.mode === "line") {
    draw.vertices.push([event.latlng.lat, event.latlng.lng]);
    updateDrawPreview();
    updateDrawStatus();
    return;
  }
  if (!state.pinArmed) return;
  setPin(event.latlng);
}

function kmlColor(hex, opacity) {
  const raw = String(hex || "#c4452d").replace("#", "");
  const safe = raw.length === 6 ? raw : "c4452d";
  const alpha = Math.round(clamp(Number(opacity) || 1, 0, 1) * 255).toString(16).padStart(2, "0");
  return `${alpha}${safe.slice(4, 6)}${safe.slice(2, 4)}${safe.slice(0, 2)}`;
}

function xmlEscape(text) {
  return String(text).replace(/[&<>"']/g, (ch) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&apos;",
  }[ch]));
}

function buildKml(layers) {
  const styles = [];
  const marks = [];
  for (const layer of layers) {
    const styleId = `draw-${layer.id}`;
    styles.push(
      `<Style id="${styleId}"><LineStyle><color>${kmlColor(layer.color, layer.opacity)}</color><width>${layer.width}</width></LineStyle></Style>`
    );
    const parts = [];
    for (const line of layer.lines) {
      const coords = line.map(([lat, lng]) => `${lng},${lat},0`).join(" ");
      parts.push(`<LineString><tessellate>1</tessellate><coordinates>${coords}</coordinates></LineString>`);
    }
    for (const point of layer.points) {
      parts.push(`<Point><coordinates>${point[1]},${point[0]},0</coordinates></Point>`);
    }
    if (!parts.length) continue;
    const geometry = parts.length === 1 ? parts[0] : `<MultiGeometry>${parts.join("")}</MultiGeometry>`;
    marks.push(
      `<Placemark><name>${xmlEscape(layer.name)}</name><styleUrl>#${styleId}</styleUrl>${geometry}</Placemark>`
    );
  }
  return `<?xml version="1.0" encoding="UTF-8"?>\n<kml xmlns="http://www.opengis.net/kml/2.2"><Document><name>今昔対照</name>${styles.join("")}${marks.join("")}</Document></kml>\n`;
}

function exportDrawnKml() {
  const layers = state.layers.filter((layer) => layer.drawn && (layer.lines.length || layer.points.length));
  if (!layers.length) {
    toast("書き出す線や点がありません");
    return;
  }
  const blob = new Blob([buildKml(layers)], { type: "application/vnd.google-earth.kml+xml" });
  const link = document.createElement("a");
  link.href = URL.createObjectURL(blob);
  link.download = "描いた図.kml";
  link.click();
  setTimeout(() => URL.revokeObjectURL(link.href), 4000);
  toast("描いた図.kml を書き出しました");
}

function bindDraw() {
  $("draw-line").addEventListener("click", () => setDrawMode("line"));
  $("draw-point").addEventListener("click", () => setDrawMode("point"));
  $("draw-cancel").addEventListener("click", () => setDrawMode(null));
  $("draw-undo").addEventListener("click", () => {
    draw.vertices.pop();
    updateDrawPreview();
    updateDrawStatus();
  });
  $("draw-finish").addEventListener("click", finishDrawnLine);
  $("export-kml").addEventListener("click", exportDrawnKml);
  updateDrawStatus();
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
  if (pinAir) airMap.removeLayer(pinAir);
  pinLeft = L.marker(latlng, { icon, interactive: false }).addTo(leftMap);
  pinRight = L.marker(latlng, { icon, interactive: false }).addTo(rightMap);
  pinAir = L.marker(latlng, { icon, interactive: false }).addTo(airMap);
  $("pin-readout").textContent = `ピン　${latlng.lat.toFixed(5)}, ${latlng.lng.toFixed(5)}`;
}

function clearPin() {
  state.pin = null;
  if (pinLeft) leftMap.removeLayer(pinLeft);
  if (pinRight) rightMap.removeLayer(pinRight);
  if (pinAir) airMap.removeLayer(pinAir);
  pinLeft = null;
  pinRight = null;
  pinAir = null;
  $("pin-readout").textContent = "ピンは3つの地図の同じ地点に出ます。";
}

function formatZoom(zoom) {
  const step = Math.round(zoom * 4) / 4;
  if (Number.isInteger(step)) return String(step);
  return step.toFixed(2).replace(/0$/, "");
}

function urlZoomFor(mapZoom, bias, minZ, maxZ) {
  const tileZoom = clamp(Math.round(mapZoom), minZ - bias, maxZ - bias);
  return tileZoom + bias;
}

function shownMap(map) {
  const size = map && map.getSize();
  if (size && size.x > 1 && size.y > 1) return map;
  return rightMap;
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

function drawAirCaption(ctx, photo, ratio) {
  const pad = 14 * ratio;
  ctx.save();
  ctx.fillStyle = "#000000";
  ctx.textBaseline = "top";
  ctx.font = `500 ${16 * ratio}px "Zen Kaku Gothic New", "Yu Gothic", sans-serif`;
  ctx.fillText(photo.name, pad, pad);
  ctx.font = `500 ${14 * ratio}px "Zen Kaku Gothic New", "Yu Gothic", sans-serif`;
  ctx.fillText("空中写真", pad, pad + 22 * ratio);
  ctx.restore();
}

function drawCredit(ctx, width, height, ratio, target) {
  const parts = [];
  if (target !== "gsi") parts.push("今昔マップ on the web（谷謙二）");
  if (target !== "old") parts.push(usingOsm() ? "© OpenStreetMap contributors" : "地理院タイル（国土地理院）");
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

function chosenFormat(id) {
  const button = $(id).querySelector("button.is-on");
  return button ? button.dataset.format : "jpeg";
}

function downloadBlob(blob, filename) {
  const link = document.createElement("a");
  link.href = URL.createObjectURL(blob);
  link.download = filename;
  link.click();
  setTimeout(() => URL.revokeObjectURL(link.href), 4000);
}

function canvasJpeg(canvas) {
  return new Promise((resolve, reject) => {
    canvas.toBlob(async (blob) => {
      if (!blob) {
        reject(new Error("画像を作れませんでした"));
        return;
      }
      resolve(new Uint8Array(await blob.arrayBuffer()));
    }, "image/jpeg", 0.92);
  });
}

function wideError() {
  const error = new Error("範囲が広すぎます。もう少し拡大してから保存してください");
  error.wide = true;
  return error;
}

function kmlShapes(map, ratio, ox) {
  const shapes = [];
  for (let i = state.layers.length - 1; i >= 0; i -= 1) {
    const layer = state.layers[i];
    if (!layer.visible) continue;
    const toPx = (latlng) => {
      const point = map.latLngToContainerPoint(latlng);
      return [ox + point.x * ratio, point.y * ratio];
    };
    for (const line of layer.lines) {
      if (line.length < 2) continue;
      const points = line.map(toPx);
      if (isLightColor(layer.color)) {
        shapes.push({ kind: "line", points, color: "#241c16", width: layer.width + 2, dash: layer.dash, name: `${layer.name} ふち` });
      }
      shapes.push({ kind: "line", points, color: layer.color, width: layer.width, dash: layer.dash, name: layer.name });
    }
    for (const point of layer.points) {
      const px = toPx(point);
      if (isLightColor(layer.color)) {
        shapes.push({ kind: "point", points: [px], color: "#241c16", width: layer.width + 2, name: `${layer.name} ふち` });
      }
      shapes.push({ kind: "point", points: [px], color: layer.color, width: layer.width, name: layer.name });
    }
  }
  return shapes;
}

function updateSavePreview() {
  const ds = dataset();
  const item = ds.eras.find((entry) => entry.folder === $("save-era").value) || era();
  const target = saveTarget();
  const excel = chosenFormat("save-format") === "xlsx";
  const gsiOnly = target === "gsi";
  $("save-era-field").hidden = gsiOnly || excel;
  $("save-caption-field").hidden = gsiOnly;
  if (excel && gsiOnly) {
    $("save-hint").textContent = usingOsm()
      ? "いまのOpenStreetMapを1枚のシートにします。KMLはオートシェイプになります。"
      : "いまの地理院地図を1枚のシートにします。KMLはオートシェイプになります。";
  } else if (excel) {
    $("save-hint").textContent = "表示している範囲で、この地域の年代ごとにシートを作ります。KMLはオートシェイプになります。";
  } else if (gsiOnly) {
    $("save-hint").textContent = usingOsm()
      ? "いま表示しているOpenStreetMapを保存します。"
      : "いま表示している地理院地図を保存します。ファイル名は地図の種類になります。";
  } else if (target === "pair" && usingOsm()) {
    $("save-hint").textContent = "今昔マップの年代を選びます。右にはOpenStreetMapが並びます。";
  } else {
    $("save-hint").textContent = "この地域で今昔マップにある年代から選びます。ファイル名はその年代になります。";
  }
  const base = gsiOnly
    ? (usingOsm() ? "OpenStreetMap" : `地理院地図_${gsiSpec().name}`)
    : excel ? `地形図_${ds.name}` : fileBase(ds, item);
  $("save-name").textContent = excel ? `${base}.xlsx` : `${base}.jpg`;
  const size = shownMap(target === "gsi" ? rightMap : leftMap).getSize();
  const ratio = state.saveRatio;
  const panes = target === "pair" ? 2 : 1;
  const w = Math.round(size.x * ratio) * panes;
  const h = Math.round(size.y * ratio);
  const label = ratio === 1 ? "低" : ratio === 2 ? "高" : "標準";
  const sheets = excel && !gsiOnly ? `　${ds.eras.length} シート` : "";
  $("save-pixels").textContent = `${label}　${excel ? "各シート " : ""}${w} × ${h} ピクセル${sheets}`;
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

async function renderTopoCanvas(item, includeVectors, onStep) {
  const ds = dataset();
  const ratio = state.saveRatio;
  const target = saveTarget();
  const pair = target === "pair";
  const drawOld = target !== "gsi";
  const drawNow = target !== "old";
  const oldView = shownMap(leftMap);
  const nowView = shownMap(rightMap);
  const size = (target === "gsi" ? nowView : oldView).getSize();
  const width = Math.round(size.x * ratio);
  const height = Math.round(size.y * ratio);
  const zoom = (target === "gsi" ? nowView : oldView).getZoom();
  const oldZoom = urlZoomFor(zoom, state.resBias, ds.minZ, ds.maxZ);
  const spec = gsiSpec();
  const nowZoom = clamp(Math.round(zoom), 0, usingOsm() ? 19 : spec.max);
  const oldTiles = drawOld ? tilesForView(oldView, oldZoom) : [];
  const nowTileList = drawNow ? tilesForView(nowView, nowZoom) : [];
  if (oldTiles.length > 160 || nowTileList.length > 160) throw wideError();
  const canvas = document.createElement("canvas");
  canvas.width = width * (pair ? 2 : 1);
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "#e6dcc8";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  const total = oldTiles.length + nowTileList.length;
  let finished = 0;
  const tick = () => {
    finished += 1;
    if (onStep) onStep(finished, total);
  };
  if (drawOld) {
    await drawTileSet(
      ctx,
      oldView,
      oldTiles,
      (tile) => `https://ktgis.net/kjmapw/kjtilemap/${ds.folder}/${item.folder}/${tile.z}/${tile.x}/${2 ** tile.z - 1 - tile.y}.png`,
      ratio,
      0,
      0,
      width,
      height,
      tick
    );
  }
  if (drawNow) {
    await drawTileSet(
      ctx,
      nowView,
      nowTileList,
      (tile) => usingOsm()
        ? `https://tile.openstreetmap.org/${tile.z}/${tile.x}/${tile.y}.png`
        : `https://cyberjapandata.gsi.go.jp/xyz/${spec.id}/${tile.z}/${tile.x}/${tile.y}.${spec.ext}`,
      ratio,
      pair ? width : 0,
      0,
      width,
      height,
      tick
    );
  }
  if (includeVectors) {
    if (drawOld) drawVectors(ctx, oldView, ratio, 0, 0);
    if (drawNow) drawVectors(ctx, nowView, ratio, pair ? width : 0, 0);
  }
  if (drawOld) drawFrameDecorations(ctx, oldView, ratio, 0, height);
  if (pair && state.showOnRight) drawFrameDecorations(ctx, nowView, ratio, width, height);
  if (target === "gsi") drawFrameDecorations(ctx, nowView, ratio, 0, height);
  if (drawOld && $("save-caption").checked) drawCaption(ctx, item, ratio);
  drawCredit(ctx, canvas.width, canvas.height, ratio, target);
  const panes = [];
  if (drawOld) panes.push({ map: oldView, ox: 0 });
  if (drawNow) panes.push({ map: nowView, ox: pair ? width : 0 });
  return { canvas, panes, ratio, width: canvas.width, height };
}

async function exportJpeg() {
  const ds = dataset();
  const item = ds.eras.find((entry) => entry.folder === $("save-era").value) || era();
  $("save-go").disabled = true;
  await document.fonts.ready;
  const rendered = await renderTopoCanvas(item, true, (done, total) => {
    $("save-progress").textContent = `地図画像を集めています　${done} / ${total}`;
  });
  const image = await canvasJpeg(rendered.canvas);
  const filename = saveTarget() === "gsi"
    ? (usingOsm() ? "OpenStreetMap.jpg" : `地理院地図_${gsiSpec().name}.jpg`)
    : `${fileBase(ds, item)}.jpg`;
  downloadBlob(new Blob([image], { type: "image/jpeg" }), filename);
  $("save-progress").textContent = `${filename} を保存しました`;
  $("save-go").disabled = false;
}

async function exportTopoExcel() {
  const ds = dataset();
  const target = saveTarget();
  const items = target === "gsi" ? [null] : ds.eras;
  const sheets = [];
  let skipped = 0;
  $("save-go").disabled = true;
  await document.fonts.ready;
  for (let index = 0; index < items.length; index += 1) {
    const item = items[index];
    const label = item ? fileBase(ds, item) : (usingOsm() ? "OpenStreetMap" : gsiSpec().name);
    $("save-progress").textContent = `${label} を集めています（${index + 1} / ${items.length}）`;
    try {
      const rendered = await renderTopoCanvas(item || era(), false, (done, total) => {
        $("save-progress").textContent = `${label}　${done} / ${total}（${index + 1} / ${items.length}）`;
      });
      const shapes = rendered.panes.flatMap((pane) => kmlShapes(pane.map, rendered.ratio, pane.ox));
      sheets.push({
        name: label,
        image: await canvasJpeg(rendered.canvas),
        width: rendered.width,
        height: rendered.height,
        shapes,
      });
    } catch (error) {
      if (!error.wide) throw error;
      skipped += 1;
      sheets.push({
        name: label,
        note: "範囲が広すぎるため、この年代の画像は入れていません。もう少し拡大してから保存してください。",
      });
    }
  }
  const filename = target === "gsi"
    ? (usingOsm() ? "OpenStreetMap.xlsx" : `地理院地図_${gsiSpec().name}.xlsx`)
    : `地形図_${ds.name}.xlsx`;
  const bytes = buildMapWorkbook(sheets);
  downloadBlob(
    new Blob([bytes], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }),
    filename
  );
  $("save-progress").textContent = skipped
    ? `${filename} を保存しました。範囲が広い ${skipped} 年代は画像なしです。`
    : `${filename} を保存しました`;
  $("save-go").disabled = false;
}

function updateAirSavePreview() {
  const photo = airPhoto();
  const excel = chosenFormat("air-format") === "xlsx";
  const ratio = state.airRatio;
  const size = shownMap(airMap).getSize();
  const w = Math.round(size.x * ratio);
  const h = Math.round(size.y * ratio);
  const label = ratio === 1 ? "低" : ratio === 2 ? "高" : "標準";
  $("air-hint-save").textContent = excel
    ? "表示している範囲で、空中写真の年代ごとにシートを作ります。KMLはオートシェイプになります。"
    : "いま表示している空中写真だけを保存します。地形図は入りません。ファイル名は年代です。";
  $("air-name").textContent = excel ? "空中写真.xlsx" : `空中写真_${photo.file}.jpg`;
  $("air-pixels").textContent = excel
    ? `${label}　各シート ${w} × ${h} ピクセル　${AIR_PHOTOS.length} シート`
    : `${label}　${w} × ${h} ピクセル`;
}

function openAirSave() {
  state.airRatio = state.airRatio || 1.5;
  for (const button of $("air-ratio").querySelectorAll("button")) {
    button.classList.toggle("is-on", Number(button.dataset.ratio) === state.airRatio);
  }
  $("air-progress").textContent = "";
  $("air-go").disabled = false;
  updateAirSavePreview();
  $("air-modal").hidden = false;
}

async function renderAirCanvas(photo, includeVectors, onStep) {
  const ratio = state.airRatio;
  const view = shownMap(airMap);
  const size = view.getSize();
  const width = Math.round(size.x * ratio);
  const height = Math.round(size.y * ratio);
  const tileZoom = clamp(Math.round(view.getZoom()), photo.minZ, photo.maxZ);
  const tiles = tilesForView(view, tileZoom);
  if (tiles.length > 160) throw wideError();
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "#d7d2cb";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  let finished = 0;
  await drawTileSet(
    ctx,
    view,
    tiles,
    (tile) => `https://cyberjapandata.gsi.go.jp/xyz/${photo.id}/${tile.z}/${tile.x}/${tile.y}.${photo.ext}`,
    ratio,
    0,
    0,
    width,
    height,
    () => {
      finished += 1;
      if (onStep) onStep(finished, tiles.length);
    }
  );
  if (includeVectors) drawVectors(ctx, view, ratio, 0, 0);
  drawFrameDecorations(ctx, view, ratio, 0, height);
  if ($("air-caption").checked) drawAirCaption(ctx, photo, ratio);
  drawCredit(ctx, canvas.width, canvas.height, ratio, "gsi");
  return { canvas, view, ratio, width, height };
}

async function exportAirJpeg() {
  const photo = airPhoto();
  $("air-go").disabled = true;
  await document.fonts.ready;
  const rendered = await renderAirCanvas(photo, true, (done, total) => {
    $("air-progress").textContent = `空中写真を集めています　${done} / ${total}`;
  });
  const image = await canvasJpeg(rendered.canvas);
  const filename = `空中写真_${photo.file}.jpg`;
  downloadBlob(new Blob([image], { type: "image/jpeg" }), filename);
  $("air-progress").textContent = `${filename} を保存しました`;
  $("air-go").disabled = false;
}

async function exportAirExcel() {
  const sheets = [];
  let skipped = 0;
  $("air-go").disabled = true;
  await document.fonts.ready;
  for (let index = 0; index < AIR_PHOTOS.length; index += 1) {
    const photo = AIR_PHOTOS[index];
    $("air-progress").textContent = `${photo.name} を集めています（${index + 1} / ${AIR_PHOTOS.length}）`;
    try {
      const rendered = await renderAirCanvas(photo, false, (done, total) => {
        $("air-progress").textContent = `${photo.name}　${done} / ${total}（${index + 1} / ${AIR_PHOTOS.length}）`;
      });
      sheets.push({
        name: photo.file,
        image: await canvasJpeg(rendered.canvas),
        width: rendered.width,
        height: rendered.height,
        shapes: kmlShapes(rendered.view, rendered.ratio, 0),
      });
    } catch (error) {
      if (!error.wide) throw error;
      skipped += 1;
      sheets.push({
        name: photo.file,
        note: "範囲が広すぎるため、この年代の画像は入れていません。もう少し拡大してから保存してください。",
      });
    }
  }
  const bytes = buildMapWorkbook(sheets);
  downloadBlob(
    new Blob([bytes], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }),
    "空中写真.xlsx"
  );
  $("air-progress").textContent = skipped
    ? `空中写真.xlsx を保存しました。範囲が広い ${skipped} 年代は画像なしです。`
    : "空中写真.xlsx を保存しました";
  $("air-go").disabled = false;
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
  $("now-base").addEventListener("click", (event) => {
    const button = event.target.closest("button");
    if (!button) return;
    state.nowBase = button.dataset.base === "osm" ? "osm" : "gsi";
    applyNowBaseUi();
    refreshNowTiles();
    saveStore();
    if (!$("save-modal").hidden) updateSavePreview();
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
  $("save-format").addEventListener("click", (event) => {
    const button = event.target.closest("button");
    if (!button) return;
    for (const item of $("save-format").querySelectorAll("button")) item.classList.toggle("is-on", item === button);
    updateSavePreview();
  });
  $("save-go").addEventListener("click", () => {
    const run = chosenFormat("save-format") === "xlsx" ? exportTopoExcel : exportJpeg;
    run().catch((error) => {
      $("save-go").disabled = false;
      $("save-progress").textContent = error.message || "保存に失敗しました";
    });
  });
  $("air").addEventListener("change", () => {
    state.airId = $("air").value;
    refreshAirTiles();
    saveStore();
  });
  $("air-older").addEventListener("click", () => stepAir(true));
  $("air-newer").addEventListener("click", () => stepAir(false));
  for (const button of document.querySelectorAll("[data-open-air]")) {
    button.addEventListener("click", openAirSave);
  }
  $("air-cancel").addEventListener("click", () => {
    $("air-modal").hidden = true;
  });
  $("air-modal").addEventListener("click", (event) => {
    if (event.target === $("air-modal")) $("air-modal").hidden = true;
  });
  $("air-ratio").addEventListener("click", (event) => {
    const button = event.target.closest("button");
    if (!button) return;
    state.airRatio = Number(button.dataset.ratio);
    for (const item of $("air-ratio").querySelectorAll("button")) {
      item.classList.toggle("is-on", item === button);
    }
    updateAirSavePreview();
  });
  $("air-format").addEventListener("click", (event) => {
    const button = event.target.closest("button");
    if (!button) return;
    for (const item of $("air-format").querySelectorAll("button")) item.classList.toggle("is-on", item === button);
    updateAirSavePreview();
  });
  $("air-go").addEventListener("click", () => {
    const run = chosenFormat("air-format") === "xlsx" ? exportAirExcel : exportAirJpeg;
    run().catch((error) => {
      $("air-go").disabled = false;
      $("air-progress").textContent = error.message || "保存に失敗しました";
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

function stepAir(older) {
  const index = AIR_PHOTOS.findIndex((item) => item.id === airPhoto().id);
  const next = AIR_PHOTOS[index + (older ? 1 : -1)];
  if (!next) return;
  state.airId = next.id;
  $("air").value = next.id;
  refreshAirTiles();
  saveStore();
}

function setupMaps() {
  const common = {
    zoomControl: false,
    attributionControl: false,
    zoomSnap: 0.25,
    zoomDelta: 0.5,
    wheelPxPerZoomLevel: 240,
    minZoom: 5,
    maxZoom: 18,
  };
  const ds = dataset();
  leftMap = L.map("map-old", common).setView([ds.lat, ds.lng], ds.zoom);
  rightMap = L.map("map-now", common).setView([ds.lat, ds.lng], ds.zoom);
  airMap = L.map("map-air", common).setView([ds.lat, ds.lng], ds.zoom);
  L.control.zoom({ position: "topright" }).addTo(leftMap);
  L.control.zoom({ position: "topright" }).addTo(rightMap);
  L.control.zoom({ position: "topright" }).addTo(airMap);
  leftMap.on("move", () => follow(leftMap));
  rightMap.on("move", () => follow(rightMap));
  airMap.on("move", () => follow(airMap));
  leftMap.on("moveend zoomend", () => {
    renderDecos();
    updateResHint();
    updateAirHint();
  });
  const cursors = [
    [leftMap, "cursor-old"],
    [rightMap, "cursor-now"],
    [airMap, "cursor-air"],
  ];
  for (const [map, id] of cursors) {
    bindCursor(map, $(id));
    for (const [other, otherId] of cursors) {
      if (other !== map) mirrorCursor(map, other, $(otherId));
    }
  }
  for (const map of [leftMap, rightMap, airMap]) {
    map.on("click", handleMapClick);
    map.on("dblclick", (event) => {
      if (draw.mode !== "line") return;
      L.DomEvent.stop(event);
      if (draw.vertices.length) draw.vertices.pop();
      finishDrawnLine();
    });
  }
  refreshNowTiles();
  refreshOldTiles();
  refreshAirTiles();
  renderDecos();
  requestAnimationFrame(() => {
    leftMap.invalidateSize();
    rightMap.invalidateSize();
    airMap.invalidateSize();
    renderDecos();
  });
  window.addEventListener("resize", () => {
    leftMap.invalidateSize();
    rightMap.invalidateSize();
    airMap.invalidateSize();
    renderDecos();
  });
}

function resizeMaps() {
  if (!leftMap) return;
  leftMap.invalidateSize();
  rightMap.invalidateSize();
  airMap.invalidateSize();
  renderDecos();
}

function applyPanel() {
  const workspace = document.querySelector(".workspace");
  const width = state.panelCollapsed ? 48 : state.panelWidth;
  workspace.style.setProperty("--panel-width", `${width}px`);
  workspace.classList.toggle("is-panel-collapsed", state.panelCollapsed);
  const toggle = $("panel-toggle");
  toggle.textContent = state.panelCollapsed ? "メニュー" : "しまう";
  toggle.title = state.panelCollapsed ? "メニューを開く" : "メニューをしまう";
  toggle.setAttribute("aria-expanded", state.panelCollapsed ? "false" : "true");
}

function bindPanel() {
  applyPanel();
  $("panel-toggle").addEventListener("click", () => {
    state.panelCollapsed = !state.panelCollapsed;
    applyPanel();
    saveStore();
    requestAnimationFrame(resizeMaps);
  });
  $("panel-narrow").addEventListener("click", () => {
    if (state.panelWidth <= 230) state.panelCollapsed = true;
    else state.panelWidth = Math.max(200, state.panelWidth - 56);
    applyPanel();
    saveStore();
    requestAnimationFrame(resizeMaps);
  });
  $("panel-wide").addEventListener("click", () => {
    if (state.panelCollapsed) state.panelCollapsed = false;
    else state.panelWidth = Math.min(460, state.panelWidth + 56);
    applyPanel();
    saveStore();
    requestAnimationFrame(resizeMaps);
  });
  const handle = $("panel-resize");
  handle.addEventListener("pointerdown", (event) => {
    if (state.panelCollapsed) return;
    event.preventDefault();
    handle.setPointerCapture(event.pointerId);
    handle.classList.add("is-dragging");
    const startX = event.clientX;
    const startW = state.panelWidth;
    const move = (ev) => {
      state.panelWidth = Math.min(460, Math.max(200, Math.round(startW + ev.clientX - startX)));
      applyPanel();
    };
    const end = () => {
      handle.removeEventListener("pointermove", move);
      handle.removeEventListener("pointerup", end);
      handle.removeEventListener("pointercancel", end);
      handle.classList.remove("is-dragging");
      saveStore();
      resizeMaps();
    };
    handle.addEventListener("pointermove", move);
    handle.addEventListener("pointerup", end);
    handle.addEventListener("pointercancel", end);
  });
}

function applyMapPanes() {
  $("wrap-old").classList.toggle("is-closed", !state.showOld);
  $("wrap-air").classList.toggle("is-closed", !state.showAir);
  $("switch-old").classList.toggle("is-closed", !state.showOld);
  $("switch-air").classList.toggle("is-closed", !state.showAir);
  $("reopen-old").hidden = state.showOld;
  $("reopen-air").hidden = state.showAir;
  $("toggle-old").textContent = state.showOld ? "旧版地形図を閉じる" : "旧版地形図を開く";
  $("toggle-air").textContent = state.showAir ? "空中写真を閉じる" : "空中写真を開く";
  if (rightMap && leftMap && airMap) {
    const center = rightMap.getCenter();
    const zoom = rightMap.getZoom();
    syncing = true;
    if (state.showOld) leftMap.setView(center, zoom, { animate: false });
    if (state.showAir) airMap.setView(center, zoom, { animate: false });
    syncing = false;
  }
  requestAnimationFrame(resizeMaps);
}

function bindMapPanes() {
  const closePane = (key) => {
    state[key] = false;
    applyMapPanes();
    saveStore();
  };
  const openPane = (key) => {
    state[key] = true;
    applyMapPanes();
    saveStore();
  };
  $("toggle-old").addEventListener("click", () => (state.showOld ? closePane("showOld") : openPane("showOld")));
  $("toggle-air").addEventListener("click", () => (state.showAir ? closePane("showAir") : openPane("showAir")));
  $("close-old").addEventListener("click", () => closePane("showOld"));
  $("close-air").addEventListener("click", () => closePane("showAir"));
  $("reopen-old").addEventListener("click", () => openPane("showOld"));
  $("reopen-air").addEventListener("click", () => openPane("showAir"));
}

function main() {
  if (location.protocol === "file:") {
    toast("start.bat から開いてください。JPEG保存と地名検索には、その起動が必要です。");
  }
  const local = location.hostname === "localhost" || location.hostname === "127.0.0.1" || location.protocol === "file:";
  if (!local) $("launch-note").hidden = true;
  loadStore();
  if (wipeGoogleKey) saveStore();
  applyPanel();
  applyMapPanes();
  fillDatasets();
  fillEras();
  fillGsi();
  fillAir();
  applyControlValues();
  setupMaps();
  bindDraw();
  bindPanel();
  bindMapPanes();
  bindUi();
  renderLayerList();
}

main();
