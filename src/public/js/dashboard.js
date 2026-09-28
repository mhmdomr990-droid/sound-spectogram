(function () {
  var token = localStorage.getItem("token");
  if (!token) {
    window.location.href = "/login";
    return;
  }

  var user = null;
  try {
    var rawUser = localStorage.getItem("user");
    user = rawUser ? JSON.parse(rawUser) : null;
  } catch (_error) {
    user = null;
  }

  if (!user) {
    localStorage.removeItem("token");
    window.location.href = "/login";
    return;
  }

  if (window.L) {
    delete L.Icon.Default.prototype._getIconUrl;
    L.Icon.Default.mergeOptions({
      iconRetinaUrl: "https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-icon-2x.png",
      iconUrl: "https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-icon.png",
      shadowUrl: "https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-shadow.png"
    });
  }

  var selectedDeviceId = null;
  var selectedDeviceName = "";
  var selectedDeviceKey = "";
  var selectedDeviceMinFrequency = null;
  var selectedDeviceMaxFrequency = null;
  var currentPackets = [];
  var activeTimeStepMs = 1000;
  var activeRangeMode = "latest1h";
  var activeFromIso = null;
  var activeToIso = null;
  var viewportFromMs = null;
  var viewportToMs = null;
  var followLatest24 = true;
  var liveFollowEnabled = true;
  var liveManualBrowseActive = false;
  var isHistoryLoading = false;
  var historyLoadSequence = 0;
  var pendingLivePackets = [];
  var currentPacketKeys = new Set();
  var isPanning = false;
  var isDraggingMarker = false;
  var draggedMarkerIndex = -1;
  var markerDragStartClientX = 0;
  var markerDragHasMoved = false;
  var skipMarkerRemovalClick = false;
  var panHasMoved = false;
  var PROBE_AUTO_HIDE_MS = 4000;
  var probeAutoHideTimerId = null;

  function scheduleProbeAutoHide() {
    if (probeAutoHideTimerId !== null) {
      clearTimeout(probeAutoHideTimerId);
    }
    probeAutoHideTimerId = setTimeout(function () {
      probeAutoHideTimerId = null;
      probeTooltipEl.classList.add("hidden");
    }, PROBE_AUTO_HIDE_MS);
  }
  var suppressNextProbeClick = false;
  var pressStartedAtMs = 0;
  var PAN_MOVE_THRESHOLD_PX = 5;
  var CLICK_MAX_DURATION_MS = 400;
  var panStartClientX = 0;
  var panStartFromMs = 0;
  var panStartToMs = 0;
  var renderRafId = null;
  var pendingRenderOptions = null;
  var interactionEndTimer = null;
  var lastRenderMeta = null;
  var devicesCache = [];
  var devicesStatusCache = [];
  var liveDeviceStatusMap = {};
  var deviceStatusStorageKey = "device-live-status-cache";
  var editingUserId = null;
  var editingDeviceId = null;
  var editingDeviceForLocation = null;
  var deviceLocationMap = null;
  var deviceLocationMarker = null;
  var devicesOverviewMapInstance = null;
  var devicesOverviewLayerGroup = null;
  var hasFitInitialOverviewBounds = false;
  var lastKnownDeviceBounds = [];
  var lastPersistenceWarningAt = 0;
  var liveTraceEl = null;
  var expectingLiveRender = false;
  var timeMarkers = [];
  var renderedTimeMarkerHits = [];
  var liveTraceCounters = {
    received: 0,
    matched: 0,
    buffered: 0,
    inserted: 0,
    duplicates: 0,
    rendered: 0,
    droppedByDevice: 0,
    droppedByTime: 0,
    mergedFromBuffer: 0,
    lastStage: "init",
    lastPacketIso: "-",
    lastRenderIso: "-",
    lastIssue: ""
  };
  var DEFAULT_LIVE_WINDOW_MS = 30 * 60 * 1000;
  var ONE_HOUR_WINDOW_MS = 60 * 60 * 1000;
  var currentLiveWindowMs = DEFAULT_LIVE_WINDOW_MS;
  var LIVE_WINDOW_LABEL = "آخر 30 دقيقة";
  var MAX_LOAD_WINDOW_MS = 24 * 60 * 60 * 1000;
  var MAX_PACKETS_IN_MEMORY = 12000;
  var MULTI_VIEW_PANEL_BUFFER_SIZE = 5;
  var multiViewOpen = false;
  var multiViewPanels = {};
  var DEFAULT_LOCATION_LAT = 35.5;
  var DEFAULT_LOCATION_LNG = 35.8;

  var topNav = document.getElementById("topNav");
  var dashboardLayoutEl = document.getElementById("dashboardLayout");
  var tabButtons = document.querySelectorAll(".tab-btn");
  var historyPanel = document.getElementById("historyPanel");
  var mapPanel = document.getElementById("mapPanel");
  var statisticsPanel = document.getElementById("statisticsPanel");
  var usersPanel = document.getElementById("usersPanel");
  var devicesPanel = document.getElementById("devicesPanel");
  var globalMessageEl = document.getElementById("globalMessage");
  var userBadgeEl = document.getElementById("userBadge");
  var socketStatusBadgeEl = document.getElementById("socketStatusBadge");
  var rightPanel = document.getElementById("rightPanel");
  var toggleRightPanelBtn = document.getElementById("toggleRightPanelBtn");

  var deviceListEl = document.getElementById("deviceList");
  var multiViewBtn = document.getElementById("multiViewBtn");
  var multiViewPickerModal = document.getElementById("multiViewPickerModal");
  var multiViewDeviceOptions = document.getElementById("multiViewDeviceOptions");
  var multiViewContinueBtn = document.getElementById("multiViewContinueBtn");
  var multiViewCancelBtn = document.getElementById("multiViewCancelBtn");
  var multiViewOverlay = document.getElementById("multiViewOverlay");
  var multiViewGrid = document.getElementById("multiViewGrid");
  var selectedDeviceTitleEl = document.getElementById("selectedDeviceTitle");
  var historyInfoEl = document.getElementById("historyInfo");
  var historyTableBody = document.getElementById("historyTableBody");
  var sideDeviceInfoEl = document.getElementById("sideDeviceInfo");
  var processingStatusEl = document.getElementById("processingStatus");
  var canvas = document.getElementById("spectrogramCanvas");
  var spectrogramLoaderEl = document.getElementById("spectrogramLoader");
  var legendCanvas = document.getElementById("spectrogramLegend");
  var gapTooltipEl = document.getElementById("gapTooltip");
  var probeTooltipEl = document.getElementById("probeTooltip");
  var historyRangeForm = document.getElementById("historyRangeForm");
  var latest24Btn = document.getElementById("latest24Btn");
  var latest5hBtn = document.getElementById("latest5hBtn");
  var latest24hBtn = document.getElementById("latest24hBtn");
  var latestPacketBtn = document.getElementById("latestPacketBtn");
  var resetViewBtn = document.getElementById("resetViewBtn");
  var clearMarkersBtn = document.getElementById("clearMarkersBtn");
  var panLeftBtn = document.getElementById("panLeftBtn");
  var panRightBtn = document.getElementById("panRightBtn");

  async function loadDevicesWithStatus() {
    if (!isAdmin) {
      devicesStatusCache = [];
      renderDevicesViews([]);
      return;
    }

    try {
      devicesStatusCache = await apiRequest("/api/devices/with-status");
    } catch (error) {
      devicesStatusCache = [];
      setGlobalMessage(error instanceof Error ? error.message : "تعذر تحميل حالة الأجهزة", true);
    }

    liveDeviceStatusMap = readStoredLiveDeviceStatus();
    var seededFromSnapshot = seedLiveDeviceStatusFromSnapshot(devicesStatusCache);
    if (seededFromSnapshot) {
      saveStoredLiveDeviceStatus(liveDeviceStatusMap);
    }
    renderDevicesViews(devicesStatusCache);
  }

  function createTerrainTileLayer() {
    return L.tileLayer("https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png", {
      maxZoom: 17,
      attribution: "Map data: © OpenStreetMap contributors, SRTM | Map style: © OpenTopoMap (CC-BY-SA)"
    });
  }

  function createSatelliteTileLayer() {
    var imagery = L.tileLayer(
      "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
      { maxZoom: 19, attribution: "Tiles © Esri" }
    );
    var labels = L.tileLayer(
      "https://{s}.basemaps.cartocdn.com/dark_only_labels/{z}/{x}/{y}.png?key=" + encodeURIComponent(window.cartoApiKey || ""),
      {
        maxZoom: 20,
        subdomains: "abcd",
        attribution: "Labels © CARTO, © OpenStreetMap contributors"
      }
    );
    return L.layerGroup([imagery, labels]);
  }

  function normalizeDeviceStatusKey(value) {
    return String(value || "").trim().toLowerCase();
  }

  function getDeviceStatusCandidates(device) {
    if (!device || typeof device !== "object") {
      return [];
    }

    var candidates = [];
    if (device.device_id) {
      candidates.push(device.device_id);
    }
    if (device.externalDeviceId) {
      candidates.push(device.externalDeviceId);
    }
    if (device.name) {
      candidates.push(device.name);
    }
    if (device.id) {
      candidates.push(String(device.id));
    }
    if (device.key) {
      candidates.push(device.key);
    }
    if (device.deviceKey) {
      candidates.push(device.deviceKey);
    }
    if (device.identifier) {
      candidates.push(device.identifier);
    }
    if (device.serial) {
      candidates.push(device.serial);
    }

    return candidates;
  }

  function findLiveStatusInMapByCandidates(statusMap, candidates) {
    if (!statusMap || typeof statusMap !== "object") {
      return null;
    }

    var safeCandidates = Array.isArray(candidates) ? candidates : [];
    for (var i = 0; i < safeCandidates.length; i += 1) {
      var candidateKey = normalizeDeviceStatusKey(safeCandidates[i]);
      if (candidateKey && statusMap[candidateKey]) {
        return {
          key: candidateKey,
          value: statusMap[candidateKey]
        };
      }
    }

    var mapKeys = Object.keys(statusMap);
    for (var j = 0; j < mapKeys.length; j += 1) {
      var normalizedMapKey = normalizeDeviceStatusKey(mapKeys[j]);
      var matched = safeCandidates.some(function (candidate) {
        var normalizedCandidate = normalizeDeviceStatusKey(candidate);
        return (
          normalizedCandidate &&
          (normalizedCandidate === normalizedMapKey ||
            normalizedMapKey.indexOf(normalizedCandidate) !== -1 ||
            normalizedCandidate.indexOf(normalizedMapKey) !== -1)
        );
      });

      if (matched) {
        return {
          key: mapKeys[j],
          value: statusMap[mapKeys[j]]
        };
      }
    }

    return null;
  }

  function getLiveStatusTimestampMs(entry) {
    if (!entry || typeof entry !== "object") {
      return NaN;
    }

    var recordedAt = normalizeAnyDateTimeString(entry.recordedAt || entry.timestamp || "");
    if (recordedAt) {
      var recordedAtMs = parseFlexibleTimeMs(recordedAt);
      if (Number.isFinite(recordedAtMs)) {
        return recordedAtMs;
      }
    }

    var date = typeof entry.date === "string" ? entry.date.trim() : "";
    var time = typeof entry.time === "string" ? entry.time.trim() : "";
    if (date && time) {
      return parseFlexibleTimeMs(date + "T" + time);
    }

    return NaN;
  }

  function buildLiveStatusFromDeviceSnapshot(item) {
    if (!item || typeof item !== "object") {
      return null;
    }

    var deviceKey = item.device_id || item.externalDeviceId || item.name || item.id;
    if (!deviceKey) {
      return null;
    }

    var hasTelemetryFields =
      item.recordedAt ||
      item.date ||
      item.time ||
      item.battery !== undefined ||
      item.temperature !== undefined ||
      item.uptime !== undefined ||
      item.internet !== undefined ||
      item.ping !== undefined ||
      item.interface !== undefined;

    if (!hasTelemetryFields) {
      return null;
    }

    var normalizedRecordedAt = normalizeAnyDateTimeString(item.recordedAt || "");
    if (!normalizedRecordedAt) {
      var date = typeof item.date === "string" ? item.date.trim() : "";
      var time = typeof item.time === "string" ? item.time.trim() : "";
      if (date && time) {
        normalizedRecordedAt = normalizeAnyDateTimeString(date + "T" + time);
      }
    }

    var datePart = null;
    var timePart = null;
    if (normalizedRecordedAt) {
      var matched = normalizedRecordedAt.match(/^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2}:\d{2})$/);
      if (matched) {
        datePart = matched[1];
        timePart = matched[2];
      }
    }

    return {
      device_id: String(deviceKey),
      battery: item.battery,
      temperature: item.temperature,
      uptime: item.uptime,
      internet: item.internet,
      ping: item.ping,
      interface: item.interface,
      recordedAt: normalizedRecordedAt || null,
      date: datePart || (typeof item.date === "string" && item.date.trim() ? item.date.trim() : null),
      time: timePart || (typeof item.time === "string" && item.time.trim() ? item.time.trim() : null)
    };
  }

  function seedLiveDeviceStatusFromSnapshot(devicesWithStatus) {
    if (!Array.isArray(devicesWithStatus) || devicesWithStatus.length === 0) {
      return false;
    }

    var mapUpdated = false;
    var nextMap = Object.assign({}, liveDeviceStatusMap || {});

    devicesWithStatus.forEach(function (item) {
      var snapshotStatus = buildLiveStatusFromDeviceSnapshot(item);
      if (!snapshotStatus) {
        return;
      }

      var candidates = getDeviceStatusCandidates(item);
      candidates.unshift(snapshotStatus.device_id);

      var matchedEntry = findLiveStatusInMapByCandidates(nextMap, candidates);
      if (!matchedEntry) {
        var snapshotKey = normalizeDeviceStatusKey(snapshotStatus.device_id);
        if (snapshotKey) {
          nextMap[snapshotKey] = snapshotStatus;
          mapUpdated = true;
        }
        return;
      }

      var existingTimeMs = getLiveStatusTimestampMs(matchedEntry.value);
      var snapshotTimeMs = getLiveStatusTimestampMs(snapshotStatus);
      var shouldReplace = false;

      if (!Number.isFinite(existingTimeMs)) {
        shouldReplace = Number.isFinite(snapshotTimeMs);
      } else if (Number.isFinite(snapshotTimeMs) && snapshotTimeMs > existingTimeMs) {
        shouldReplace = true;
      }

      if (shouldReplace) {
        nextMap[matchedEntry.key] = snapshotStatus;
        mapUpdated = true;
      }
    });

    if (mapUpdated) {
      liveDeviceStatusMap = nextMap;
    }

    return mapUpdated;
  }

  function readStoredLiveDeviceStatus() {
    try {
      var rawValue = localStorage.getItem(deviceStatusStorageKey);
      if (!rawValue) {
        return {};
      }
      var parsed = JSON.parse(rawValue);
      return parsed && typeof parsed === "object" ? parsed : {};
    } catch (_error) {
      return {};
    }
  }

  function saveStoredLiveDeviceStatus(value) {
    try {
      localStorage.setItem(deviceStatusStorageKey, JSON.stringify(value));
    } catch (_error) {
      // ignore storage issues in private browsing or restricted contexts
    }
  }

  function normalizeLiveDeviceStatusPayload(payload) {
    var result = {};
    if (!payload || typeof payload !== "object") {
      return result;
    }

    if (Array.isArray(payload.devices)) {
      payload.devices.forEach(function (item) {
        if (!item || typeof item !== "object") {
          return;
        }
        var key = normalizeDeviceStatusKey(item.device_id || item.id || item.deviceId || item.name || item.deviceName || item.key);
        if (!key) {
          return;
        }
        result[key] = item;
      });
      return result;
    }

    if (Array.isArray(payload.entries)) {
      payload.entries.forEach(function (item) {
        if (!item || typeof item !== "object") {
          return;
        }
        var key = normalizeDeviceStatusKey(item.device_id || item.id || item.deviceId || item.name || item.deviceName || item.key);
        if (!key) {
          return;
        }
        result[key] = item;
      });
      return result;
    }

    if (Array.isArray(payload)) {
      payload.forEach(function (item) {
        if (!item || typeof item !== "object") {
          return;
        }
        var key = normalizeDeviceStatusKey(item.device_id || item.id || item.deviceId || item.name || item.deviceName || item.key);
        if (!key) {
          return;
        }
        result[key] = item;
      });
      return result;
    }

    Object.keys(payload).forEach(function (key) {
      var item = payload[key];
      if (!item || typeof item !== "object") {
        return;
      }
      result[normalizeDeviceStatusKey(key)] = item;
    });

    return result;
  }

  function getLiveDeviceStatusForCard(device, deviceIndex, totalDevices) {
    if (!device || !liveDeviceStatusMap || typeof liveDeviceStatusMap !== "object") {
      return null;
    }

    var matchedEntry = findLiveStatusInMapByCandidates(liveDeviceStatusMap, getDeviceStatusCandidates(device));
    return matchedEntry ? matchedEntry.value : null;
  }

  function parseDeviceCoordinate(value) {
    if (value === null || value === undefined || value === "") {
      return null;
    }

    var parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }

  function renderDevicesOverviewMap(devicesWithStatus) {
    if (!topLevelDevicesMapContainer || !window.L) {
      return;
    }

    if (!devicesOverviewMapInstance) {
      devicesOverviewMapInstance = L.map(topLevelDevicesMapContainer, { attributionControl: false }).setView([
        DEFAULT_LOCATION_LAT,
        DEFAULT_LOCATION_LNG
      ], 7);
      var terrainLayer = createTerrainTileLayer();
      var satelliteLayer = createSatelliteTileLayer();
      terrainLayer.addTo(devicesOverviewMapInstance);
      L.control.attribution({ prefix: false, position: "bottomright" }).addTo(devicesOverviewMapInstance);
      L.control.scale({ position: "bottomleft", metric: true, imperial: false }).addTo(devicesOverviewMapInstance);
      L.control.ruler({ position: "topleft" }).addTo(devicesOverviewMapInstance);
      L.control.layers(
        { "تضاريس": terrainLayer, "قمر صناعي": satelliteLayer },
        null,
        { position: "topright" }
      ).addTo(devicesOverviewMapInstance);
      devicesOverviewLayerGroup = L.layerGroup().addTo(devicesOverviewMapInstance);
      devicesOverviewMapInstance.invalidateSize();
    }

    if (!devicesOverviewLayerGroup) {
      devicesOverviewLayerGroup = L.layerGroup().addTo(devicesOverviewMapInstance);
    }

    devicesOverviewLayerGroup.clearLayers();

    var list = Array.isArray(devicesWithStatus) ? devicesWithStatus : [];
    var bounds = [];

    list.forEach(function (item, index) {
      var device = devicesCache.find(function (cached) {
        return Number(cached.id) === Number(item.id);
      }) || item;

      var latitude = parseDeviceCoordinate(device.latitude);
      var longitude = parseDeviceCoordinate(device.longitude);
      if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
        return;
      }

      var liveStatus = getLiveDeviceStatusForCard(device, index, list.length);
      var internetValue = liveStatus && typeof liveStatus.internet === "string" ? liveStatus.internet.trim().toUpperCase() : "";
      var isOnline = internetValue === "UP";
      var statusText = isOnline ? "متصل" : internetValue === "DOWN" ? "غير متصل" : "غير معروف";
      var tooltipLines = ["<strong>" + (device.name || "جهاز") + "</strong>", "الحالة: " + statusText];
      if (liveStatus && Number.isFinite(Number(liveStatus.ping))) {
        tooltipLines.push("زمن الاستجابة: " + Number(liveStatus.ping).toFixed(1) + " ms");
      }
      if (liveStatus && Number.isFinite(Number(liveStatus.temperature))) {
        tooltipLines.push("درجة الحرارة: " + Number(liveStatus.temperature).toFixed(1) + "°");
      }
      if (liveStatus && Number.isFinite(Number(liveStatus.battery))) {
        tooltipLines.push("البطارية: " + Number(liveStatus.battery).toFixed(1) + "%");
      }
      if (liveStatus && liveStatus.uptime) {
        tooltipLines.push("مدة التشغيل: " + liveStatus.uptime);
      }
      var tooltipHtml = tooltipLines.join("<br>");

      var sensitivityCircles = isOnline
        ? [
            { radius: 5000, color: "#7f1d1d", fillColor: "#7f1d1d", fillOpacity: 0.35 },
            { radius: 10000, color: "#b91c1c", fillColor: "#b91c1c", fillOpacity: 0.20 },
            { radius: 15000, color: "#f87171", fillColor: "#f87171", fillOpacity: 0.13 }
          ]
        : [
            { radius: 5000, color: "#6f1d1d", fillColor: "#6f1d1d", fillOpacity: 0.12 },
            { radius: 10000, color: "#6f1d1d", fillColor: "#6f1d1d", fillOpacity: 0.08 },
            { radius: 15000, color: "#6f1d1d", fillColor: "#6f1d1d", fillOpacity: 0.04 }
          ];

      sensitivityCircles.forEach(function (circleConfig) {
        L.circle([latitude, longitude], {
          radius: circleConfig.radius,
          color: circleConfig.color,
          fillColor: circleConfig.fillColor,
          fillOpacity: circleConfig.fillOpacity,
          weight: 1
        }).addTo(devicesOverviewLayerGroup);
      });

      L.circleMarker([latitude, longitude], {
        radius: 8,
        color: "#ffffff",
        weight: 1,
        fillColor: isOnline ? "#21a366" : "#6f1d1d",
        fillOpacity: 1
      })
        .bindTooltip(tooltipHtml, { sticky: true })
        .bindPopup(tooltipHtml)
        .addTo(devicesOverviewLayerGroup);

      bounds.push([latitude, longitude]);
    });

    lastKnownDeviceBounds = bounds.slice();
  }

  function renderDevicesViews(devicesWithStatus) {
    renderDevicesCards(devicesWithStatus);
    renderDevicesOverviewMap(devicesWithStatus);
  }

  function renderDevicesCards(devicesWithStatus) {
    if (!devicesCardsGrid) {
      return;
    }

    devicesCardsGrid.innerHTML = "";

    var list = Array.isArray(devicesWithStatus) ? devicesWithStatus : [];
    if (!list.length) {
      var emptyState = document.createElement("p");
      emptyState.className = "history-info";
      emptyState.textContent = "لا توجد أجهزة لعرضها";
      devicesCardsGrid.appendChild(emptyState);
      return;
    }

    var onlineCards = [];
    var offlineCards = [];

    list.forEach(function (item, index) {
      var device = devicesCache.find(function (cached) {
        return Number(cached.id) === Number(item.id);
      }) || item;

      function appendMetaLine(parent, label, value, valueClassName) {
        var line = document.createElement("p");
        line.className = "device-card-meta";
        line.appendChild(document.createTextNode(label));
        var valueSpan = document.createElement("span");
        if (valueClassName) {
          valueSpan.className = valueClassName;
        }
        valueSpan.textContent = value;
        line.appendChild(valueSpan);
        parent.appendChild(line);
      }

      var card = document.createElement("article");
      card.className = "device-card";
      card.dataset.deviceId = String(device.id);
      card.dataset.deviceName = String(device.name || "");

      var liveStatus = getLiveDeviceStatusForCard(device, index, list.length);
      card.classList.remove("device-card--online", "device-card--offline");
      if (liveStatus) {
        var internetValue = typeof liveStatus.internet === "string" ? liveStatus.internet.trim().toLowerCase() : "";
        if (internetValue) {
          card.classList.toggle("device-card--online", internetValue === "up");
          card.classList.toggle("device-card--offline", internetValue === "down");
        } else if (liveStatus.status) {
          var liveStatusText = String(liveStatus.status).trim().toLowerCase();
          card.classList.toggle("device-card--online", liveStatusText === "online");
          card.classList.toggle("device-card--offline", liveStatusText === "offline");
        }
      }

      var titleRow = document.createElement("div");
      titleRow.style.display = "flex";
      titleRow.style.alignItems = "center";
      titleRow.style.justifyContent = "space-between";
      titleRow.style.gap = "8px";

      var title = document.createElement("h3");
      title.className = "device-card-title";
      title.textContent = device.name;
      titleRow.appendChild(title);
      card.appendChild(titleRow);

      var description = document.createElement("p");
      description.className = "device-card-meta";
      description.textContent = device.description || "بدون وصف";
      card.appendChild(description);

      var status = document.createElement("p");
      status.className = "device-card-status";
      status.appendChild(document.createTextNode("الحالة الأخيرة: "));
      var statusValue = document.createElement("span");
      statusValue.style.color = resolveAiStatusColorForCards(item.latestStatusAiStatus);
      statusValue.textContent = formatDeviceCardStatus(item.latestStatusAiStatus, item.latestStatusConfidence);
      status.appendChild(statusValue);
      card.appendChild(status);

      if (item.latestStatusTimestamp) {
        var timestamp = document.createElement("p");
        timestamp.className = "device-card-meta";
        timestamp.textContent = "آخر تحديث: " + item.latestStatusTimestamp;
        card.appendChild(timestamp);
      }

      var hasLiveTelemetry = false;
      var liveMeta = document.createElement("div");

      if (liveStatus) {
        if (typeof liveStatus.internet === "string" && liveStatus.internet.trim()) {
          appendMetaLine(liveMeta, "الشبكة: ", liveStatus.internet.trim().toUpperCase());
          hasLiveTelemetry = true;
        }

        if (Number.isFinite(Number(liveStatus.battery))) {
          appendMetaLine(liveMeta, "البطارية: ", Number(liveStatus.battery).toFixed(1) + "%");
          hasLiveTelemetry = true;
        }

        if (Number.isFinite(Number(liveStatus.temperature))) {
          var temperatureValue = Number(liveStatus.temperature);
          appendMetaLine(
            liveMeta,
            "درجة الحرارة: ",
            temperatureValue.toFixed(1) + "°",
            temperatureValue > 70 ? "device-card-temp-warning" : ""
          );
          hasLiveTelemetry = true;
        }

        if (typeof liveStatus.uptime === "string" && liveStatus.uptime.trim()) {
          appendMetaLine(liveMeta, "مدة التشغيل: ", liveStatus.uptime.trim());
          hasLiveTelemetry = true;
        }

        if (Number.isFinite(Number(liveStatus.ping))) {
          appendMetaLine(liveMeta, "زمن الاستجابة: ", Number(liveStatus.ping).toFixed(1) + " ms");
          hasLiveTelemetry = true;
        }

        if (typeof liveStatus.interface === "string" && liveStatus.interface.trim()) {
          appendMetaLine(liveMeta, "الواجهة: ", liveStatus.interface.trim());
          hasLiveTelemetry = true;
        }

        if (typeof liveStatus.date === "string" && liveStatus.date.trim() && typeof liveStatus.time === "string" && liveStatus.time.trim()) {
          appendMetaLine(liveMeta, "آخر نبضة من الجهاز: ", liveStatus.date.trim() + " " + liveStatus.time.trim());
          hasLiveTelemetry = true;
        }
      }

      if (hasLiveTelemetry) {
        liveMeta.className = "device-card-live-meta";
        card.appendChild(liveMeta);
      }

      if (isAdmin) {
        var actions = document.createElement("div");
        actions.className = "device-card-actions";

        var editBtn = document.createElement("button");
        editBtn.type = "button";
        editBtn.className = "ghost-btn";
        editBtn.textContent = "تعديل";
        editBtn.addEventListener("click", function () {
          startEditingDevice(device);
        });

        var locationBtn = document.createElement("button");
        locationBtn.type = "button";
        locationBtn.className = "ghost-btn";
        locationBtn.textContent = "📍 الموقع";
        locationBtn.addEventListener("click", function () {
          openDeviceLocationModal(device);
        });

        var deleteBtn = document.createElement("button");
        deleteBtn.type = "button";
        deleteBtn.className = "danger-btn";
        deleteBtn.textContent = "حذف";
        deleteBtn.addEventListener("click", async function () {
          if (!window.confirm("هل تريد حذف الجهاز " + device.name + "؟")) {
            return;
          }
          try {
            await apiRequest("/api/devices/" + device.id, { method: "DELETE" });
            if (Number(selectedDeviceId) === Number(device.id)) {
              selectedDeviceId = null;
              selectedDeviceName = "";
              selectedDeviceKey = "";
              currentPackets = [];
            }
            if (Number(editingDeviceId) === Number(device.id)) {
              resetDeviceForm();
              closeDeviceModal();
            }
            await loadDevices();
            setGlobalMessage("تم حذف الجهاز بنجاح", false);
          } catch (error) {
            setGlobalMessage(error instanceof Error ? error.message : "فشل الحذف", true);
          }
        });

        actions.appendChild(editBtn);
        actions.appendChild(locationBtn);
        actions.appendChild(deleteBtn);
        card.appendChild(actions);
      }

      if (card.classList.contains("device-card--online")) {
        onlineCards.push(card);
      } else {
        offlineCards.push(card);
      }
    });

    onlineCards.forEach(function (card) {
      devicesCardsGrid.appendChild(card);
    });

    if (onlineCards.length && offlineCards.length) {
      var divider = document.createElement("hr");
      divider.className = "devices-cards-divider";
      devicesCardsGrid.appendChild(divider);
    }

    offlineCards.forEach(function (card) {
      devicesCardsGrid.appendChild(card);
    });
  }
  var zoomInBtn = document.getElementById("zoomInBtn");
  var zoomOutBtn = document.getElementById("zoomOutBtn");
  var fitPacketsBtn = document.getElementById("fitPacketsBtn");
  var colorMapBtn = document.getElementById("colorMapBtn");
  var followLiveBtn = document.getElementById("followLiveBtn");
  var displayGainInput = document.getElementById("displayGainInput");
  var displayGainValue = document.getElementById("displayGainValue");
  var freqMinInput = document.getElementById("freqMinInput");
  var freqMaxInput = document.getElementById("freqMaxInput");
  var applyFreqRangeBtn = document.getElementById("applyFreqRangeBtn");
  var clearFreqRangeBtn = document.getElementById("clearFreqRangeBtn");
  var intensityModeSelect = document.getElementById("intensityModeSelect");
  var dbMinInput = document.getElementById("dbMinInput");
  var dbMaxInput = document.getElementById("dbMaxInput");
  var pctLowInput = document.getElementById("pctLowInput");
  var pctHighInput = document.getElementById("pctHighInput");
  var applyIntensityBtn = document.getElementById("applyIntensityBtn");
  var compareViewSelect = document.getElementById("compareViewSelect");
  var noiseSuppressionEnabledInput = document.getElementById("noiseSuppressionEnabledInput");
  var noiseFloorPercentileInput = document.getElementById("noiseFloorPercentileInput");
  var noiseThresholdInput = document.getElementById("noiseThresholdInput");
  var isolatedPixelRemovalEnabledInput = document.getElementById("isolatedPixelRemovalEnabledInput");
  var minActiveNeighborsInput = document.getElementById("minActiveNeighborsInput");
  var neighborhoodSizeSelect = document.getElementById("neighborhoodSizeSelect");
  var bucketAggregationSelect = document.getElementById("bucketAggregationSelect");
  var debugStatsEnabledInput = document.getElementById("debugStatsEnabledInput");
  var logFrequencyViewToggle = document.getElementById("logFrequencyViewToggle");
  var applyNoiseBtn = document.getElementById("applyNoiseBtn");

  var usersTableBody = document.getElementById("usersTableBody");
  var userForm = document.getElementById("userForm");
  var userIdInput = document.getElementById("userId");
  var userNameInput = document.getElementById("userName");
  var userUsernameInput = document.getElementById("userUsername");
  var userPasswordInput = document.getElementById("userPassword");
  var userRoleInput = document.getElementById("userRole");
  var userDeviceAssignmentGroup = document.getElementById("userDeviceAssignmentGroup");
  var userDeviceIdsInput = document.getElementById("userDeviceIds");
  var userSaveBtn = document.getElementById("userSaveBtn");
  var userCancelBtn = document.getElementById("userCancelBtn");
  var userFormMessage = document.getElementById("userFormMessage");
  var openUserModalBtn = document.getElementById("openUserModalBtn");
  var refreshUsersPanelBtn = document.getElementById("refreshUsersPanelBtn");
  var userModal = document.getElementById("userModal");
  var userModalTitle = document.getElementById("userModalTitle");
  var pendingDevicesTableBody = document.getElementById("pendingDevicesTableBody");
  var pendingDevicesMessage = document.getElementById("pendingDevicesMessage");
  var deviceChangeRequestsTableBody = document.getElementById("deviceChangeRequestsTableBody");
  var deviceChangeRequestsMessage = document.getElementById("deviceChangeRequestsMessage");

  var devicesCardsGrid = document.getElementById("devicesCardsGrid");
  var deviceSearchInput = document.getElementById("deviceSearchInput");
  var exportDevicesBtn = document.getElementById("exportDevicesBtn");
  var openDeviceModalBtn = document.getElementById("openDeviceModalBtn");
  var deviceModal = document.getElementById("deviceModal");
  var deviceModalTitle = document.getElementById("deviceModalTitle");
  var deviceForm = document.getElementById("deviceForm");
  var deviceIdInput = document.getElementById("deviceId");
  var deviceNameInput = document.getElementById("deviceName");
  var deviceExternalDeviceIdInput = document.getElementById("deviceExternalDeviceId");
  var deviceDescriptionInput = document.getElementById("deviceDescription");
  var deviceMinFrequencyInput = document.getElementById("deviceMinFrequency");
  var deviceMaxFrequencyInput = document.getElementById("deviceMaxFrequency");
  var deviceSaveBtn = document.getElementById("deviceSaveBtn");
  var deviceCancelBtn = document.getElementById("deviceCancelBtn");
  var deviceFormMessage = document.getElementById("deviceFormMessage");
  var deviceLocationModal = document.getElementById("deviceLocationModal");
  var deviceLocationModalTitle = document.getElementById("deviceLocationModalTitle");
  var deviceLocationSearchInput = document.getElementById("deviceLocationSearchInput");
  var deviceLocationMapContainer = document.getElementById("deviceLocationMapContainer");
  var deviceLocationMessage = document.getElementById("deviceLocationMessage");
  var saveDeviceLocationBtn = document.getElementById("saveDeviceLocationBtn");
  var cancelDeviceLocationBtn = document.getElementById("cancelDeviceLocationBtn");
  var topLevelDevicesMapContainer = document.getElementById("topLevelDevicesMapContainer");
  var toggleMapFullscreenBtn = document.getElementById("toggleMapFullscreenBtn");

  var logoutBtn = document.getElementById("logoutBtn");

  if (
    !topNav ||
    !dashboardLayoutEl ||
    !historyPanel ||
    !mapPanel ||
    !statisticsPanel ||
    !usersPanel ||
    !devicesPanel ||
    !deviceSearchInput ||
    !exportDevicesBtn ||
    !globalMessageEl ||
    !userBadgeEl ||
    !socketStatusBadgeEl ||
    !rightPanel ||
    !toggleRightPanelBtn ||
    !deviceListEl ||
    !multiViewBtn ||
    !multiViewPickerModal ||
    !multiViewDeviceOptions ||
    !multiViewContinueBtn ||
    !multiViewCancelBtn ||
    !multiViewOverlay ||
    !multiViewGrid ||
    !selectedDeviceTitleEl ||
    !historyInfoEl ||
    !sideDeviceInfoEl ||
    !processingStatusEl ||
    !canvas ||
    !spectrogramLoaderEl ||
    !legendCanvas ||
    !gapTooltipEl ||
    !probeTooltipEl ||
    !historyRangeForm ||
    !latest24Btn ||
    !latest5hBtn ||
    !latest24hBtn ||
    !latestPacketBtn ||
    !resetViewBtn ||
    !clearMarkersBtn ||
    !panLeftBtn ||
    !panRightBtn ||
    !zoomInBtn ||
    !zoomOutBtn ||
    !fitPacketsBtn ||
    !colorMapBtn ||
    !followLiveBtn ||
    !displayGainInput ||
    !displayGainValue ||
    !freqMinInput ||
    !freqMaxInput ||
    !applyFreqRangeBtn ||
    !clearFreqRangeBtn ||
    !intensityModeSelect ||
    !dbMinInput ||
    !dbMaxInput ||
    !pctLowInput ||
    !pctHighInput ||
    !applyIntensityBtn ||
    !compareViewSelect ||
    !noiseSuppressionEnabledInput ||
    !noiseFloorPercentileInput ||
    !noiseThresholdInput ||
    !isolatedPixelRemovalEnabledInput ||
    !minActiveNeighborsInput ||
    !neighborhoodSizeSelect ||
    !bucketAggregationSelect ||
    !debugStatsEnabledInput ||
    !logFrequencyViewToggle ||
    !applyNoiseBtn ||
    !usersTableBody ||
    !userForm ||
    !userIdInput ||
    !userNameInput ||
    !userUsernameInput ||
    !userPasswordInput ||
    !userRoleInput ||
    !userDeviceAssignmentGroup ||
    !userDeviceIdsInput ||
    !userSaveBtn ||
    !userCancelBtn ||
    !userFormMessage ||
    !openUserModalBtn ||
    !refreshUsersPanelBtn ||
    !userModal ||
    !userModalTitle ||
    !pendingDevicesTableBody ||
    !pendingDevicesMessage ||
    !deviceChangeRequestsTableBody ||
    !deviceChangeRequestsMessage ||
    !devicesCardsGrid ||
    !openDeviceModalBtn ||
    !deviceModal ||
    !deviceModalTitle ||
    !deviceForm ||
    !deviceIdInput ||
    !deviceNameInput ||
    !deviceExternalDeviceIdInput ||
    !deviceDescriptionInput ||
    !deviceMinFrequencyInput ||
    !deviceMaxFrequencyInput ||
    !deviceSaveBtn ||
    !deviceCancelBtn ||
    !deviceFormMessage ||
    !deviceLocationModal ||
    !deviceLocationModalTitle ||
    !deviceLocationSearchInput ||
    !deviceLocationMapContainer ||
    !deviceLocationMessage ||
    !saveDeviceLocationBtn ||
    !cancelDeviceLocationBtn ||
    !topLevelDevicesMapContainer ||
    !toggleMapFullscreenBtn ||
    !logoutBtn
  ) {
    return;
  }

  var isAdmin = user.role === "admin";
  var roleLabel = user.role === "admin" ? "مدير" : "موظف";
  userBadgeEl.textContent = user.name + " (" + roleLabel + ")";

  if (!isAdmin) {
    document.querySelectorAll(".admin-only").forEach(function (el) {
      el.classList.add("hidden");
    });
  }

  function setGlobalMessage(message, isError) {
    globalMessageEl.textContent = message || "";
    globalMessageEl.style.color = isError ? "#8a1c18" : "#1f6f53";
  }

  function setSocketStatus(isConnected, detail) {
    var label = isConnected ? "متصل" : "غير متصل";

    socketStatusBadgeEl.textContent = label;
    socketStatusBadgeEl.title = detail ? label + " | " + detail : label;
    socketStatusBadgeEl.classList.toggle("connected", !!isConnected);
    socketStatusBadgeEl.classList.toggle("disconnected", !isConnected);
  }

  function setRightPanelCollapsed(collapsed) {
    rightPanel.classList.toggle("collapsed", !!collapsed);
    toggleRightPanelBtn.textContent = collapsed ? "فتح القائمة" : "إغلاق القائمة";
    toggleRightPanelBtn.setAttribute("aria-expanded", collapsed ? "false" : "true");
  }

  function setProcessingStatus(text, isWarning) {
    processingStatusEl.textContent = text || "";
    processingStatusEl.style.color = isWarning ? "#8a1c18" : "#375a4f";
    processingStatusEl.style.background = isWarning ? "#fff3f1" : "#eef7f3";
    processingStatusEl.style.borderColor = isWarning ? "#f2c9c2" : "#cee8de";
  }

  function ensureLiveTraceElement() {
    // Live trace status is kept internal only; no on-page debug text is rendered.
    return null;
  }

  function renderLiveTraceStatus() {
    // Intentionally hidden from UI.
  }

  function markLiveTrace(stage, meta) {
    var details = meta || {};
    liveTraceCounters.lastStage = stage;

    if (stage === "socket-received") {
      liveTraceCounters.received += 1;
    } else if (stage === "socket-matched") {
      liveTraceCounters.matched += 1;
    } else if (stage === "buffered") {
      liveTraceCounters.buffered += 1;
    } else if (stage === "merged-from-buffer") {
      liveTraceCounters.mergedFromBuffer += Number(details.count) || 0;
    } else if (stage === "inserted") {
      liveTraceCounters.inserted += 1;
    } else if (stage === "duplicate") {
      liveTraceCounters.duplicates += 1;
    } else if (stage === "rendered") {
      liveTraceCounters.rendered += 1;
    } else if (stage === "drop-device") {
      liveTraceCounters.droppedByDevice += 1;
    } else if (stage === "drop-time") {
      liveTraceCounters.droppedByTime += 1;
    }

    if (Number.isFinite(details.packetTimeMs)) {
      liveTraceCounters.lastPacketIso = new Date(details.packetTimeMs).toISOString();
    }

    if (Number.isFinite(details.renderAtMs)) {
      liveTraceCounters.lastRenderIso = new Date(details.renderAtMs).toISOString();
    }

    if (typeof details.issue === "string") {
      liveTraceCounters.lastIssue = details.issue;
    }

    renderLiveTraceStatus();

    if (typeof window !== "undefined") {
      window.__liveTrace = {
        stage: liveTraceCounters.lastStage,
        received: liveTraceCounters.received,
        matched: liveTraceCounters.matched,
        buffered: liveTraceCounters.buffered,
        mergedFromBuffer: liveTraceCounters.mergedFromBuffer,
        inserted: liveTraceCounters.inserted,
        duplicates: liveTraceCounters.duplicates,
        rendered: liveTraceCounters.rendered,
        droppedByDevice: liveTraceCounters.droppedByDevice,
        droppedByTime: liveTraceCounters.droppedByTime,
        lastPacketIso: liveTraceCounters.lastPacketIso,
        lastRenderIso: liveTraceCounters.lastRenderIso,
        lastIssue: liveTraceCounters.lastIssue
      };
    }

    if (typeof console !== "undefined" && typeof console.info === "function") {
      console.info("[LiveTrace]", stage, details);
    }
  }

  function parseDisplayFrequencyRange() {
    var minValue = parseOptionalNumberInput(freqMinInput.value);
    var maxValue = parseOptionalNumberInput(freqMaxInput.value);

    if (!Number.isFinite(minValue) || !Number.isFinite(maxValue) || maxValue <= minValue) {
      return null;
    }

    return {
      min: minValue,
      max: maxValue
    };
  }

  function applyFrequencyRangeFilter() {
    var range = parseDisplayFrequencyRange();
    if (!range) {
      setGlobalMessage("أدخل قيمًا صحيحة لأقل وأعلى تردد (Hz).", true);
      return;
    }

    setGlobalMessage("تم ضبط نطاق التردد على " + range.min + " Hz - " + range.max + " Hz", false);
    scheduleRender({ skipTable: false });
  }

  function clearFrequencyRangeFilter() {
    freqMinInput.value = "";
    freqMaxInput.value = "";
    setGlobalMessage("تم مسح مرشح التردد العمودي.", false);
    scheduleRender({ skipTable: false });
  }

  function setSpectrogramLoading(isLoading) {
    spectrogramLoaderEl.classList.toggle("hidden", !isLoading);
    canvas.setAttribute("aria-busy", isLoading ? "true" : "false");
  }

  function parseOptionalNumberInput(value) {
    var raw = String(value || "").trim();
    if (!raw) {
      return null;
    }

    var parsed = Number(raw);
    return Number.isFinite(parsed) ? parsed : null;
  }

  function isCompressedMatrixPayload(value) {
    return (
      value &&
      typeof value === "object" &&
      value.format === "gzip-base64-json-v1" &&
      typeof value.payload === "string"
    );
  }

  function decodeCompressedMatrixPayload(stored) {
    if (!isCompressedMatrixPayload(stored)) {
      return stored;
    }

    var pako = typeof window !== "undefined" ? window.pako : null;
    if (!pako || typeof pako.inflate !== "function") {
      throw new Error("مكتبة فك الضغط pako غير متاحة في المتصفح");
    }

    var binary = atob(stored.payload);
    var bytes = new Uint8Array(binary.length);
    for (var i = 0; i < binary.length; i += 1) {
      bytes[i] = binary.charCodeAt(i);
    }

    try {
      var inflatedText = pako.inflate(bytes, { to: "string" });
      return JSON.parse(String(inflatedText).trim());
    } catch (_firstError) {
      // Fallback path: decode as UTF-8 bytes for payloads that break `to: "string"` parsing.
      var inflatedBytes = pako.inflate(bytes);
      var decoder = new TextDecoder("utf-8");
      var text = decoder.decode(inflatedBytes);
      return JSON.parse(String(text).trim());
    }
  }

  function decodePacketMatrix(packet) {
    if (!packet || typeof packet !== "object") {
      return packet;
    }

    if (Array.isArray(packet.data)) {
      return packet;
    }

    packet.data = decodeCompressedMatrixPayload(packet.data);
    return packet;
  }

  function decodePacketsMatrix(packets) {
    if (!Array.isArray(packets)) {
      return [];
    }

    var decoded = [];
    for (var i = 0; i < packets.length; i += 1) {
      decoded.push(decodePacketMatrix(packets[i]));
    }
    return decoded;
  }

  function normalizeFrequencyBins(rawBins) {
    if (!Array.isArray(rawBins) || rawBins.length === 0) {
      return null;
    }

    var bins = [];
    for (var i = 0; i < rawBins.length; i += 1) {
      var item = rawBins[i];
      var value;
      if (Array.isArray(item)) {
        if (!item.length) {
          return null;
        }
        value = Number(item[0]);
      } else {
        value = Number(item);
      }

      if (!Number.isFinite(value)) {
        return null;
      }

      bins.push(value);
    }

    return bins;
  }

  function getPacketFrequencyBins(packet) {
    if (!packet) {
      return null;
    }

    if (Array.isArray(packet.__frequencyBins)) {
      return packet.__frequencyBins;
    }

    var bins = normalizeFrequencyBins(packet.frequencyBins || packet.freq || packet.frequencies);
    packet.__frequencyBins = bins;
    return bins;
  }

  var activeColorMap = "magma";
  var activeDisplayGainDb = 0;
  var activeIntensityMode = "linear";
  var activeDbMin = -95;
  var activeDbMax = -20;
  var activePercentileLow = 5;
  var activePercentileHigh = 99;
  var activeCompareView = "denoised";
  var activeNoiseSuppressionEnabled = true;
  var activeNoiseFloorPercentile = 72;
  var activeNoiseThreshold = 0.06;
  var activeIsolatedPixelRemovalEnabled = true;
  var activeMinActiveNeighbors = 1;
  var activeNeighborhoodSize = 3;
  var activeBucketAggregation = "max";
  var activeDebugStatsEnabled = false;
  var activeLogFrequencyView = false;
  var logFrequencyViewStorageKey = "logFrequencyView";

  function readStoredLogFrequencyView() {
    try {
      return localStorage.getItem(logFrequencyViewStorageKey) === "1";
    } catch (_error) {
      return false;
    }
  }

  function saveStoredLogFrequencyView(value) {
    try {
      localStorage.setItem(logFrequencyViewStorageKey, value ? "1" : "0");
    } catch (_error) {
      // ignore storage failures
    }
  }

  function applyLogFrequencyViewSettings() {
    activeLogFrequencyView = parseBoolInput(logFrequencyViewToggle, false);
    logFrequencyViewToggle.checked = activeLogFrequencyView;
    saveStoredLogFrequencyView(activeLogFrequencyView);
    scheduleRender({ skipTable: true });
    setGlobalMessage(activeLogFrequencyView ? "تم تفعيل العرض اللوغاريتمي" : "تم تفعيل العرض الخطي", false);
  }

  function parseBoolInput(input, fallback) {
    if (!(input instanceof HTMLInputElement)) {
      return fallback;
    }
    return !!input.checked;
  }

  function applyNoiseSettings() {
    var compareView = String(compareViewSelect.value || "denoised").toLowerCase();
    if (compareView !== "original" && compareView !== "thresholded" && compareView !== "denoised") {
      compareView = "denoised";
    }

    var floorPercentile = Number(noiseFloorPercentileInput.value);
    if (!Number.isFinite(floorPercentile)) {
      floorPercentile = 72;
    }
    floorPercentile = clamp(floorPercentile, 1, 99);

    var threshold = Number(noiseThresholdInput.value);
    if (!Number.isFinite(threshold)) {
      threshold = 0.06;
    }
    threshold = clamp(threshold, 0, 1);

    var minNeighbors = Math.round(Number(minActiveNeighborsInput.value));
    if (!Number.isFinite(minNeighbors)) {
      minNeighbors = 1;
    }
    minNeighbors = clamp(minNeighbors, 0, 24);

    var neighborhoodSize = Math.round(Number(neighborhoodSizeSelect.value));
    if (neighborhoodSize !== 5) {
      neighborhoodSize = 3;
    }

    var aggregation = String(bucketAggregationSelect.value || "max").toLowerCase();
    if (aggregation !== "hybrid") {
      aggregation = "max";
    }

    activeCompareView = compareView;
    activeNoiseSuppressionEnabled = parseBoolInput(noiseSuppressionEnabledInput, true);
    activeNoiseFloorPercentile = floorPercentile;
    activeNoiseThreshold = threshold;
    activeIsolatedPixelRemovalEnabled = parseBoolInput(isolatedPixelRemovalEnabledInput, true);
    activeMinActiveNeighbors = minNeighbors;
    activeNeighborhoodSize = neighborhoodSize;
    activeBucketAggregation = aggregation;
    activeDebugStatsEnabled = parseBoolInput(debugStatsEnabledInput, false);

    compareViewSelect.value = activeCompareView;
    noiseFloorPercentileInput.value = String(activeNoiseFloorPercentile);
    noiseThresholdInput.value = String(activeNoiseThreshold);
    minActiveNeighborsInput.value = String(activeMinActiveNeighbors);
    neighborhoodSizeSelect.value = String(activeNeighborhoodSize);
    bucketAggregationSelect.value = activeBucketAggregation;

    scheduleRender({ skipTable: true });
    setGlobalMessage("تم تطبيق إعدادات الضجيج", false);
  }

  function updateIntensityControlsState() {
    var mode = String(activeIntensityMode || "linear");
    var isDbFixed = mode === "db-fixed";
    var isDbPercentile = mode === "db-percentile";

    dbMinInput.disabled = !isDbFixed;
    dbMaxInput.disabled = !isDbFixed;
    pctLowInput.disabled = !isDbPercentile;
    pctHighInput.disabled = !isDbPercentile;
  }

  function applyIntensitySettings() {
    var mode = String(intensityModeSelect.value || "linear");
    if (mode !== "linear" && mode !== "db-fixed" && mode !== "db-percentile") {
      mode = "linear";
    }

    var parsedDbMin = Number(dbMinInput.value);
    var parsedDbMax = Number(dbMaxInput.value);
    var parsedPctLow = Number(pctLowInput.value);
    var parsedPctHigh = Number(pctHighInput.value);

    if (!Number.isFinite(parsedDbMin)) {
      parsedDbMin = -95;
    }
    if (!Number.isFinite(parsedDbMax)) {
      parsedDbMax = -20;
    }
    if (parsedDbMax <= parsedDbMin) {
      parsedDbMax = parsedDbMin + 10;
    }

    if (!Number.isFinite(parsedPctLow)) {
      parsedPctLow = 5;
    }
    if (!Number.isFinite(parsedPctHigh)) {
      parsedPctHigh = 99;
    }
    parsedPctLow = clamp(parsedPctLow, 0, 99);
    parsedPctHigh = clamp(parsedPctHigh, 1, 100);
    if (parsedPctHigh <= parsedPctLow) {
      parsedPctHigh = Math.min(100, parsedPctLow + 1);
    }

    activeIntensityMode = mode;
    activeDbMin = parsedDbMin;
    activeDbMax = parsedDbMax;
    activePercentileLow = parsedPctLow;
    activePercentileHigh = parsedPctHigh;

    intensityModeSelect.value = activeIntensityMode;
    dbMinInput.value = String(activeDbMin);
    dbMaxInput.value = String(activeDbMax);
    pctLowInput.value = String(activePercentileLow);
    pctHighInput.value = String(activePercentileHigh);

    updateIntensityControlsState();
    scheduleRender({ skipTable: true });
    setGlobalMessage("تم تطبيق إعدادات المقياس", false);
  }

  function applyDisplayGainSettings() {
    var displayGainDb = Number(displayGainInput.value);
    if (!Number.isFinite(displayGainDb)) {
      displayGainDb = 0;
    }

    activeDisplayGainDb = clamp(displayGainDb, -24, 24);
    displayGainInput.value = String(activeDisplayGainDb);
    displayGainValue.textContent = String(activeDisplayGainDb) + " dB";
    scheduleRender({ skipTable: true });
    setGlobalMessage("تم تطبيق كسب العرض", false);
  }

  function updateColorMapButtonLabel() {
    colorMapBtn.textContent = "الألوان: " + activeColorMap;
    colorMapBtn.title = "تبديل خريطة الألوان (الحالية: " + activeColorMap + ")";
  }

  function applyColorMap(colorMap) {
    activeColorMap = String(colorMap || "magma").toLowerCase() === "sunset" ? "sunset" : "magma";
    window.Spectrogram.configure({
      colorMap: activeColorMap
    });
    updateColorMapButtonLabel();
    scheduleRender({ skipTable: true });
  }

  function toggleColorMap() {
    applyColorMap(activeColorMap === "magma" ? "sunset" : "magma");
  }

  function normalizeNaiveDateTimeString(value) {
    if (value === null || value === undefined) {
      return "";
    }

    if (value instanceof Date) {
      if (Number.isNaN(value.getTime())) {
        return "";
      }
      return formatNaiveDateTimeMs(value.getTime(), true).replace(" ", "T");
    }

    if (typeof value === "number" && Number.isFinite(value)) {
      return formatNaiveDateTimeMs(value, true).replace(" ", "T");
    }

    if (typeof value !== "string") {
      return "";
    }

    var trimmed = value.trim();
    if (!trimmed) {
      return "";
    }

    var match = trimmed.match(/^(\d{4})-(\d{2})-(\d{2})[T\s](\d{2}):(\d{2})(?::(\d{2})(?:\.(\d{1,3}))?)?$/);
    if (!match) {
      return "";
    }

    var year = match[1];
    var month = match[2];
    var day = match[3];
    var hours = match[4];
    var minutes = match[5];
    var seconds = match[6] || "00";
    return year + "-" + month + "-" + day + "T" + hours + ":" + minutes + ":" + seconds;
  }

  function normalizeAnyDateTimeString(value) {
    var normalized = normalizeNaiveDateTimeString(value);
    if (normalized) {
      return normalized;
    }

    var parsed = value instanceof Date ? value : new Date(value);
    if (!parsed || Number.isNaN(parsed.getTime())) {
      return "";
    }

    return formatNaiveDateTimeMs(parsed.getTime(), true).replace(" ", "T");
  }

  function formatNaiveDateTimeMs(value, withDate) {
    var ms = Number(value);
    if (!Number.isFinite(ms)) {
      return "-";
    }

    var date = new Date(ms);
    if (Number.isNaN(date.getTime())) {
      return "-";
    }

    var year = String(date.getFullYear());
    var month = String(date.getMonth() + 1).padStart(2, "0");
    var day = String(date.getDate()).padStart(2, "0");
    var hours = String(date.getHours()).padStart(2, "0");
    var minutes = String(date.getMinutes()).padStart(2, "0");
    var seconds = String(date.getSeconds()).padStart(2, "0");

    if (!withDate) {
      return hours + ":" + minutes;
    }

    return year + "-" + month + "-" + day + " " + hours + ":" + minutes + ":" + seconds;
  }

  function parseFlexibleTimeMs(value) {
    if (value === null || value === undefined || value === "") {
      return NaN;
    }

    if (typeof value === "string") {
      var normalizedValue = normalizeAnyDateTimeString(value);
      if (normalizedValue) {
        var matched = normalizedValue.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})$/);
        if (matched) {
          return new Date(
            Number(matched[1]),
            Number(matched[2]) - 1,
            Number(matched[3]),
            Number(matched[4]),
            Number(matched[5]),
            Number(matched[6]),
            0
          ).getTime();
        }
      }
    }

    var numericValue = Number(value);
    if (Number.isFinite(numericValue)) {
      return numericValue;
    }

    return NaN;
  }

  function getPacketStartMs(packet) {
    if (!packet) {
      return NaN;
    }

    if (Number.isFinite(packet.__startMs)) {
      return packet.__startMs;
    }

    var value = parseFlexibleTimeMs(packet.startTime || packet.start_time || packet.timestamp);
    if (Number.isFinite(value)) {
      packet.__startMs = value;
    }
    return value;
  }

  function getPacketEndMs(packet) {
    if (!packet) {
      return NaN;
    }

    if (Number.isFinite(packet.__endMs)) {
      return packet.__endMs;
    }

    var value = parseFlexibleTimeMs(packet.endTime || packet.end_time || packet.timestamp);
    if (Number.isFinite(value)) {
      packet.__endMs = value;
    }
    return value;
  }

  function getPacketTimestampMs(packet) {
    if (!packet) {
      return NaN;
    }

    if (Number.isFinite(packet.__timestampMs)) {
      return packet.__timestampMs;
    }

    var value = parseFlexibleTimeMs(
      packet.timestamp || packet.endTime || packet.end_time || packet.startTime || packet.start_time
    );
    if (Number.isFinite(value)) {
      packet.__timestampMs = value;
    }
    return value;
  }

  function normalizePacketTiming(packet) {
    if (!packet) {
      return packet;
    }

    getPacketStartMs(packet);
    getPacketEndMs(packet);
    getPacketTimestampMs(packet);
    return packet;
  }

  function getPacketKey(packet) {
    if (!packet) {
      return "";
    }

    var deviceId = Number(packet.deviceId);
    if (!Number.isFinite(deviceId)) {
      deviceId = Number(selectedDeviceId);
    }

    var startMs = getPacketStartMs(packet);
    var endMs = getPacketEndMs(packet);
    var timeMs = getPacketTimestampMs(packet);
    if (!Number.isFinite(startMs)) {
      startMs = timeMs;
    }
    if (!Number.isFinite(endMs)) {
      endMs = startMs;
    }
    if (!Number.isFinite(startMs) || !Number.isFinite(endMs)) {
      return "";
    }

    return String(deviceId) + "|" + String(startMs) + "|" + String(endMs);
  }

  function rebuildPacketKeySet() {
    currentPacketKeys = new Set();
    for (var i = 0; i < currentPackets.length; i += 1) {
      var key = getPacketKey(currentPackets[i]);
      if (key) {
        currentPacketKeys.add(key);
      }
    }
  }

  function getInitialLoadRangeIso() {
    var toMs = Date.now();
    var fromMs = toMs - DEFAULT_LIVE_WINDOW_MS;
    return {
      fromIso: formatNaiveDateTimeMs(fromMs, true),
      toIso: formatNaiveDateTimeMs(toMs, true)
    };
  }

  function getRecentRangeIso(hours) {
    var safeHours = Number(hours);
    if (!Number.isFinite(safeHours) || safeHours <= 0) {
      safeHours = 2;
    }

    var toMs = Date.now();
    var fromMs = toMs - Math.round(safeHours * 60 * 60 * 1000);
    return {
      fromIso: formatNaiveDateTimeMs(fromMs, true),
      toIso: formatNaiveDateTimeMs(toMs, true)
    };
  }

  function normalizeDeviceKey(value) {
    if (value === null || value === undefined) {
      return "";
    }

    return String(value).trim().toLowerCase();
  }

  function payloadMatchesSelectedDevice(payload) {
    if (!payload || !selectedDeviceId) {
      return false;
    }

    if (Number(payload.deviceId) === Number(selectedDeviceId)) {
      return true;
    }

    var sourceKey = normalizeDeviceKey(payload.sourceDeviceId);
    if (sourceKey && sourceKey === selectedDeviceKey) {
      return true;
    }

    var nameKey = normalizeDeviceKey(payload.deviceName);
    if (nameKey && nameKey === selectedDeviceKey) {
      return true;
    }

    return false;
  }

  function toIso(dateTimeLocalValue) {
    return normalizeNaiveDateTimeString(dateTimeLocalValue);
  }

  function formatDateOnly(date) {
    var year = date.getFullYear();
    var month = String(date.getMonth() + 1).padStart(2, "0");
    var day = String(date.getDate()).padStart(2, "0");
    return year + "-" + month + "-" + day;
  }

  function formatTimeOnly(date) {
    var hours = String(date.getHours()).padStart(2, "0");
    var minutes = String(date.getMinutes()).padStart(2, "0");
    return hours + ":" + minutes;
  }

  function formatLocalDateTime(value) {
    var normalized = normalizeAnyDateTimeString(value);
    if (normalized) {
      return normalized.replace("T", " ");
    }

    return formatNaiveDateTimeMs(value, true);
  }

  function buildSameDayRange(dayValue, fromTimeValue, toTimeValue) {
    var day = String(dayValue || "").trim();
    var fromTime = String(fromTimeValue || "").trim();
    var toTime = String(toTimeValue || "").trim();

    if (!day || !fromTime || !toTime) {
      throw new Error("اليوم ووقت البداية ووقت النهاية حقول مطلوبة");
    }

    if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) {
      throw new Error("قيمة اليوم غير صالحة");
    }

    if (!/^\d{2}:\d{2}$/.test(fromTime) || !/^\d{2}:\d{2}$/.test(toTime)) {
      throw new Error("قيمة الوقت غير صالحة");
    }

    var fromLocal = day + "T" + fromTime;
    var toLocal = day + "T" + toTime;

    if (new Date(fromLocal).getTime() > new Date(toLocal).getTime()) {
      throw new Error("وقت البداية يجب أن يكون قبل أو يساوي وقت النهاية");
    }

    return {
      fromLocal: fromLocal,
      toLocal: toLocal
    };
  }

  async function apiRequest(path, options) {
    var requestOptions = options || {};
    var headers = requestOptions.headers || {};
    headers.Authorization = "Bearer " + token;

    if (requestOptions.body && !headers["Content-Type"]) {
      headers["Content-Type"] = "application/json";
    }

    var response = await fetch(path, {
      method: requestOptions.method || "GET",
      headers: {
        Authorization: headers.Authorization,
        "Content-Type": headers["Content-Type"] || undefined
      },
      body: requestOptions.body
    });

    var data = null;
    try {
      data = await response.json();
    } catch (_error) {
      data = null;
    }

    if (response.status === 401) {
      localStorage.removeItem("token");
      localStorage.removeItem("user");
      window.location.href = "/login";
      throw new Error("انتهت الجلسة");
    }

    if (!response.ok) {
      throw new Error((data && data.message) || "فشل تنفيذ الطلب");
    }

    return data;
  }

  function activateTab(tabName) {
    if (!isAdmin && (tabName === "users" || tabName === "devices")) {
      tabName = "history";
    }

    tabButtons.forEach(function (btn) {
      var active = btn.getAttribute("data-tab") === tabName;
      btn.classList.toggle("active", active);
    });

    historyPanel.classList.toggle("active", tabName === "history");
    mapPanel.classList.toggle("active", tabName === "map");
    statisticsPanel.classList.toggle("active", tabName === "statistics");
    usersPanel.classList.toggle("active", tabName === "users");
    devicesPanel.classList.toggle("active", tabName === "devices");
    rightPanel.classList.toggle("right-panel--hidden", tabName !== "history");
    setGlobalMessage("", false);
  }

  function emitDashboardBridgeEvent(name, detail) {
    if (typeof window === "undefined" || typeof window.dispatchEvent !== "function") {
      return;
    }

    window.dispatchEvent(new CustomEvent(name, { detail: detail || {} }));
  }

  topNav.addEventListener("click", function (event) {
    var target = event.target;
    if (!(target instanceof HTMLElement)) {
      return;
    }
    var tabName = target.getAttribute("data-tab");
    if (!tabName) {
      return;
    }
    activateTab(tabName);
  });

  function setActiveDevice(deviceId) {
    if (deviceListEl instanceof HTMLSelectElement) {
      deviceListEl.value = String(deviceId);
    }
  }

  function renderLatestPacket(options) {
    var renderOptions = options || {};
    updateFollowLiveButtonState();
    probeTooltipEl.classList.add("hidden");
    if (!currentPackets.length) {
      historyInfoEl.textContent = "لا توجد بيانات للجهاز المحدد.";
      if (historyTableBody) {
        historyTableBody.innerHTML = "";
      }
      lastRenderMeta = null;
      renderedTimeMarkerHits = [];
      gapTooltipEl.classList.add("hidden");
      clearSpectrogramCanvas("لا توجد بيانات للجهاز المحدد.");
      return;
    }

    var fromMs;
    var toMs;
    if (liveFollowEnabled && !liveManualBrowseActive) {
      syncLatestLiveViewport();
      toMs = viewportToMs;
      fromMs = viewportFromMs;

      // Keep only recent packets in memory for the rolling live view window.
      currentPackets = currentPackets.filter(function (packet) {
        var packetEnd = getPacketEndMs(packet);
        return Number.isFinite(packetEnd) && packetEnd >= fromMs;
      });
    } else if (Number.isFinite(viewportFromMs) && Number.isFinite(viewportToMs)) {
      fromMs = viewportFromMs;
      toMs = viewportToMs;
    } else {
      fromMs = parseFlexibleTimeMs(activeFromIso);
      toMs = parseFlexibleTimeMs(activeToIso);
      viewportFromMs = fromMs;
      viewportToMs = toMs;
    }

    if (!Number.isFinite(fromMs) || !Number.isFinite(toMs) || toMs <= fromMs) {
      lastRenderMeta = null;
      renderedTimeMarkerHits = [];
      gapTooltipEl.classList.add("hidden");
      clearSpectrogramCanvas("لا توجد بيانات للجهاز المحدد.");
      return;
    }

    var visiblePackets = getVisiblePackets(fromMs, toMs);
    var displayFrequencyRange = parseDisplayFrequencyRange();

    var minFrequency = null;
    var maxFrequency = null;
    var frequencyBins = null;
    var effectivePacketBins = null;
    var intensityType = null;

    var hasConfiguredDeviceRange =
      Number.isFinite(selectedDeviceMinFrequency) &&
      Number.isFinite(selectedDeviceMaxFrequency) &&
      selectedDeviceMaxFrequency > selectedDeviceMinFrequency;

    if (hasConfiguredDeviceRange) {
      minFrequency = selectedDeviceMinFrequency;
      maxFrequency = selectedDeviceMaxFrequency;
      effectivePacketBins = null;
    } else {
      for (var i = 0; i < visiblePackets.length; i += 1) {
        var packet = visiblePackets[i];
        var packetBins = getPacketFrequencyBins(packet);
        if (packetBins && packetBins.length > 1) {
          frequencyBins = packetBins;
          minFrequency = packetBins[0];
          maxFrequency = packetBins[packetBins.length - 1];
          if (maxFrequency > minFrequency) {
            effectivePacketBins = frequencyBins;
            break;
          }
        }

        if (
          Number.isFinite(packet.minFrequency) &&
          Number.isFinite(packet.maxFrequency) &&
          packet.maxFrequency > packet.minFrequency
        ) {
          minFrequency = packet.minFrequency;
          maxFrequency = packet.maxFrequency;
          break;
        }
        if (
          Number.isFinite(packet.frequencyMin) &&
          Number.isFinite(packet.frequencyMax) &&
          packet.frequencyMax > packet.frequencyMin
        ) {
          minFrequency = packet.frequencyMin;
          maxFrequency = packet.frequencyMax;
          break;
        }

        var packetSampleRate = Number(packet.sampleRate || packet.sample_rate);
        if (Number.isFinite(packetSampleRate) && packetSampleRate > 0) {
          minFrequency = 0;
          maxFrequency = packetSampleRate / 2;
          break;
        }
      }

      if (
        (!Number.isFinite(minFrequency) || !Number.isFinite(maxFrequency) || maxFrequency <= minFrequency) &&
        Number.isFinite(selectedDeviceMinFrequency) &&
        Number.isFinite(selectedDeviceMaxFrequency) &&
        selectedDeviceMaxFrequency > selectedDeviceMinFrequency
      ) {
        minFrequency = selectedDeviceMinFrequency;
        maxFrequency = selectedDeviceMaxFrequency;
      }

      effectivePacketBins = frequencyBins;
    }

    for (var j = 0; j < visiblePackets.length; j += 1) {
      if (typeof visiblePackets[j].intensityType === "string") {
        intensityType = visiblePackets[j].intensityType;
        break;
      }
    }

    var renderFn =
      activeLogFrequencyView &&
      window.LogSpectrogram &&
      typeof window.LogSpectrogram.renderLogSpectrogram === "function"
        ? window.LogSpectrogram.renderLogSpectrogram
        : window.Spectrogram.renderSpectrogram;

    var renderOptionsPayload = {
      canvas: canvas,
      legendCanvas: legendCanvas,
      blocks: visiblePackets,
      from: formatNaiveDateTimeMs(fromMs, true),
      to: formatNaiveDateTimeMs(toMs, true),
      fastMode: !!renderOptions.skipTable,
      assumeSorted: true,
      intensityMode: activeIntensityMode,
      dbMin: activeDbMin,
      dbMax: activeDbMax,
      percentileLow: activePercentileLow,
      percentileHigh: activePercentileHigh,
      compareView: activeCompareView,
      noiseSuppressionEnabled: activeNoiseSuppressionEnabled,
      noiseFloorPercentile: activeNoiseFloorPercentile,
      noiseThreshold: activeNoiseThreshold,
      isolatedPixelRemovalEnabled: activeIsolatedPixelRemovalEnabled,
      minActiveNeighbors: activeMinActiveNeighbors,
      neighborhoodSize: activeNeighborhoodSize,
      bucketAggregation: activeBucketAggregation,
      debugStatsEnabled: activeDebugStatsEnabled,
      intensityType: intensityType,
      displayGainDb: activeDisplayGainDb,
      frequencyBins: effectivePacketBins,
      minFrequency: minFrequency,
      maxFrequency: maxFrequency,
      displayMinFrequency: displayFrequencyRange ? displayFrequencyRange.min : null,
      displayMaxFrequency: displayFrequencyRange ? displayFrequencyRange.max : null
    };

    var renderResult = renderFn(renderOptionsPayload);

    var drawFrequencyAxisLabelsFn =
      activeLogFrequencyView &&
      window.LogFrequencyLabels &&
      typeof window.LogFrequencyLabels.drawLogFrequencyAxisLabels === "function"
        ? window.LogFrequencyLabels.drawLogFrequencyAxisLabels
        : null;

    if (drawFrequencyAxisLabelsFn && renderResult && renderResult.layout) {
      var labelMinFrequency = displayFrequencyRange ? displayFrequencyRange.min : minFrequency;
      var labelMaxFrequency = displayFrequencyRange ? displayFrequencyRange.max : maxFrequency;
      if (Number.isFinite(labelMinFrequency) && Number.isFinite(labelMaxFrequency) && labelMaxFrequency > labelMinFrequency) {
        var canvasContext = canvas.getContext("2d");
        drawFrequencyAxisLabelsFn(canvasContext, labelMinFrequency, labelMaxFrequency, renderResult.layout);
      }
    }

    lastRenderMeta = renderResult || null;
    drawTimeMarkersOverlay();

    if (renderResult) {
      var selectedScaleText = activeIntensityMode;
      var effectiveScaleText = renderResult.intensityMode || activeIntensityMode;
      var selectedViewText = activeCompareView;
      var effectiveViewText = renderResult.compareView || activeCompareView;
      var infoText =
        "المقياس المختار: " +
        selectedScaleText +
        " | الفعلي: " +
        effectiveScaleText +
        " | العرض المختار: " +
        selectedViewText +
        " | الفعلي: " +
        effectiveViewText +
        " | نوع الشدة: " +
        (renderResult.intensityType || "صورة");

      var isScaleFallback = selectedScaleText !== effectiveScaleText;
      if (isScaleFallback) {
        infoText += " | ملاحظة: أنماط dB تُتجاهل عند إدخال شدة من نوع صورة";
      }
      setProcessingStatus(infoText, isScaleFallback);
    }

    var gapInfo = " | الفجوات: 0";
    if (renderResult && Array.isArray(renderResult.gaps) && renderResult.gaps.length > 0) {
      var firstGap = renderResult.gaps[0];
      var mins = Math.round(firstGap.durationMs / 60000);
      gapInfo =
        " | الفجوات: " +
        renderResult.gaps.length +
        " (الأولى: " +
        formatLocalDateTime(firstGap.start) +
        " -> " +
        formatLocalDateTime(firstGap.end) +
        ", " +
        mins +
        "د)";
    }

    if (displayFrequencyRange) {
      historyInfoEl.textContent +=
        " | التردد العمودي: " +
        Math.round(displayFrequencyRange.min) +
        "-" +
        Math.round(displayFrequencyRange.max) +
        " Hz";
    }

    if (renderOptions.skipTable) {
      return;
    }

    if (renderResult && renderResult.hasRealFrequency) {
      historyInfoEl.textContent = historyInfoEl.textContent + " | محور التردد: Hz";
    } else {
      historyInfoEl.textContent = historyInfoEl.textContent + " | محور التردد: نطاقات فقط (أضف sampleRate / minFrequency / maxFrequency لعرض Hz)";
    }

    if (activeDebugStatsEnabled && renderResult && renderResult.debugStats) {
      var s = renderResult.debugStats;
      historyInfoEl.textContent =
        historyInfoEl.textContent +
        " | Stage=" +
        (renderResult.compareView || activeCompareView) +
        " | min=" +
        s.min.toFixed(4) +
        " max=" +
        s.max.toFixed(4) +
        " mean=" +
        s.mean.toFixed(4) +
        " median=" +
        s.median.toFixed(4) +
        " p50=" +
        s.p50.toFixed(4) +
        " p75=" +
        s.p75.toFixed(4) +
        " p90=" +
        s.p90.toFixed(4) +
        " p95=" +
        s.p95.toFixed(4) +
        " p99=" +
        s.p99.toFixed(4) +
        " thr=" +
        s.selectedNoiseThreshold.toFixed(4) +
        " removed=" +
        s.removedPercent.toFixed(2) +
        "%";
    }

    if (historyTableBody) {
      historyTableBody.innerHTML = "";
      visiblePackets.forEach(function (packet) {
        var startLocal = formatLocalDateTime(packet.startTime || packet.start_time || packet.timestamp);
        var endLocal = formatLocalDateTime(packet.endTime || packet.end_time || packet.timestamp);
        var durationMin = Math.max(
          0,
          Math.round(
            (getPacketEndMs(packet) - getPacketStartMs(packet)) / 60000
          )
        );

        var tr = document.createElement("tr");
        tr.innerHTML =
          "<td>" +
          (packet.id || "-") +
          "</td><td>" +
          startLocal +
          "</td><td>" +
          endLocal +
          "</td><td>" +
          durationMin +
          " د" +
          "</td>";
        historyTableBody.appendChild(tr);
      });
    }
  }

  function formatMarkerLabelTime(timeMs) {
    return formatNaiveDateTimeMs(timeMs, true);
  }

  function drawTimeMarkersOverlay() {
    renderedTimeMarkerHits = [];
    if (!lastRenderMeta || !lastRenderMeta.layout) {
      return;
    }

    if (!Number.isFinite(lastRenderMeta.fromMs) || !Number.isFinite(lastRenderMeta.toMs)) {
      return;
    }

    var layout = lastRenderMeta.layout;
    var range = lastRenderMeta.toMs - lastRenderMeta.fromMs;
    if (!Number.isFinite(range) || range <= 0) {
      return;
    }

    var ctx = canvas.getContext("2d");
    if (!ctx) {
      return;
    }

    ctx.save();
    ctx.strokeStyle = "rgba(255, 214, 10, 0.95)";
    ctx.fillStyle = "rgba(255, 214, 10, 0.95)";
    ctx.lineWidth = 1.2;
    ctx.font = "bold 15px Segoe UI";
    ctx.textAlign = "center";
    ctx.textBaseline = "bottom";

    var baseBoxTop = layout.plotTop + 34;
    var laneGap = 8;
    var laneRightEdges = [];
    var visibleMarkers = [];

    for (var i = 0; i < timeMarkers.length; i += 1) {
      var marker = timeMarkers[i];
      var timeMs = Number(marker && marker.timeMs);
      if (!Number.isFinite(timeMs)) {
        continue;
      }

      var xFrac = (timeMs - lastRenderMeta.fromMs) / range;
      var x = layout.plotLeft + xFrac * (layout.plotRight - layout.plotLeft);
      if (x < layout.plotLeft || x > layout.plotRight) {
        continue;
      }

      ctx.beginPath();
      ctx.moveTo(x + 0.5, layout.plotBottom);
      ctx.lineTo(x + 0.5, layout.plotTop);
      ctx.stroke();

      var label = formatMarkerLabelTime(timeMs);
      var textWidth = ctx.measureText(label).width;
      var boxPaddingX = 10;
      var boxHeight = 27;
      var boxWidth = Math.max(40, Math.round(textWidth + boxPaddingX * 2));

      visibleMarkers.push({
        markerIndex: i,
        x: x,
        label: label,
        boxWidth: boxWidth,
        boxHeight: boxHeight
      });
    }

    visibleMarkers.sort(function (a, b) {
      return a.x - b.x;
    });

    for (var vm = 0; vm < visibleMarkers.length; vm += 1) {
      var visibleMarker = visibleMarkers[vm];
      var rawBoxLeft = visibleMarker.x - visibleMarker.boxWidth / 2;
      var boxLeft = clamp(rawBoxLeft, layout.plotLeft, layout.plotRight - visibleMarker.boxWidth);
      var laneIndex = 0;
      while (laneIndex < laneRightEdges.length && boxLeft <= laneRightEdges[laneIndex] + 6) {
        laneIndex += 1;
      }
      if (laneIndex === laneRightEdges.length) {
        laneRightEdges.push(boxLeft + visibleMarker.boxWidth);
      } else {
        laneRightEdges[laneIndex] = boxLeft + visibleMarker.boxWidth;
      }

      var boxTop = baseBoxTop + laneIndex * (visibleMarker.boxHeight + laneGap);

      ctx.fillStyle = "rgba(18, 22, 30, 0.86)";
      ctx.fillRect(boxLeft, boxTop, visibleMarker.boxWidth, visibleMarker.boxHeight);
      ctx.strokeStyle = "rgba(255, 214, 10, 0.95)";
      ctx.strokeRect(boxLeft + 0.5, boxTop + 0.5, visibleMarker.boxWidth - 1, visibleMarker.boxHeight - 1);
      ctx.fillStyle = "rgba(255, 238, 142, 1)";
      ctx.fillText(
        visibleMarker.label,
        boxLeft + visibleMarker.boxWidth / 2,
        boxTop + visibleMarker.boxHeight - 6
      );

      renderedTimeMarkerHits.push({
        markerIndex: visibleMarker.markerIndex,
        lineX: visibleMarker.x,
        lineTop: layout.plotTop,
        lineBottom: layout.plotBottom,
        labelLeft: boxLeft,
        labelTop: boxTop,
        labelRight: boxLeft + visibleMarker.boxWidth,
        labelBottom: boxTop + visibleMarker.boxHeight
      });

      ctx.strokeStyle = "rgba(255, 214, 10, 0.95)";
      ctx.fillStyle = "rgba(255, 214, 10, 0.95)";
    }

    ctx.restore();
  }

  function findMarkerHitAtCanvasPoint(event) {
    if (!renderedTimeMarkerHits.length) {
      return null;
    }

    var rect = canvas.getBoundingClientRect();
    var x = event.clientX - rect.left;
    var y = event.clientY - rect.top;

    for (var i = renderedTimeMarkerHits.length - 1; i >= 0; i -= 1) {
      var hit = renderedTimeMarkerHits[i];
      var onLabel =
        x >= hit.labelLeft && x <= hit.labelRight && y >= hit.labelTop && y <= hit.labelBottom;
      var onLine =
        Math.abs(x - hit.lineX) <= 4 && y >= hit.lineTop && y <= hit.lineBottom;

      if (onLabel || onLine) {
        return hit;
      }
    }

    return null;
  }

  function removeTimeMarkerAtCanvasPoint(event) {
    var hit = findMarkerHitAtCanvasPoint(event);
    if (!hit) {
      return false;
    }

    if (hit.markerIndex >= 0 && hit.markerIndex < timeMarkers.length) {
      timeMarkers.splice(hit.markerIndex, 1);
      scheduleRender({ skipTable: true });
      return true;
    }

    return false;
  }

  function addTimeMarkerFromEvent(event) {
    if (!lastRenderMeta || !lastRenderMeta.layout) {
      return false;
    }

    if (!Number.isFinite(lastRenderMeta.fromMs) || !Number.isFinite(lastRenderMeta.toMs)) {
      return false;
    }

    var rect = canvas.getBoundingClientRect();
    var x = event.clientX - rect.left;
    var layout = lastRenderMeta.layout;
    if (x < layout.plotLeft || x > layout.plotRight) {
      return false;
    }

    var span = lastRenderMeta.toMs - lastRenderMeta.fromMs;
    if (!Number.isFinite(span) || span <= 0) {
      return false;
    }

    var xFrac = (x - layout.plotLeft) / Math.max(1e-9, layout.plotRight - layout.plotLeft);
    var timeMs = lastRenderMeta.fromMs + xFrac * span;
    timeMarkers.push({ timeMs: timeMs });
    scheduleRender({ skipTable: true });
    return true;
  }

  function updateFollowLiveButtonState() {
    var isActive = !!liveFollowEnabled;
    followLiveBtn.classList.toggle("follow-live-active", isActive);
    followLiveBtn.setAttribute("aria-pressed", isActive ? "true" : "false");
  }

  function scheduleRender(options) {
    pendingRenderOptions = Object.assign({}, pendingRenderOptions || {}, options || {});
    if (renderRafId !== null) {
      return;
    }

    renderRafId = window.requestAnimationFrame(function () {
      renderRafId = null;
      var opts = pendingRenderOptions || {};
      pendingRenderOptions = null;
      renderLatestPacket(opts);
      if (expectingLiveRender) {
        expectingLiveRender = false;
        markLiveTrace("rendered", { renderAtMs: Date.now() });
      }
    });
  }

  function markInteractionActive() {
    if (interactionEndTimer) {
      clearTimeout(interactionEndTimer);
    }

    interactionEndTimer = setTimeout(function () {
      interactionEndTimer = null;
      scheduleRender({ skipTable: false });
    }, 130);
  }

  function insertPacketSorted(packet) {
    normalizePacketTiming(packet);
    var packetTime = getPacketStartMs(packet);
    if (!Number.isFinite(packetTime)) {
      return false;
    }

    var packetKey = getPacketKey(packet);
    if (packetKey && currentPacketKeys.has(packetKey)) {
      return false;
    }

    var low = 0;
    var high = currentPackets.length;
    while (low < high) {
      var mid = Math.floor((low + high) / 2);
      var midTime = getPacketStartMs(currentPackets[mid]);
      if (!Number.isFinite(midTime) || packetTime < midTime) {
        high = mid;
      } else {
        low = mid + 1;
      }
    }

    currentPackets.splice(low, 0, packet);
    if (packetKey) {
      currentPacketKeys.add(packetKey);
    }

    if (currentPackets.length > MAX_PACKETS_IN_MEMORY) {
      var overflow = currentPackets.length - MAX_PACKETS_IN_MEMORY;
      var removed = currentPackets.splice(0, overflow);
      for (var r = 0; r < removed.length; r += 1) {
        var removedKey = getPacketKey(removed[r]);
        if (removedKey) {
          currentPacketKeys.delete(removedKey);
        }
      }
    }

    return true;
  }

  function getLatestPacketEndMs() {
    if (!currentPackets.length) {
      return NaN;
    }

    var latest = currentPackets[currentPackets.length - 1];
    var endMs = getPacketEndMs(latest);
    if (Number.isFinite(endMs)) {
      return endMs;
    }

    var startMs = getPacketStartMs(latest);
    if (Number.isFinite(startMs)) {
      return startMs;
    }

    return getPacketTimestampMs(latest);
  }

  function syncLatestLiveViewport(anchorMs) {
    var latestToMs = Number.isFinite(anchorMs) ? anchorMs : getLatestPacketEndMs();
    if (!Number.isFinite(latestToMs)) {
      latestToMs = Date.now();
    }
    var latestFromMs = latestToMs - currentLiveWindowMs;
    activeRangeMode = currentLiveWindowMs === ONE_HOUR_WINDOW_MS ? "latest1h" : "latest30m";
    activeFromIso = formatNaiveDateTimeMs(latestFromMs, true);
    activeToIso = formatNaiveDateTimeMs(latestToMs, true);
    viewportFromMs = latestFromMs;
    viewportToMs = latestToMs;
    followLatest24 = true;
  }

  function getCurrentViewSpanMs() {
    if (!Number.isFinite(viewportFromMs) || !Number.isFinite(viewportToMs)) {
      return null;
    }
    return viewportToMs - viewportFromMs;
  }

  function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
  }

  function clearSpectrogramCanvas(message) {
    var ctx = canvas.getContext("2d");
    if (!ctx) {
      return;
    }

    var dpr = window.devicePixelRatio || 1;
    var cssWidth = Math.max(480, Math.floor(canvas.clientWidth || 960));
    var cssHeight = Math.max(420, Math.floor((canvas.clientWidth || 960) * 0.62));
    canvas.width = Math.floor(cssWidth * dpr);
    canvas.height = Math.floor(cssHeight * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    ctx.fillStyle = "#140d28";
    ctx.fillRect(0, 0, cssWidth, cssHeight);

    if (message) {
      ctx.fillStyle = "#d8e2ff";
      ctx.font = "16px Segoe UI";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(message, cssWidth / 2, cssHeight / 2);
    }

      window.Spectrogram.drawLegend(legendCanvas);
  }

  function isTypingTarget(target) {
    if (!(target instanceof HTMLElement)) {
      return false;
    }

    var tagName = target.tagName;
    return tagName === "INPUT" || tagName === "TEXTAREA" || tagName === "SELECT" || target.isContentEditable;
  }

  function getPacketInterval(packet) {
    var startMs = getPacketStartMs(packet);
    var endMs = getPacketEndMs(packet);

    if (!Number.isFinite(startMs) || !Number.isFinite(endMs)) {
      return null;
    }

    if (endMs < startMs) {
      var swap = startMs;
      startMs = endMs;
      endMs = swap;
    }

    return { startMs: startMs, endMs: endMs };
  }

  function findFirstVisiblePacketIndex(packets, fromMs) {
    var low = 0;
    var high = packets.length - 1;
    var result = packets.length;

    while (low <= high) {
      var mid = Math.floor((low + high) / 2);
      var packetEnd = getPacketEndMs(packets[mid]);
      if (!Number.isFinite(packetEnd) || packetEnd >= fromMs) {
        result = mid;
        high = mid - 1;
      } else {
        low = mid + 1;
      }
    }

    return result;
  }

  function findLastVisiblePacketIndex(packets, toMs) {
    var low = 0;
    var high = packets.length - 1;
    var result = -1;

    while (low <= high) {
      var mid = Math.floor((low + high) / 2);
      var packetStart = getPacketStartMs(packets[mid]);
      if (!Number.isFinite(packetStart) || packetStart <= toMs) {
        result = mid;
        low = mid + 1;
      } else {
        high = mid - 1;
      }
    }

    return result;
  }

  function getVisiblePackets(fromMs, toMs) {
    if (!currentPackets.length) {
      return [];
    }

    var startIndex = findFirstVisiblePacketIndex(currentPackets, fromMs);
    var endIndex = findLastVisiblePacketIndex(currentPackets, toMs);
    if (startIndex > endIndex || startIndex >= currentPackets.length || endIndex < 0) {
      return [];
    }

    return currentPackets.slice(startIndex, endIndex + 1);
  }

  function fitViewportToPackets() {
    if (!currentPackets.length) {
      return;
    }

    var minStart = Number.POSITIVE_INFINITY;
    var maxEnd = Number.NEGATIVE_INFINITY;

    for (var i = 0; i < currentPackets.length; i += 1) {
      var interval = getPacketInterval(currentPackets[i]);
      if (!interval) {
        continue;
      }

      if (interval.startMs < minStart) {
        minStart = interval.startMs;
      }
      if (interval.endMs > maxEnd) {
        maxEnd = interval.endMs;
      }
    }

    if (!Number.isFinite(minStart) || !Number.isFinite(maxEnd) || maxEnd <= minStart) {
      return;
    }

    liveManualBrowseActive = true;
    var padding = Math.max(60 * 1000, Math.round((maxEnd - minStart) * 0.04));
    viewportFromMs = minStart - padding;
    viewportToMs = maxEnd + padding;
    activeFromIso = formatNaiveDateTimeMs(viewportFromMs, true);
    activeToIso = formatNaiveDateTimeMs(viewportToMs, true);
    scheduleRender({ skipTable: false });
  }

  function panViewport(direction, ratio) {
    var span = getCurrentViewSpanMs();
    if (!span || span <= 0) {
      return;
    }

    liveManualBrowseActive = true;
    var panRatio = Number.isFinite(ratio) && ratio > 0 ? ratio : 0.2;
    var shift = Math.max(30 * 1000, Math.round(span * panRatio));
    viewportFromMs += direction * shift;
    viewportToMs += direction * shift;
    scheduleRender({ skipTable: false });
  }

  function zoomViewport(factor) {
    zoomViewportAt(factor, 0.5);
  }

  function bindHoldAction(button, action) {
    var repeatTimer = null;
    var startTimer = null;

    function clearTimers() {
      if (startTimer) {
        clearTimeout(startTimer);
        startTimer = null;
      }
      if (repeatTimer) {
        clearInterval(repeatTimer);
        repeatTimer = null;
      }
    }

    function triggerAndHold(event) {
      if (event) {
        event.preventDefault();
      }
      action();
      clearTimers();
      startTimer = setTimeout(function () {
        repeatTimer = setInterval(action, 60);
      }, 260);
    }

    button.addEventListener("mousedown", triggerAndHold);
    button.addEventListener("mouseleave", clearTimers);
    button.addEventListener("mouseup", clearTimers);
    button.addEventListener("touchstart", triggerAndHold, { passive: false });
    button.addEventListener("touchend", clearTimers);
    button.addEventListener("touchcancel", clearTimers);
    window.addEventListener("mouseup", clearTimers);
  }

  function zoomViewportAt(factor, anchorFraction) {
    var span = getCurrentViewSpanMs();
    if (!span || span <= 0) {
      return;
    }

    liveManualBrowseActive = true;
    var anchor = clamp(anchorFraction, 0, 1);
    var anchorTime = viewportFromMs + span * anchor;
    var newSpan = Math.round(span * factor);
    var minSpan = 60 * 1000;
    var maxSpan = 7 * 24 * 60 * 60 * 1000;
    newSpan = Math.max(minSpan, Math.min(maxSpan, newSpan));

    viewportFromMs = anchorTime - newSpan * anchor;
    viewportToMs = viewportFromMs + newSpan;
    scheduleRender({ skipTable: true });
    markInteractionActive();
  }

  function resetViewport() {
    if (liveFollowEnabled) {
      followLatest24 = true;
      liveFollowEnabled = true;
      liveManualBrowseActive = false;
      scheduleRender({ skipTable: false });
      return;
    }

    if (activeFromIso && activeToIso) {
      followLatest24 = false;
      viewportFromMs = new Date(activeFromIso).getTime();
      viewportToMs = new Date(activeToIso).getTime();
      scheduleRender({ skipTable: false });
    }
  }

  async function loadDeviceHistory(deviceId, fromIso, toIsoValue, loadOptions) {
    var endpoint = "/api/devices/" + deviceId + "/history";
    var nowMs = Date.now();
    var options = loadOptions || {};

    if (fromIso && toIsoValue) {
      var requestedFromMs = new Date(fromIso).getTime();
      var requestedToMs = new Date(toIsoValue).getTime();
      if (!Number.isFinite(requestedFromMs) || !Number.isFinite(requestedToMs) || requestedToMs <= requestedFromMs) {
        throw new Error("Invalid time range");
      }

      var effectiveToMs = Math.min(requestedToMs, nowMs);
      var effectiveFromMs = requestedFromMs;
      var clampedByNow = effectiveToMs !== requestedToMs;

      if (effectiveToMs - effectiveFromMs > MAX_LOAD_WINDOW_MS) {
        effectiveFromMs = effectiveToMs - MAX_LOAD_WINDOW_MS;
      }

      if (!(effectiveToMs > effectiveFromMs)) {
        throw new Error("Requested range is outside the allowed window.");
      }

      var effectiveFromIso = formatNaiveDateTimeMs(effectiveFromMs, true);
      var effectiveToIso = formatNaiveDateTimeMs(effectiveToMs, true);

      if (effectiveFromMs !== requestedFromMs || clampedByNow) {
        setGlobalMessage("تم تقييد النطاق إلى 24 ساعة كحد أقصى وحتى الوقت الحالي.", false);
      }

      endpoint += "?from=" + encodeURIComponent(effectiveFromIso) + "&to=" + encodeURIComponent(effectiveToIso);
      activeRangeMode = "custom";
      activeFromIso = effectiveFromIso;
      activeToIso = effectiveToIso;
      viewportFromMs = effectiveFromMs;
      viewportToMs = effectiveToMs;
      followLatest24 = false;
      liveFollowEnabled = false;
      liveManualBrowseActive = false;
    } else {
      var liveWindowMs = Number(options.liveWindowMs);
      if (!Number.isFinite(liveWindowMs) || liveWindowMs <= 0) {
        liveWindowMs = currentLiveWindowMs;
      }
      if (!Number.isFinite(liveWindowMs) || liveWindowMs <= 0) {
        liveWindowMs = DEFAULT_LIVE_WINDOW_MS;
      }

      currentLiveWindowMs = liveWindowMs;
      LIVE_WINDOW_LABEL = currentLiveWindowMs === ONE_HOUR_WINDOW_MS ? "آخر ساعة" : "آخر 30 دقيقة";
      activeRangeMode =
        typeof options.modeLabel === "string" && options.modeLabel.trim().length > 0
          ? options.modeLabel.trim()
          : currentLiveWindowMs === ONE_HOUR_WINDOW_MS
            ? "latest1h"
            : "latest30m";
      var latestToMs = nowMs;
      var latestFromMs = latestToMs - currentLiveWindowMs;
      activeFromIso = formatNaiveDateTimeMs(latestFromMs, true);
      activeToIso = formatNaiveDateTimeMs(latestToMs, true);
      followLatest24 = true;
      liveFollowEnabled = true;
      liveManualBrowseActive = false;
      viewportFromMs = latestFromMs;
      viewportToMs = latestToMs;
      endpoint += "?from=" + encodeURIComponent(activeFromIso) + "&to=" + encodeURIComponent(activeToIso);
    }

    var loadSequence = historyLoadSequence + 1;
    historyLoadSequence = loadSequence;
    isHistoryLoading = true;
    pendingLivePackets = [];

    currentPackets = [];
    rebuildPacketKeySet();
    lastRenderMeta = null;
    gapTooltipEl.classList.add("hidden");
    historyInfoEl.textContent = "جاري تحميل بيانات الجهاز المحدد...";
    if (historyTableBody) {
      historyTableBody.innerHTML = "";
    }
    setSpectrogramLoading(true);

    try {
      var snapshotPackets = await apiRequest(endpoint);
      if (loadSequence !== historyLoadSequence) {
        return;
      }

      currentPackets = decodePacketsMatrix(snapshotPackets);
      currentPackets.forEach(normalizePacketTiming);
      activeTimeStepMs = 1000;
      rebuildPacketKeySet();

      if (pendingLivePackets.length > 0) {
        var mergedCount = 0;
        for (var p = 0; p < pendingLivePackets.length; p += 1) {
          if (insertPacketSorted(pendingLivePackets[p])) {
            mergedCount += 1;
          }
        }
        if (mergedCount > 0) {
          expectingLiveRender = true;
          markLiveTrace("merged-from-buffer", { count: mergedCount });
        }
      }
      pendingLivePackets = [];

      if (activeRangeMode === "latest1h" || activeRangeMode === "latest30m") {
        followLatest24 = true;
        liveFollowEnabled = true;
        liveManualBrowseActive = false;
      }

      if (!currentPackets.length) {
        historyInfoEl.textContent = "لا توجد بيانات للجهاز المحدد.";
        selectedDeviceTitleEl.textContent = "الجهاز المحدد: " + selectedDeviceName + " (لا توجد بيانات)";
        sideDeviceInfoEl.textContent =
          "المعرّف: " +
          selectedDeviceId +
          " | الاسم: " +
          selectedDeviceName +
          " | الوصف: " +
          "لا توجد سجلات تاريخية لهذا الجهاز.";
        scheduleRender({ skipTable: false });
        return;
      }

      scheduleRender({ skipTable: false });
    } finally {
      if (loadSequence === historyLoadSequence) {
        isHistoryLoading = false;
      }
      setSpectrogramLoading(false);
    }
  }

  async function loadRecentHours(hours, label) {
    if (!selectedDeviceId) {
      setGlobalMessage("يرجى اختيار جهاز أولًا", true);
      return;
    }

    var range = getRecentRangeIso(hours);
    await loadDeviceHistory(selectedDeviceId, range.fromIso, range.toIso);
    setGlobalMessage((label || "Recent range") + " loaded for " + selectedDeviceName, false);
  }

  async function loadLatestPacketOnly() {
    if (!selectedDeviceId) {
      setGlobalMessage("يرجى اختيار جهاز أولًا", true);
      return;
    }

    var latestPacket;
    try {
      latestPacket = await fetchLatestPacketForDevice(selectedDeviceId);
    } catch (error) {
      var message = error instanceof Error ? error.message : "فشل تحميل آخر باكت";
      if (message === "No packets found for this device") {
        setGlobalMessage("لا توجد باكتات لهذا الجهاز حتى الآن", true);
        return;
      }
      throw error;
    }

    if (!latestPacket || typeof latestPacket !== "object") {
      setGlobalMessage("تعذر تحميل آخر باكت", true);
      return;
    }

    var latestStartMs = getPacketStartMs(latestPacket);
    var latestEndMs = getPacketEndMs(latestPacket);
    if (!Number.isFinite(latestStartMs)) {
      latestStartMs = getPacketTimestampMs(latestPacket);
    }
    if (!Number.isFinite(latestEndMs)) {
      latestEndMs = latestStartMs;
    }

    if (!Number.isFinite(latestStartMs)) {
      setGlobalMessage("تعذر تحديد وقت آخر باكت", true);
      return;
    }

    currentPackets = [latestPacket];
    rebuildPacketKeySet();

    var effectiveEnd = Number.isFinite(latestEndMs) && latestEndMs > latestStartMs ? latestEndMs : latestStartMs + 1000;
    activeRangeMode = "lastPacket";
    followLatest24 = false;
    liveFollowEnabled = false;
    liveManualBrowseActive = false;
    viewportFromMs = latestStartMs;
    viewportToMs = effectiveEnd;
    activeFromIso = formatNaiveDateTimeMs(viewportFromMs, true);
    activeToIso = formatNaiveDateTimeMs(viewportToMs, true);
    scheduleRender({ skipTable: false });
    setGlobalMessage("تم التركيز على آخر باكت.", false);
  }

  // =========================
  // Multi-View (up to 4 devices)
  // =========================
  function getDeviceById(deviceId) {
    return devicesCache.find(function (device) {
      return Number(device.id) === Number(deviceId);
    });
  }

  function updateMultiViewPickerLimit() {
    var checkboxes = multiViewDeviceOptions.querySelectorAll("input[type='checkbox']");
    var checkedCount = 0;

    checkboxes.forEach(function (checkbox) {
      if (checkbox.checked) {
        checkedCount += 1;
      }
    });

    var lockFurtherSelection = checkedCount >= 4;
    checkboxes.forEach(function (checkbox) {
      checkbox.disabled = lockFurtherSelection && !checkbox.checked;
    });
  }

  function getSelectedMultiViewDeviceIds() {
    var selected = [];
    var checkboxes = multiViewDeviceOptions.querySelectorAll("input[type='checkbox']");

    checkboxes.forEach(function (checkbox) {
      if (checkbox.checked) {
        selected.push(Number(checkbox.value));
      }
    });

    return selected.filter(function (value) {
      return Number.isFinite(value) && value > 0;
    });
  }

  function renderMultiViewPicker() {
    multiViewDeviceOptions.innerHTML = "";

    if (!Array.isArray(devicesCache) || devicesCache.length === 0) {
      var empty = document.createElement("p");
      empty.className = "history-info";
      empty.textContent = "لا توجد أجهزة متاحة.";
      empty.style.margin = "0";
      multiViewDeviceOptions.appendChild(empty);
      return;
    }

    devicesCache.forEach(function (device) {
      var row = document.createElement("label");
      row.style.display = "flex";
      row.style.alignItems = "center";
      row.style.gap = "8px";
      row.style.padding = "8px 10px";
      row.style.border = "1px solid #d8d8d0";
      row.style.borderRadius = "8px";
      row.style.background = "#fff";

      var checkbox = document.createElement("input");
      checkbox.type = "checkbox";
      checkbox.value = String(device.id);
      checkbox.addEventListener("change", updateMultiViewPickerLimit);

      var text = document.createElement("span");
      text.textContent = device.name;

      row.appendChild(checkbox);
      row.appendChild(text);
      multiViewDeviceOptions.appendChild(row);
    });

    updateMultiViewPickerLimit();
  }

  function openMultiViewPicker() {
    renderMultiViewPicker();
    multiViewPickerModal.classList.remove("hidden");
    multiViewPickerModal.setAttribute("aria-hidden", "false");
  }

  function closeMultiViewPicker() {
    multiViewPickerModal.classList.add("hidden");
    multiViewPickerModal.setAttribute("aria-hidden", "true");
  }

  function clearMultiViewPanels() {
    Object.keys(multiViewPanels).forEach(function (panelKey) {
      var panel = multiViewPanels[panelKey];
      if (panel) {
        if (panel.wheelRenderTimer) {
          clearTimeout(panel.wheelRenderTimer);
          panel.wheelRenderTimer = null;
        }
        panel.packetBuffer = [];
        panel.lastPacket = null;
        panel.fullViewWindow = null;
        panel.viewWindow = null;
      }
      if (panel && typeof panel.cleanupInteractions === "function") {
        panel.cleanupInteractions();
      }
    });

    multiViewPanels = {};
    multiViewGrid.innerHTML = "";
  }

  function getPacketTimeRange(packet) {
    var fromMs = getPacketStartMs(packet);
    var toMs = getPacketEndMs(packet);
    if (!Number.isFinite(fromMs)) {
      fromMs = getPacketTimestampMs(packet);
    }
    if (!Number.isFinite(toMs)) {
      toMs = fromMs;
    }
    if (!Number.isFinite(fromMs)) {
      return null;
    }

    if (!Number.isFinite(toMs) || toMs <= fromMs) {
      toMs = fromMs + 1000;
    }

    return {
      fromMs: fromMs,
      toMs: toMs
    };
  }

  function getMultiViewPanelPacketKey(panel, packet) {
    if (!packet) {
      return "";
    }

    var deviceId = Number(packet.deviceId);
    if (!Number.isFinite(deviceId) && panel) {
      deviceId = Number(panel.deviceId);
    }

    var startMs = getPacketStartMs(packet);
    var endMs = getPacketEndMs(packet);
    var timeMs = getPacketTimestampMs(packet);
    if (!Number.isFinite(startMs)) {
      startMs = timeMs;
    }
    if (!Number.isFinite(endMs)) {
      endMs = startMs;
    }
    if (!Number.isFinite(deviceId) || !Number.isFinite(startMs) || !Number.isFinite(endMs)) {
      return "";
    }

    return String(deviceId) + "|" + String(startMs) + "|" + String(endMs);
  }

  function insertPacketIntoMultiViewBuffer(panel, packet) {
    if (!panel || !packet) {
      return;
    }

    if (!Array.isArray(panel.packetBuffer)) {
      panel.packetBuffer = [];
    }

    normalizePacketTiming(packet);
    var packetTime = getPacketStartMs(packet);
    if (!Number.isFinite(packetTime)) {
      return;
    }

    var packetKey = getMultiViewPanelPacketKey(panel, packet);
    if (packetKey) {
      for (var i = 0; i < panel.packetBuffer.length; i += 1) {
        if (getMultiViewPanelPacketKey(panel, panel.packetBuffer[i]) === packetKey) {
          panel.packetBuffer[i] = packet;
          return;
        }
      }
    }

    var low = 0;
    var high = panel.packetBuffer.length;
    while (low < high) {
      var mid = Math.floor((low + high) / 2);
      var midTime = getPacketStartMs(panel.packetBuffer[mid]);
      if (!Number.isFinite(midTime) || packetTime < midTime) {
        high = mid;
      } else {
        low = mid + 1;
      }
    }

    panel.packetBuffer.splice(low, 0, packet);
    while (panel.packetBuffer.length > MULTI_VIEW_PANEL_BUFFER_SIZE) {
      panel.packetBuffer.splice(0, panel.packetBuffer.length - MULTI_VIEW_PANEL_BUFFER_SIZE);
    }
  }

  function getMultiViewBufferedPackets(panel, packet) {
    var previewPanel = {
      deviceId: panel ? panel.deviceId : null,
      packetBuffer: panel && Array.isArray(panel.packetBuffer) ? panel.packetBuffer.slice() : []
    };
    insertPacketIntoMultiViewBuffer(previewPanel, packet);
    return previewPanel.packetBuffer;
  }

  function getMultiViewFullWindowFromPackets(device, packets) {
    if (!Array.isArray(packets) || !packets.length) {
      return null;
    }

    var fromMs = NaN;
    var toMs = NaN;
    var minFrequency = NaN;
    var maxFrequency = NaN;

    for (var i = 0; i < packets.length; i += 1) {
      var packet = packets[i];
      var range = getPacketTimeRange(packet);
      if (range) {
        if (!Number.isFinite(fromMs) || range.fromMs < fromMs) {
          fromMs = range.fromMs;
        }
        if (!Number.isFinite(toMs) || range.toMs > toMs) {
          toMs = range.toMs;
        }
      }

      var frequencyRange = resolvePacketFrequencyRange(device, packet, getPacketFrequencyBins(packet));
      if (!Number.isFinite(minFrequency) || frequencyRange.min < minFrequency) {
        minFrequency = frequencyRange.min;
      }
      if (!Number.isFinite(maxFrequency) || frequencyRange.max > maxFrequency) {
        maxFrequency = frequencyRange.max;
      }
    }

    if (!Number.isFinite(fromMs) || !Number.isFinite(toMs) || toMs <= fromMs) {
      return null;
    }

    return {
      fromMs: fromMs,
      toMs: toMs,
      minFrequency: minFrequency,
      maxFrequency: maxFrequency
    };
  }

  function resolvePacketFrequencyRange(device, packet, frequencyBins) {
    if (Array.isArray(frequencyBins) && frequencyBins.length > 1) {
      var minBin = Number(frequencyBins[0]);
      var maxBin = Number(frequencyBins[frequencyBins.length - 1]);
      if (Number.isFinite(minBin) && Number.isFinite(maxBin) && maxBin > minBin) {
        return { min: minBin, max: maxBin };
      }
    }

    var packetMin = Number(packet && (packet.minFrequency || packet.frequencyMin));
    var packetMax = Number(packet && (packet.maxFrequency || packet.frequencyMax));
    if (Number.isFinite(packetMin) && Number.isFinite(packetMax) && packetMax > packetMin) {
      return { min: packetMin, max: packetMax };
    }

    var deviceMin = Number(device && device.minFrequency);
    var deviceMax = Number(device && device.maxFrequency);
    if (Number.isFinite(deviceMin) && Number.isFinite(deviceMax) && deviceMax > deviceMin) {
      return { min: deviceMin, max: deviceMax };
    }

    return { min: 30, max: 8000 };
  }

  function cloneMultiViewWindow(viewWindow) {
    if (!viewWindow) {
      return null;
    }

    return {
      fromMs: Number(viewWindow.fromMs),
      toMs: Number(viewWindow.toMs),
      minFrequency: Number(viewWindow.minFrequency),
      maxFrequency: Number(viewWindow.maxFrequency)
    };
  }

  function clampWindowSegment(startValue, endValue, fullStart, fullEnd, minSpan) {
    var fullSpan = fullEnd - fullStart;
    if (!Number.isFinite(fullSpan) || fullSpan <= 0) {
      return { start: fullStart, end: fullEnd };
    }

    var nextMinSpan = Number.isFinite(minSpan) ? Math.max(1e-6, minSpan) : 1e-6;
    nextMinSpan = Math.min(fullSpan, nextMinSpan);

    var start = Number(startValue);
    var end = Number(endValue);
    var span = end - start;
    if (!Number.isFinite(start) || !Number.isFinite(end) || !Number.isFinite(span) || span <= 0) {
      start = fullStart;
      end = fullEnd;
      span = fullSpan;
    }

    span = clamp(span, nextMinSpan, fullSpan);

    var center = (start + end) / 2;
    if (!Number.isFinite(center)) {
      center = fullStart + fullSpan / 2;
    }

    start = center - span / 2;
    end = center + span / 2;

    if (start < fullStart) {
      end += fullStart - start;
      start = fullStart;
    }
    if (end > fullEnd) {
      start -= end - fullEnd;
      end = fullEnd;
    }
    if (start < fullStart) {
      start = fullStart;
    }
    if (end > fullEnd) {
      end = fullEnd;
    }

    return {
      start: start,
      end: end
    };
  }

  function normalizeMultiViewWindow(fullWindow, nextWindow) {
    if (!fullWindow) {
      return null;
    }

    var timeMinSpan = Math.max(250, (fullWindow.toMs - fullWindow.fromMs) * 0.03);
    var freqMinSpan = Math.max(1, (fullWindow.maxFrequency - fullWindow.minFrequency) * 0.03);
    var timeRange = clampWindowSegment(nextWindow && nextWindow.fromMs, nextWindow && nextWindow.toMs, fullWindow.fromMs, fullWindow.toMs, timeMinSpan);
    var freqRange = clampWindowSegment(
      nextWindow && nextWindow.minFrequency,
      nextWindow && nextWindow.maxFrequency,
      fullWindow.minFrequency,
      fullWindow.maxFrequency,
      freqMinSpan
    );

    return {
      fromMs: timeRange.start,
      toMs: timeRange.end,
      minFrequency: freqRange.start,
      maxFrequency: freqRange.end
    };
  }

  function isMultiViewWindowFull(viewWindow, fullWindow) {
    if (!viewWindow || !fullWindow) {
      return true;
    }

    return (
      Math.abs(viewWindow.fromMs - fullWindow.fromMs) < 1e-6 &&
      Math.abs(viewWindow.toMs - fullWindow.toMs) < 1e-6 &&
      Math.abs(viewWindow.minFrequency - fullWindow.minFrequency) < 1e-6 &&
      Math.abs(viewWindow.maxFrequency - fullWindow.maxFrequency) < 1e-6
    );
  }

  function remapMultiViewWindow(previousViewWindow, previousFullWindow, nextFullWindow) {
    if (!previousViewWindow || !previousFullWindow || !nextFullWindow) {
      return cloneMultiViewWindow(nextFullWindow);
    }

    var prevTimeSpan = previousFullWindow.toMs - previousFullWindow.fromMs;
    var prevFreqSpan = previousFullWindow.maxFrequency - previousFullWindow.minFrequency;
    if (!Number.isFinite(prevTimeSpan) || prevTimeSpan <= 0 || !Number.isFinite(prevFreqSpan) || prevFreqSpan <= 0) {
      return cloneMultiViewWindow(nextFullWindow);
    }

    var timeFromRatio = (previousViewWindow.fromMs - previousFullWindow.fromMs) / prevTimeSpan;
    var timeToRatio = (previousViewWindow.toMs - previousFullWindow.fromMs) / prevTimeSpan;
    var freqMinRatio = (previousViewWindow.minFrequency - previousFullWindow.minFrequency) / prevFreqSpan;
    var freqMaxRatio = (previousViewWindow.maxFrequency - previousFullWindow.minFrequency) / prevFreqSpan;

    if (!Number.isFinite(timeFromRatio)) {
      timeFromRatio = 0;
    }
    if (!Number.isFinite(timeToRatio)) {
      timeToRatio = 1;
    }
    if (!Number.isFinite(freqMinRatio)) {
      freqMinRatio = 0;
    }
    if (!Number.isFinite(freqMaxRatio)) {
      freqMaxRatio = 1;
    }

    timeFromRatio = clamp(timeFromRatio, 0, 1);
    timeToRatio = clamp(timeToRatio, 0, 1);
    freqMinRatio = clamp(freqMinRatio, 0, 1);
    freqMaxRatio = clamp(freqMaxRatio, 0, 1);

    if (timeToRatio <= timeFromRatio) {
      timeFromRatio = 0;
      timeToRatio = 1;
    }
    if (freqMaxRatio <= freqMinRatio) {
      freqMinRatio = 0;
      freqMaxRatio = 1;
    }

    var nextTimeSpan = nextFullWindow.toMs - nextFullWindow.fromMs;
    var nextFreqSpan = nextFullWindow.maxFrequency - nextFullWindow.minFrequency;

    return {
      fromMs: nextFullWindow.fromMs + nextTimeSpan * timeFromRatio,
      toMs: nextFullWindow.fromMs + nextTimeSpan * timeToRatio,
      minFrequency: nextFullWindow.minFrequency + nextFreqSpan * freqMinRatio,
      maxFrequency: nextFullWindow.minFrequency + nextFreqSpan * freqMaxRatio
    };
  }

  function updateMultiViewPanelCursor(panel) {
    if (!panel || !panel.canvas) {
      return;
    }

    if (panel.dragState && panel.dragState.active) {
      panel.canvas.style.cursor = "grabbing";
      return;
    }

    panel.canvas.style.cursor = isMultiViewWindowFull(panel.viewWindow, panel.fullViewWindow) ? "crosshair" : "grab";
  }

  function syncMultiViewCanvasResolution(panel) {
    if (!panel || !panel.canvas) {
      return false;
    }

    var rect = typeof panel.canvas.getBoundingClientRect === "function" ? panel.canvas.getBoundingClientRect() : null;
    var cssWidth = Math.max(1, Math.floor((rect && rect.width) || panel.canvas.clientWidth || 0));
    var cssHeight = Math.max(1, Math.floor((rect && rect.height) || panel.canvas.clientHeight || 0));
    if (!cssWidth || !cssHeight) {
      return false;
    }

    var dpr = window.devicePixelRatio || 1;
    var nextWidth = Math.max(1, Math.floor(cssWidth * dpr));
    var nextHeight = Math.max(1, Math.floor(cssHeight * dpr));
    if (panel.canvas.width === nextWidth && panel.canvas.height === nextHeight) {
      return false;
    }

    panel.canvas.width = nextWidth;
    panel.canvas.height = nextHeight;
    return true;
  }

  function scheduleMultiViewSettledRender(panel) {
    if (!panel) {
      return;
    }

    if (panel.wheelRenderTimer) {
      clearTimeout(panel.wheelRenderTimer);
    }

    panel.wheelRenderTimer = setTimeout(function () {
      panel.wheelRenderTimer = null;
      rerenderMultiViewPanel(panel, { fastMode: false });
    }, 130);
  }

  function renderMultiViewPanel(panel, packet, options) {
    if (!panel || !packet) {
      return;
    }

    var renderOptions = options || {};

    insertPacketIntoMultiViewBuffer(panel, packet);
    if (!Array.isArray(panel.packetBuffer) || !panel.packetBuffer.length) {
      return;
    }

    var fullWindow = getMultiViewFullWindowFromPackets(panel.device, panel.packetBuffer);
    if (!fullWindow) {
      return;
    }

    panel.fullViewWindow = fullWindow;

    panel.viewWindow = normalizeMultiViewWindow(panel.fullViewWindow, panel.viewWindow || panel.fullViewWindow);
    syncMultiViewCanvasResolution(panel);

    var viewWindow = panel.viewWindow;
    var hasDisplayFrequencyRange = !isMultiViewWindowFull(viewWindow, fullWindow);
    var latestPacket = panel.packetBuffer[panel.packetBuffer.length - 1] || packet;
    var intensityType = null;
    var frequencyBins = null;

    for (var i = 0; i < panel.packetBuffer.length; i += 1) {
      var bufferedPacket = panel.packetBuffer[i];
      if (!intensityType && typeof bufferedPacket.intensityType === "string") {
        intensityType = bufferedPacket.intensityType;
      }

      var packetBins = getPacketFrequencyBins(bufferedPacket);
      if (packetBins && packetBins.length > 1) {
        frequencyBins = packetBins;
        break;
      }
    }

    window.Spectrogram.renderSpectrogram({
      canvas: panel.canvas,
      legendCanvas: null,
      blocks: panel.packetBuffer,
      from: formatNaiveDateTimeMs(viewWindow.fromMs, true),
      to: formatNaiveDateTimeMs(viewWindow.toMs, true),
      fastMode: !!renderOptions.fastMode,
      assumeSorted: true,
      intensityMode: activeIntensityMode,
      dbMin: activeDbMin,
      dbMax: activeDbMax,
      percentileLow: activePercentileLow,
      percentileHigh: activePercentileHigh,
      compareView: activeCompareView,
      noiseSuppressionEnabled: activeNoiseSuppressionEnabled,
      noiseFloorPercentile: activeNoiseFloorPercentile,
      noiseThreshold: activeNoiseThreshold,
      isolatedPixelRemovalEnabled: activeIsolatedPixelRemovalEnabled,
      minActiveNeighbors: activeMinActiveNeighbors,
      neighborhoodSize: activeNeighborhoodSize,
      bucketAggregation: activeBucketAggregation,
      debugStatsEnabled: false,
      intensityType: intensityType || latestPacket.intensityType,
      displayGainDb: activeDisplayGainDb,
      frequencyBins: frequencyBins,
      minFrequency: fullWindow.minFrequency,
      maxFrequency: fullWindow.maxFrequency,
      displayMinFrequency: hasDisplayFrequencyRange ? viewWindow.minFrequency : null,
      displayMaxFrequency: hasDisplayFrequencyRange ? viewWindow.maxFrequency : null
    });

    panel.lastPacket = latestPacket;
    updateMultiViewPanelCursor(panel);
  }

  function rerenderMultiViewPanel(panel, options) {
    if (!panel || !panel.lastPacket) {
      return;
    }

    renderMultiViewPanel(panel, panel.lastPacket, options);
  }

  function resetMultiViewViewWindow(panel) {
    if (!panel || !Array.isArray(panel.packetBuffer) || !panel.packetBuffer.length) {
      return;
    }

    var nextFullWindow = getMultiViewFullWindowFromPackets(panel.device, panel.packetBuffer);
    if (!nextFullWindow) {
      return;
    }

    panel.fullViewWindow = nextFullWindow;
    panel.viewWindow = cloneMultiViewWindow(nextFullWindow);
    rerenderMultiViewPanel(panel);
  }

  function attachMultiViewMouseInteractions(panel) {
    if (!panel || !panel.canvas) {
      return function () {};
    }

    var onResize = function () {
      if (!panel.lastPacket) {
        syncMultiViewCanvasResolution(panel);
        return;
      }

      if (syncMultiViewCanvasResolution(panel)) {
        rerenderMultiViewPanel(panel, { fastMode: false });
      }
    };

    var onWheel = function (event) {
      if (!panel.lastPacket || !panel.fullViewWindow) {
        return;
      }

      event.preventDefault();

      var rect = panel.canvas.getBoundingClientRect();
      var width = Math.max(1, rect.width || 1);
      var timeAnchorFraction = clamp((event.clientX - rect.left) / width, 0, 1);
      var fullWindow = panel.fullViewWindow;
      var currentWindow = normalizeMultiViewWindow(fullWindow, panel.viewWindow || fullWindow);
      var factor = Number(event.deltaY) < 0 ? 0.88 : 1 / 0.88;
      var currentTimeSpan = currentWindow.toMs - currentWindow.fromMs;
      var nextTimeSpan = currentTimeSpan * factor;
      var anchorTimeMs = currentWindow.fromMs + currentTimeSpan * timeAnchorFraction;

      panel.viewWindow = normalizeMultiViewWindow(fullWindow, {
        fromMs: anchorTimeMs - nextTimeSpan * timeAnchorFraction,
        toMs: anchorTimeMs + nextTimeSpan * (1 - timeAnchorFraction),
        minFrequency: fullWindow.minFrequency,
        maxFrequency: fullWindow.maxFrequency
      });

      rerenderMultiViewPanel(panel, { fastMode: true });
      scheduleMultiViewSettledRender(panel);
    };

    var onMouseDown = function (event) {
      if (event.button !== 0 || !panel.lastPacket || !panel.fullViewWindow) {
        return;
      }

      panel.viewWindow = normalizeMultiViewWindow(panel.fullViewWindow, panel.viewWindow || panel.fullViewWindow);
      if (isMultiViewWindowFull(panel.viewWindow, panel.fullViewWindow)) {
        return;
      }

      panel.dragState.active = true;
      panel.dragState.startX = event.clientX;
      panel.dragState.startY = event.clientY;
      panel.dragState.startWindow = cloneMultiViewWindow(panel.viewWindow);
      updateMultiViewPanelCursor(panel);
      event.preventDefault();
    };

    var onMouseMove = function (event) {
      if (!panel.dragState.active || !panel.fullViewWindow || !panel.dragState.startWindow) {
        return;
      }

      var rect = panel.canvas.getBoundingClientRect();
      var width = Math.max(1, rect.width || 1);
      var dx = event.clientX - panel.dragState.startX;
      var startWindow = panel.dragState.startWindow;
      var timeSpan = startWindow.toMs - startWindow.fromMs;
      var timeShift = (-dx / width) * timeSpan;

      panel.viewWindow = normalizeMultiViewWindow(panel.fullViewWindow, {
        fromMs: startWindow.fromMs + timeShift,
        toMs: startWindow.toMs + timeShift,
        minFrequency: panel.fullViewWindow.minFrequency,
        maxFrequency: panel.fullViewWindow.maxFrequency
      });

      rerenderMultiViewPanel(panel, { fastMode: true });
    };

    var stopDragging = function () {
      if (!panel.dragState.active) {
        return;
      }

      panel.dragState.active = false;
      panel.dragState.startWindow = null;
      updateMultiViewPanelCursor(panel);
      rerenderMultiViewPanel(panel, { fastMode: false });
    };

    var onDoubleClick = function (event) {
      if (!panel.fullViewWindow) {
        return;
      }

      event.preventDefault();
      resetMultiViewViewWindow(panel);
    };

    panel.canvas.addEventListener("wheel", onWheel, { passive: false });
    panel.canvas.addEventListener("mousedown", onMouseDown);
    panel.canvas.addEventListener("dblclick", onDoubleClick);
    window.addEventListener("mousemove", onMouseMove);
    window.addEventListener("mouseup", stopDragging);
    window.addEventListener("blur", stopDragging);
    window.addEventListener("resize", onResize);

    updateMultiViewPanelCursor(panel);

    return function cleanup() {
      panel.canvas.removeEventListener("wheel", onWheel);
      panel.canvas.removeEventListener("mousedown", onMouseDown);
      panel.canvas.removeEventListener("dblclick", onDoubleClick);
      window.removeEventListener("mousemove", onMouseMove);
      window.removeEventListener("mouseup", stopDragging);
      window.removeEventListener("blur", stopDragging);
      window.removeEventListener("resize", onResize);
    };
  }

  function renderMultiViewPacket(deviceId, packet, options) {
    if (!multiViewOpen) {
      return;
    }

    var panel = multiViewPanels[String(deviceId)];
    if (!panel || !packet || typeof packet !== "object") {
      return;
    }

    decodePacketMatrix(packet);
    normalizePacketTiming(packet);
    var range = getPacketTimeRange(packet);
    if (!range) {
      return;
    }

    var device = panel.device || getDeviceById(deviceId);
    var nextBufferedPackets = getMultiViewBufferedPackets(panel, packet);
    var nextFullWindow = getMultiViewFullWindowFromPackets(device, nextBufferedPackets);
    if (!nextFullWindow) {
      return;
    }
    var previousFullWindow = cloneMultiViewWindow(panel.fullViewWindow);
    var previousViewWindow = cloneMultiViewWindow(panel.viewWindow);

    panel.fullViewWindow = nextFullWindow;
    if (options && options.preserveViewWindow && previousViewWindow) {
      panel.viewWindow = normalizeMultiViewWindow(nextFullWindow, previousViewWindow);
    } else if (!previousFullWindow || !previousViewWindow || isMultiViewWindowFull(previousViewWindow, previousFullWindow)) {
      panel.viewWindow = cloneMultiViewWindow(nextFullWindow);
    } else {
      panel.viewWindow = normalizeMultiViewWindow(
        nextFullWindow,
        remapMultiViewWindow(previousViewWindow, previousFullWindow, nextFullWindow)
      );
    }

    renderMultiViewPanel(panel, packet);
  }

  async function fetchLatestPacketForDevice(deviceId) {
    var latestPacket = await apiRequest("/api/devices/" + deviceId + "/history/latest");
    if (!latestPacket || typeof latestPacket !== "object") {
      return null;
    }
    decodePacketMatrix(latestPacket);
    normalizePacketTiming(latestPacket);
    return latestPacket;
  }

  async function fetchLatestPacketsForDevice(deviceId, count) {
    var latestPackets = await apiRequest(
      "/api/devices/" + deviceId + "/history/latest-batch?count=" + encodeURIComponent(String(count))
    );
    if (!Array.isArray(latestPackets)) {
      return [];
    }

    return latestPackets
      .filter(function (packet) {
        return packet && typeof packet === "object";
      })
      .map(function (packet) {
        decodePacketMatrix(packet);
        normalizePacketTiming(packet);
        return packet;
      });
  }

  async function seedMultiViewPanels(deviceIds) {
    var tasks = deviceIds.map(async function (deviceId) {
      try {
        var latestPackets = await fetchLatestPacketsForDevice(deviceId, MULTI_VIEW_PANEL_BUFFER_SIZE);
        for (var i = 0; i < latestPackets.length; i += 1) {
          // Intentionally render in order so existing window-fit logic expands to full seeded span.
          await Promise.resolve(renderMultiViewPacket(deviceId, latestPackets[i]));
        }
      } catch (_error) {
        // Ignore devices that do not have packets yet.
      }
    });

    await Promise.all(tasks);
  }

  function buildMultiViewPanel(device) {
    var wrapper = document.createElement("div");
    wrapper.style.border = "1px solid rgba(255,255,255,0.18)";
    wrapper.style.background = "#0b101a";
    wrapper.style.padding = "0";
    wrapper.style.minHeight = "0";
    wrapper.style.minWidth = "0";
    wrapper.style.position = "relative";
    wrapper.style.overflow = "hidden";

    var canvasWrap = document.createElement("div");
    canvasWrap.style.height = "100%";
    canvasWrap.style.width = "100%";
    canvasWrap.style.overflow = "hidden";
    canvasWrap.style.position = "relative";
    canvasWrap.style.minHeight = "0";
    canvasWrap.style.minWidth = "0";

    var title = document.createElement("span");
    title.textContent = device.name;
    title.style.color = "#eaf1ff";
    title.style.fontSize = "11px";
    title.style.fontWeight = "600";
    title.style.position = "absolute";
    title.style.top = "4px";
    title.style.left = "4px";
    title.style.zIndex = "2";
    title.style.padding = "2px 6px";
    title.style.borderRadius = "4px";
    title.style.background = "rgba(3, 8, 16, 0.52)";
    title.style.pointerEvents = "none";
    title.style.userSelect = "none";

    var canvasEl = document.createElement("canvas");
    canvasEl.width = 960;
    canvasEl.height = 420;
    canvasEl.style.width = "100%";
    canvasEl.style.height = "100%";
    canvasEl.style.background = "#090b15";
    canvasEl.style.display = "block";

    canvasWrap.appendChild(canvasEl);
    canvasWrap.appendChild(title);
    wrapper.appendChild(canvasWrap);

    return {
      wrapper: wrapper,
      canvas: canvasEl,
      canvasWrap: canvasWrap,
      title: title
    };
  }

  async function openMultiViewOverlay(deviceIds) {
    clearMultiViewPanels();

    var selectedDevices = deviceIds
      .map(getDeviceById)
      .filter(function (device) {
        return !!device;
      })
      .slice(0, 4);

    if (!selectedDevices.length) {
      setGlobalMessage("اختر جهازًا واحدًا على الأقل للعرض المتعدد", true);
      return;
    }

    var columns = selectedDevices.length === 1 ? 1 : 2;
    multiViewGrid.style.gridTemplateColumns = "repeat(" + columns + ", minmax(0, 1fr))";
    multiViewGrid.style.gridAutoRows = "minmax(0, 1fr)";
    multiViewGrid.style.width = "100vw";
    multiViewGrid.style.height = "100vh";
    multiViewGrid.style.gap = "1px";

    selectedDevices.forEach(function (device) {
      var panel = buildMultiViewPanel(device);
      var panelState = {
        device: device,
        deviceId: device.id,
        canvas: panel.canvas,
        canvasWrap: panel.canvasWrap,
        title: panel.title,
        packetBuffer: [],
        lastPacket: null,
        fullViewWindow: null,
        viewWindow: null,
        dragState: {
          active: false,
          startX: 0,
          startY: 0,
          startWindow: null
        },
        wheelRenderTimer: null,
        cleanupInteractions: null
      };
      panelState.cleanupInteractions = attachMultiViewMouseInteractions(panelState);
      multiViewPanels[String(device.id)] = panelState;
      multiViewGrid.appendChild(panel.wrapper);
      syncMultiViewCanvasResolution(panelState);
    });

    multiViewOpen = true;
    multiViewOverlay.classList.remove("hidden");
    multiViewOverlay.setAttribute("aria-hidden", "false");

    await seedMultiViewPanels(
      selectedDevices.map(function (device) {
        return Number(device.id);
      })
    );
  }

  function closeMultiViewOverlay() {
    multiViewOpen = false;
    multiViewOverlay.classList.add("hidden");
    multiViewOverlay.setAttribute("aria-hidden", "true");
    clearMultiViewPanels();
  }

  function handleMultiViewLivePayload(payload) {
    if (!multiViewOpen || !payload) {
      return;
    }

    var deviceId = Number(payload.deviceId);
    if (!Number.isFinite(deviceId) || !multiViewPanels[String(deviceId)]) {
      return;
    }

    renderMultiViewPacket(deviceId, payload);
  }

  async function selectDevice(device) {
    selectedDeviceId = device.id;
    selectedDeviceName = device.name;
    selectedDeviceKey = normalizeDeviceKey(device.name);
    selectedDeviceMinFrequency = Number.isFinite(device.minFrequency) ? device.minFrequency : null;
    selectedDeviceMaxFrequency = Number.isFinite(device.maxFrequency) ? device.maxFrequency : null;
    selectedDeviceTitleEl.textContent = "الجهاز المحدد: " + device.name;
    sideDeviceInfoEl.textContent =
      "المعرّف: " +
      device.id +
      " | الاسم: " +
      device.name +
      " | الوصف: " +
      (device.description || "-") +
      " | نطاق التردد: " +
      (Number.isFinite(selectedDeviceMinFrequency) && Number.isFinite(selectedDeviceMaxFrequency)
        ? selectedDeviceMinFrequency + " Hz -> " + selectedDeviceMaxFrequency + " Hz"
        : "غير مضبوط");
    setActiveDevice(device.id);
    emitDashboardBridgeEvent("dashboard:device-selected", {
      deviceId: Number(device.id),
      device: device
    });
    await loadDeviceHistory(device.id, null, null, {
      liveWindowMs: DEFAULT_LIVE_WINDOW_MS,
      modeLabel: "latest30m"
    });
  }

  function renderDeviceSidebar() {
    deviceListEl.innerHTML = "";
    devicesCache.forEach(function (device) {
      var option = document.createElement("option");
      option.value = String(device.id);
      option.textContent = device.name;
      deviceListEl.appendChild(option);
    });
  }

  async function loadDevices() {
    devicesCache = await apiRequest("/api/devices");
    renderDeviceSidebar();
    emitDashboardBridgeEvent("dashboard:devices-loaded", {
      devices: devicesCache.slice(),
      selectedDeviceId: selectedDeviceId
    });
    if (isAdmin) {
      await loadDevicesWithStatus();
    }
    renderUserDeviceOptions();

    if (devicesCache.length > 0) {
      var target = devicesCache[0];
      if (selectedDeviceId) {
        var found = devicesCache.find(function (d) {
          return Number(d.id) === Number(selectedDeviceId);
        });
        if (found) {
          target = found;
        }
      }
      await selectDevice(target);
    } else {
      selectedDeviceTitleEl.textContent = "لا توجد أجهزة";
      historyInfoEl.textContent = "قم بإنشاء أجهزة عبر الـAPI بصلاحية مدير.";
      if (historyTableBody) {
        historyTableBody.innerHTML = "";
      }
      sideDeviceInfoEl.textContent = "لا يوجد جهاز محدد.";
    }
  }

  deviceListEl.addEventListener("change", function () {
    var selectedId = Number(deviceListEl.value);
    if (!Number.isFinite(selectedId)) {
      return;
    }

    var device = devicesCache.find(function (d) {
      return Number(d.id) === selectedId;
    });
    if (!device) {
      return;
    }

    selectDevice(device).catch(function (error) {
      historyInfoEl.textContent = error instanceof Error ? error.message : "فشل تحميل السجل";
    });
  });

  function resetUserForm() {
    editingUserId = null;
    userIdInput.value = "";
    userNameInput.value = "";
    userUsernameInput.value = "";
    userPasswordInput.value = "";
    userRoleInput.value = "emp";
    updateUserDeviceAssignmentVisibility();
    clearUserDeviceSelections();
    userSaveBtn.textContent = "إضافة مستخدم";
    userModalTitle.textContent = "إضافة مستخدم";
    userFormMessage.textContent = "";
  }

  function openUserModal() {
    userModal.classList.remove("hidden");
    userModal.setAttribute("aria-hidden", "false");
  }

  function closeUserModal() {
    userModal.classList.add("hidden");
    userModal.setAttribute("aria-hidden", "true");
  }

  function hasResettableMobileDeviceBinding(userEntry) {
    var mobileDeviceId = typeof userEntry.mobileDeviceId === "string" ? userEntry.mobileDeviceId.trim() : "";
    if (!mobileDeviceId) {
      return false;
    }

    var status = typeof userEntry.mobileDeviceStatus === "string" ? userEntry.mobileDeviceStatus.trim().toLowerCase() : "";
    return status === "approved";
  }

  async function loadPendingDeviceRequests() {
    if (!isAdmin || !pendingDevicesTableBody || !pendingDevicesMessage) {
      return;
    }

    try {
      var pendingUsers = await apiRequest("/api/users/pending-devices");
      pendingDevicesTableBody.innerHTML = "";

      if (!Array.isArray(pendingUsers) || pendingUsers.length === 0) {
        pendingDevicesMessage.textContent = "لا توجد طلبات أجهزة بانتظار الموافقة.";
        return;
      }

      pendingDevicesMessage.textContent = "";
      pendingUsers.forEach(function (entry) {
        var tr = document.createElement("tr");

        var idCell = document.createElement("td");
        idCell.textContent = String(entry.id || "-");
        tr.appendChild(idCell);

        var nameCell = document.createElement("td");
        nameCell.textContent = entry.name || "-";
        tr.appendChild(nameCell);

        var usernameCell = document.createElement("td");
        usernameCell.textContent = entry.username || "-";
        tr.appendChild(usernameCell);

        var deviceIdCell = document.createElement("td");
        deviceIdCell.textContent = entry.mobileDeviceId || "-";
        tr.appendChild(deviceIdCell);

        var firstSeenCell = document.createElement("td");
        firstSeenCell.textContent = entry.mobileDeviceFirstSeenAt ? formatLocalDateTime(entry.mobileDeviceFirstSeenAt) : "-";
        tr.appendChild(firstSeenCell);

        var actionCell = document.createElement("td");
        actionCell.className = "action-buttons";
        var approveBtn = document.createElement("button");
        approveBtn.type = "button";
        approveBtn.className = "ghost-btn";
        approveBtn.textContent = "موافقة";
        approveBtn.addEventListener("click", async function () {
          try {
            await apiRequest("/api/users/" + entry.id + "/approve-device", { method: "POST" });
            await loadUsersPanelData();
            setGlobalMessage("تمت الموافقة على جهاز الموبايل", false);
          } catch (error) {
            setGlobalMessage(error instanceof Error ? error.message : "فشل اعتماد الجهاز", true);
          }
        });

        var rejectBtn = document.createElement("button");
        rejectBtn.type = "button";
        rejectBtn.className = "danger-btn";
        rejectBtn.textContent = "رفض";
        rejectBtn.addEventListener("click", async function () {
          if (!window.confirm("هل تريد رفض طلب جهاز الموبايل للمستخدم " + entry.username + "؟")) {
            return;
          }

          try {
            await apiRequest("/api/users/" + entry.id + "/reset-device", { method: "POST" });
            await loadUsersPanelData();
            setGlobalMessage("تم رفض طلب جهاز الموبايل", false);
          } catch (error) {
            setGlobalMessage(error instanceof Error ? error.message : "فشل رفض الطلب", true);
          }
        });

        actionCell.appendChild(approveBtn);
        actionCell.appendChild(rejectBtn);
        tr.appendChild(actionCell);
        pendingDevicesTableBody.appendChild(tr);
      });
    } catch (error) {
      pendingDevicesTableBody.innerHTML = "";
      pendingDevicesMessage.textContent = "تعذر تحميل طلبات أجهزة الموبايل.";
      setGlobalMessage(error instanceof Error ? error.message : "فشل تحميل طلبات الأجهزة", true);
    }
  }

  async function loadDeviceChangeRequests() {
    if (!isAdmin || !deviceChangeRequestsTableBody || !deviceChangeRequestsMessage) {
      return;
    }

    try {
      var changeRequests = await apiRequest("/api/users/device-change-requests");
      deviceChangeRequestsTableBody.innerHTML = "";

      if (!Array.isArray(changeRequests) || changeRequests.length === 0) {
        deviceChangeRequestsMessage.textContent = "لا توجد طلبات تغيير جهاز حالياً.";
        return;
      }

      deviceChangeRequestsMessage.textContent = "";
      changeRequests.forEach(function (entry) {
        var tr = document.createElement("tr");

        var userCell = document.createElement("td");
        userCell.textContent = (entry.name || "-") + " (" + (entry.username || "-") + ")";
        tr.appendChild(userCell);

        var currentDeviceCell = document.createElement("td");
        currentDeviceCell.textContent = entry.mobileDeviceId || "-";
        tr.appendChild(currentDeviceCell);

        var requestedDeviceCell = document.createElement("td");
        requestedDeviceCell.textContent = entry.mobileDeviceChangeRequestId || "-";
        tr.appendChild(requestedDeviceCell);

        var requestedAtCell = document.createElement("td");
        requestedAtCell.textContent = entry.mobileDeviceChangeRequestedAt ? formatLocalDateTime(entry.mobileDeviceChangeRequestedAt) : "-";
        tr.appendChild(requestedAtCell);

        var actionCell = document.createElement("td");
        actionCell.className = "action-buttons";

        var approveBtn = document.createElement("button");
        approveBtn.type = "button";
        approveBtn.className = "ghost-btn";
        approveBtn.textContent = "اعتماد التغيير";
        approveBtn.addEventListener("click", async function () {
          try {
            await apiRequest("/api/users/" + entry.id + "/approve-device-change", { method: "POST" });
            await loadUsersPanelData();
            setGlobalMessage("تم اعتماد تغيير الجهاز", false);
          } catch (error) {
            setGlobalMessage(error instanceof Error ? error.message : "فشل اعتماد تغيير الجهاز", true);
          }
        });

        var rejectBtn = document.createElement("button");
        rejectBtn.type = "button";
        rejectBtn.className = "danger-btn";
        rejectBtn.textContent = "رفض";
        rejectBtn.addEventListener("click", async function () {
          try {
            await apiRequest("/api/users/" + entry.id + "/reject-device-change", { method: "POST" });
            await loadUsersPanelData();
            setGlobalMessage("تم رفض طلب تغيير الجهاز", false);
          } catch (error) {
            setGlobalMessage(error instanceof Error ? error.message : "فشل رفض طلب تغيير الجهاز", true);
          }
        });

        actionCell.appendChild(approveBtn);
        actionCell.appendChild(rejectBtn);
        tr.appendChild(actionCell);
        deviceChangeRequestsTableBody.appendChild(tr);
      });
    } catch (error) {
      deviceChangeRequestsTableBody.innerHTML = "";
      deviceChangeRequestsMessage.textContent = "تعذر تحميل طلبات تغيير الجهاز.";
      setGlobalMessage(error instanceof Error ? error.message : "فشل تحميل طلبات تغيير الجهاز", true);
    }
  }

  async function loadUsersPanelData() {
    if (!isAdmin) {
      return;
    }

    await Promise.all([loadUsers(), loadPendingDeviceRequests(), loadDeviceChangeRequests()]);
  }

  function clearUserDeviceSelections() {
    if (!(userDeviceIdsInput instanceof HTMLSelectElement)) {
      return;
    }

    Array.from(userDeviceIdsInput.options).forEach(function (option) {
      option.selected = false;
    });
  }

  function updateUserDeviceAssignmentVisibility() {
    var isEmployee = userRoleInput.value === "emp";
    userDeviceAssignmentGroup.classList.toggle("hidden", !isEmployee);
    userDeviceIdsInput.required = isEmployee;
  }

  function renderUserDeviceOptions() {
    if (!(userDeviceIdsInput instanceof HTMLSelectElement)) {
      return;
    }

    var selectedValues = new Set(
      Array.from(userDeviceIdsInput.selectedOptions || []).map(function (option) {
        return option.value;
      })
    );

    userDeviceIdsInput.innerHTML = "";
    devicesCache.forEach(function (device) {
      var option = document.createElement("option");
      option.value = String(device.id);
      option.textContent = device.name;
      option.selected = selectedValues.has(String(device.id));
      userDeviceIdsInput.appendChild(option);
    });

    updateUserDeviceAssignmentVisibility();
  }

  function getSelectedUserDeviceIds() {
    if (!(userDeviceIdsInput instanceof HTMLSelectElement)) {
      return [];
    }

    return Array.from(userDeviceIdsInput.selectedOptions)
      .map(function (option) {
        return Number(option.value);
      })
      .filter(function (value) {
        return Number.isFinite(value) && value > 0;
      });
  }

  function formatUserDeviceSummary(deviceIds) {
    if (!Array.isArray(deviceIds) || deviceIds.length === 0) {
      return "كل الأجهزة";
    }

    var names = deviceIds
      .map(function (deviceId) {
        var device = devicesCache.find(function (item) {
          return Number(item.id) === Number(deviceId);
        });
        return device ? device.name : "#" + deviceId;
      })
      .filter(Boolean);

    if (!names.length) {
      return "-";
    }

    return names.join("، ");
  }

  function resetDeviceForm() {
    editingDeviceId = null;
    deviceIdInput.value = "";
    deviceNameInput.value = "";
    deviceExternalDeviceIdInput.value = "";
    deviceDescriptionInput.value = "";
    deviceMinFrequencyInput.value = "";
    deviceMaxFrequencyInput.value = "";
    deviceSaveBtn.textContent = "إضافة جهاز";
    deviceModalTitle.textContent = "إضافة جهاز";
    deviceFormMessage.textContent = "";
  }

  function openDeviceModal() {
    deviceModal.classList.remove("hidden");
    deviceModal.setAttribute("aria-hidden", "false");
  }

  function closeDeviceModal() {
    deviceModal.classList.add("hidden");
    deviceModal.setAttribute("aria-hidden", "true");
  }

  function openDeviceLocationModalOverlay() {
    deviceLocationModal.classList.remove("hidden");
    deviceLocationModal.setAttribute("aria-hidden", "false");
  }

  function closeDeviceLocationModalOverlay() {
    deviceLocationModal.classList.add("hidden");
    deviceLocationModal.setAttribute("aria-hidden", "true");
  }

  function clearDeviceLocationMessage() {
    deviceLocationMessage.textContent = "";
    deviceLocationMessage.style.color = "";
  }

  function setDeviceLocationMessage(message, isError) {
    deviceLocationMessage.textContent = message || "";
    deviceLocationMessage.style.color = isError ? "#8a1c18" : "#1f6f53";
  }

  function setDeviceLocationMarker(lat, lng) {
    if (!deviceLocationMap || !window.L) {
      return;
    }

    if (deviceLocationMarker) {
      deviceLocationMap.removeLayer(deviceLocationMarker);
      deviceLocationMarker = null;
    }

    deviceLocationMarker = L.marker([lat, lng], { draggable: true }).addTo(deviceLocationMap);
  }

  function openDeviceLocationModal(device) {
    if (!device || !window.L) {
      setGlobalMessage("تعذر تحميل خريطة الموقع", true);
      return;
    }

    editingDeviceForLocation = device;
    deviceLocationModalTitle.textContent = "تحديد موقع الجهاز: " + (device.name || "-");
    deviceLocationSearchInput.value = "";
    clearDeviceLocationMessage();
    openDeviceLocationModalOverlay();

    if (deviceLocationMap) {
      deviceLocationMap.remove();
      deviceLocationMap = null;
      deviceLocationMarker = null;
    }

    var latitude = parseDeviceCoordinate(device.latitude);
    var longitude = parseDeviceCoordinate(device.longitude);
    var hasSavedLocation = Number.isFinite(latitude) && Number.isFinite(longitude);

    // Default center is around Syria and can be adjusted based on deployment region.
    var initialLat = hasSavedLocation ? latitude : DEFAULT_LOCATION_LAT;
    var initialLng = hasSavedLocation ? longitude : DEFAULT_LOCATION_LNG;
    var initialZoom = hasSavedLocation ? 13 : 7;

    deviceLocationMap = L.map(deviceLocationMapContainer, { attributionControl: false }).setView(
      [initialLat, initialLng],
      initialZoom
    );
    var terrainLayer = createTerrainTileLayer();
    var satelliteLayer = createSatelliteTileLayer();
    terrainLayer.addTo(deviceLocationMap);
    L.control.attribution({ prefix: false, position: "bottomright" }).addTo(deviceLocationMap);
    L.control.layers(
      { "تضاريس": terrainLayer, "قمر صناعي": satelliteLayer },
      null,
      { position: "topright" }
    ).addTo(deviceLocationMap);
    setTimeout(function () {
      if (deviceLocationMap) {
        deviceLocationMap.invalidateSize();
      }
    }, 0);

    if (hasSavedLocation) {
      setDeviceLocationMarker(latitude, longitude);
    }

    deviceLocationMap.on("click", function (event) {
      setDeviceLocationMarker(event.latlng.lat, event.latlng.lng);
      clearDeviceLocationMessage();
    });
  }

  function resolveAiStatusLabelForCards(statusValue) {
    var normalized = Number(statusValue);
    if (normalized === 2) {
      return "لا يوجد هدف";
    }
    if (normalized === 1) {
      return "هدف مكتشف";
    }
    if (normalized === 0) {
      return "هدف محتمل";
    }
    return "غير محدد";
  }

  // Keep these colors identical to resolveAiStatusColor in spectrogram.js.
  function resolveAiStatusColorForCards(statusValue) {
    var normalized = Number(statusValue);
    if (normalized === 2) {
      return "#21a366";
    }
    if (normalized === 1) {
      return "#d13438";
    }
    if (normalized === 0) {
      return "#f59e0b";
    }
    return "#000000";
  }

  function formatDeviceCardStatus(statusValue, confidenceValue) {
    if (statusValue === null || statusValue === undefined) {
      return "لا توجد بيانات بعد";
    }

    var label = resolveAiStatusLabelForCards(statusValue);
    var confidence = Number(confidenceValue);
    if (Number.isFinite(confidence)) {
      return label + " (" + confidence + "%)";
    }

    return label;
  }

  function startEditingDevice(device) {
    editingDeviceId = device.id;
    deviceIdInput.value = String(device.id);
    deviceNameInput.value = device.name;
    deviceExternalDeviceIdInput.value = device.externalDeviceId || "";
    deviceDescriptionInput.value = device.description || "";
    deviceMinFrequencyInput.value = Number.isFinite(device.minFrequency) ? String(device.minFrequency) : "";
    deviceMaxFrequencyInput.value = Number.isFinite(device.maxFrequency) ? String(device.maxFrequency) : "";
    deviceSaveBtn.textContent = "تحديث جهاز";
    deviceModalTitle.textContent = "تعديل جهاز";
    deviceFormMessage.textContent = "تعديل الجهاز رقم " + device.id;
    openDeviceModal();
  }

  async function loadUsers() {
    try {
      var users = await apiRequest("/api/users");
      usersTableBody.innerHTML = "";

      users.forEach(function (u) {
        var tr = document.createElement("tr");
        var deviceSummary = formatUserDeviceSummary(u.deviceIds);
        var devicePills =
          deviceSummary === "-"
            ? "-"
            : "<div class=\"device-pill-list\">" +
              deviceSummary
                .split("، ")
                .map(function (label) {
                  return "<span class='device-pill'>" + label + "</span>";
                })
                .join("") +
              "</div>";
        tr.innerHTML =
          "<td>" +
          u.id +
          "</td><td>" +
          u.name +
          "</td><td>" +
          u.username +
          "</td><td>" +
          u.role +
          "</td><td>" +
          devicePills +
          "</td>";

        if (isAdmin) {
          var actionTd = document.createElement("td");
          actionTd.className = "action-buttons";

          var editBtn = document.createElement("button");
          editBtn.type = "button";
          editBtn.className = "ghost-btn";
          editBtn.textContent = "تعديل";
          editBtn.addEventListener("click", function () {
            editingUserId = u.id;
            userIdInput.value = String(u.id);
            userNameInput.value = u.name;
            userUsernameInput.value = u.username;
            userRoleInput.value = u.role;
            userPasswordInput.value = "";
            updateUserDeviceAssignmentVisibility();
            renderUserDeviceOptions();
            clearUserDeviceSelections();
            if (Array.isArray(u.deviceIds) && userDeviceIdsInput instanceof HTMLSelectElement) {
              Array.from(userDeviceIdsInput.options).forEach(function (option) {
                option.selected = u.deviceIds.some(function (deviceId) {
                  return Number(deviceId) === Number(option.value);
                });
              });
            }
            userSaveBtn.textContent = "تحديث مستخدم";
            userModalTitle.textContent = "تعديل المستخدم";
            userFormMessage.textContent = "تعديل المستخدم رقم " + u.id;
            openUserModal();
          });

          var deleteBtn = document.createElement("button");
          deleteBtn.type = "button";
          deleteBtn.className = "danger-btn";
          deleteBtn.textContent = "حذف";
          deleteBtn.addEventListener("click", async function () {
            if (!window.confirm("هل تريد حذف المستخدم " + u.username + "؟")) {
              return;
            }
            try {
              await apiRequest("/api/users/" + u.id, { method: "DELETE" });
              closeUserModal();
              if (Number(editingUserId) === Number(u.id)) {
                resetUserForm();
              }
              await loadUsersPanelData();
              setGlobalMessage("تم حذف المستخدم بنجاح", false);
            } catch (error) {
              setGlobalMessage(error instanceof Error ? error.message : "فشل الحذف", true);
            }
          });

          if (hasResettableMobileDeviceBinding(u)) {
            var resetDeviceBtn = document.createElement("button");
            resetDeviceBtn.type = "button";
            resetDeviceBtn.className = "ghost-btn";
            resetDeviceBtn.textContent = "إلغاء ربط الجهاز";
            resetDeviceBtn.addEventListener("click", async function () {
              if (!window.confirm("هل تريد إلغاء ربط جهاز الموبايل للمستخدم " + u.username + "؟")) {
                return;
              }

              try {
                await apiRequest("/api/users/" + u.id + "/reset-device", { method: "POST" });
                await loadUsersPanelData();
                setGlobalMessage("تم إلغاء ربط جهاز الموبايل", false);
              } catch (error) {
                setGlobalMessage(error instanceof Error ? error.message : "فشل إلغاء الربط", true);
              }
            });
            actionTd.appendChild(resetDeviceBtn);
          }

          actionTd.appendChild(editBtn);
          actionTd.appendChild(deleteBtn);
          tr.appendChild(actionTd);
        }

        usersTableBody.appendChild(tr);
      });
    } catch (error) {
      usersTableBody.innerHTML = "";
      setGlobalMessage(error instanceof Error ? error.message : "فشل تحميل المستخدمين", true);
    }
  }

  userForm.addEventListener("submit", async function (event) {
    event.preventDefault();
    if (!isAdmin) {
      setGlobalMessage("فقط المدير يمكنه إدارة المستخدمين", true);
      return;
    }

    var payload = {
      name: userNameInput.value.trim(),
      username: userUsernameInput.value.trim(),
      password: userPasswordInput.value,
      role: userRoleInput.value,
      deviceIds: userRoleInput.value === "emp" ? getSelectedUserDeviceIds() : []
    };

    try {
      if (editingUserId) {
        var updatePayload = {
          name: payload.name,
          username: payload.username,
          role: payload.role,
          deviceIds: payload.deviceIds
        };
        if (payload.password) {
          updatePayload.password = payload.password;
        }
        await apiRequest("/api/users/" + editingUserId, {
          method: "PUT",
          body: JSON.stringify(updatePayload)
        });
        setGlobalMessage("تم تحديث المستخدم بنجاح", false);
      } else {
        if (!payload.password) {
          throw new Error("كلمة المرور مطلوبة عند إنشاء مستخدم جديد");
        }
        await apiRequest("/api/users", {
          method: "POST",
          body: JSON.stringify(payload)
        });
        setGlobalMessage("تم إنشاء المستخدم بنجاح", false);
      }

      closeUserModal();
      resetUserForm();
      await loadUsersPanelData();
    } catch (error) {
      setGlobalMessage(error instanceof Error ? error.message : "فشل حفظ المستخدم", true);
    }
  });

  userCancelBtn.addEventListener("click", function () {
    closeUserModal();
    resetUserForm();
  });

  openUserModalBtn.addEventListener("click", function () {
    resetUserForm();
    userModalTitle.textContent = "إضافة مستخدم";
    openUserModal();
  });

  refreshUsersPanelBtn.addEventListener("click", function () {
    loadUsersPanelData().catch(function (error) {
      setGlobalMessage(error instanceof Error ? error.message : "تعذر تحديث بيانات المستخدمين", true);
    });
  });

  userModal.addEventListener("click", function (event) {
    if (event.target === userModal) {
      closeUserModal();
      resetUserForm();
    }
  });

  userRoleInput.addEventListener("change", function () {
    updateUserDeviceAssignmentVisibility();
    if (userRoleInput.value !== "emp") {
      clearUserDeviceSelections();
    }
  });

  function applyDeviceSearchFilter() {
    if (!devicesCardsGrid || !deviceSearchInput) {
      return;
    }

    var query = (deviceSearchInput.value || "").trim().toLowerCase();
    var cards = devicesCardsGrid.querySelectorAll(".device-card");
    cards.forEach(function (card) {
      var deviceName = (card.dataset && card.dataset.deviceName ? card.dataset.deviceName : "").toLowerCase();
      var isMatch = !query || deviceName.indexOf(query) !== -1;
      card.style.display = isMatch ? "" : "none";
    });
  }

  if (deviceSearchInput) {
    deviceSearchInput.addEventListener("input", applyDeviceSearchFilter);
  }

  if (exportDevicesBtn) {
    exportDevicesBtn.addEventListener("click", function () {
      if (typeof XLSX === "undefined") {
        setGlobalMessage("مكتبة Excel غير متاحة في المتصفح", true);
        return;
      }

      if (!devicesCardsGrid) {
        return;
      }

      var cards = Array.prototype.slice.call(devicesCardsGrid.querySelectorAll(".device-card"));
      var visibleCards = cards.filter(function (card) {
        return card.style.display !== "none";
      });

      var rows = visibleCards.map(function (card) {
        var deviceId = Number(card.dataset.deviceId || 0);
        var device = devicesStatusCache.find(function (item) {
          return Number(item.id) === Number(deviceId);
        });
        var liveStatus = device ? getLiveDeviceStatusForCard(device) : null;

        var internetValue = liveStatus && typeof liveStatus.internet === "string" ? liveStatus.internet.trim().toUpperCase() : "";
        var stateText = "لا توجد بيانات";
        if (internetValue === "UP") {
          stateText = "متصل";
        } else if (internetValue === "DOWN") {
          stateText = "غير متصل";
        }

        var dateValue = liveStatus && typeof liveStatus.date === "string" ? liveStatus.date.trim() : "";
        var timeValue = liveStatus && typeof liveStatus.time === "string" ? liveStatus.time.trim() : "";
        var lastUpdateText = "-";
        if (dateValue && timeValue) {
          lastUpdateText = dateValue + " " + timeValue;
        } else if (device && device.latestStatusTimestamp) {
          lastUpdateText = device.latestStatusTimestamp;
        }

        var batteryText = "-";
        if (liveStatus && Number.isFinite(Number(liveStatus.battery))) {
          batteryText = Number(liveStatus.battery).toFixed(1) + "%";
        }

        var temperatureText = "-";
        if (liveStatus && Number.isFinite(Number(liveStatus.temperature))) {
          temperatureText = Number(liveStatus.temperature).toFixed(1) + "°";
        }

        var pingText = "-";
        if (liveStatus && Number.isFinite(Number(liveStatus.ping))) {
          pingText = Number(liveStatus.ping).toFixed(1) + " ms";
        }

        var uptimeText = "-";
        if (liveStatus && typeof liveStatus.uptime === "string" && liveStatus.uptime.trim()) {
          uptimeText = liveStatus.uptime.trim();
        }

        return {
          الاسم: device ? device.name : card.dataset.deviceName || "-",
          الحالة: stateText,
          "آخر تحديث": lastUpdateText,
          البطارية: batteryText,
          الحرارة: temperatureText,
          Ping: pingText,
          "مدة التشغيل": uptimeText
        };
      });

      var wb = XLSX.utils.book_new();
      var ws = XLSX.utils.json_to_sheet(rows);
      XLSX.utils.book_append_sheet(wb, ws, "الأجهزة");
      XLSX.writeFile(wb, "devices-" + formatDateOnly(new Date()) + ".xlsx");
    });
  }

  openDeviceModalBtn.addEventListener("click", function () {
    resetDeviceForm();
    openDeviceModal();
  });

  deviceModal.addEventListener("click", function (event) {
    if (event.target === deviceModal) {
      closeDeviceModal();
      resetDeviceForm();
    }
  });

  deviceLocationModal.addEventListener("click", function (event) {
    if (event.target === deviceLocationModal) {
      closeDeviceLocationModalOverlay();
      editingDeviceForLocation = null;
    }
  });

  cancelDeviceLocationBtn.addEventListener("click", function () {
    closeDeviceLocationModalOverlay();
    clearDeviceLocationMessage();
    editingDeviceForLocation = null;
  });

  deviceLocationSearchInput.addEventListener("keypress", async function (event) {
    if (event.key !== "Enter") {
      return;
    }

    event.preventDefault();
    if (!deviceLocationMap) {
      return;
    }

    var query = String(deviceLocationSearchInput.value || "").trim();
    if (!query) {
      setDeviceLocationMessage("أدخل اسم مكان للبحث", true);
      return;
    }

    try {
      setDeviceLocationMessage("جاري البحث...", false);
      var response = await fetch(
        "https://nominatim.openstreetmap.org/search?format=json&q=" + encodeURIComponent(query)
      );
      var results = await response.json();
      if (!Array.isArray(results) || !results.length) {
        setDeviceLocationMessage("لم يتم العثور على نتائج", true);
        return;
      }

      var lat = Number(results[0].lat);
      var lon = Number(results[0].lon);
      if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
        setDeviceLocationMessage("نتيجة الموقع غير صالحة", true);
        return;
      }

      deviceLocationMap.setView([lat, lon], 13);
      setDeviceLocationMessage("تم نقل الخريطة، اضغط على النقطة المطلوبة للحفظ", false);
    } catch (_error) {
      setDeviceLocationMessage("فشل البحث عن المكان", true);
    }
  });

  saveDeviceLocationBtn.addEventListener("click", async function () {
    if (!editingDeviceForLocation) {
      setDeviceLocationMessage("تعذر تحديد الجهاز المطلوب", true);
      return;
    }

    if (!deviceLocationMarker) {
      setDeviceLocationMessage("اختر موقعاً على الخريطة أولاً", true);
      return;
    }

    var markerLatLng = deviceLocationMarker.getLatLng();
    var lat = Number(markerLatLng.lat);
    var lng = Number(markerLatLng.lng);

    if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
      setDeviceLocationMessage("إحداثيات الموقع غير صالحة", true);
      return;
    }

    try {
      await apiRequest("/api/devices/" + editingDeviceForLocation.id, {
        method: "PUT",
        body: JSON.stringify({ latitude: lat, longitude: lng })
      });
      closeDeviceLocationModalOverlay();
      editingDeviceForLocation = null;
      clearDeviceLocationMessage();
      await loadDevices();
      setGlobalMessage("تم حفظ موقع الجهاز بنجاح", false);
    } catch (error) {
      setDeviceLocationMessage(error instanceof Error ? error.message : "فشل حفظ الموقع", true);
    }
  });

  deviceForm.addEventListener("submit", async function (event) {
    event.preventDefault();
    if (!isAdmin) {
      setGlobalMessage("فقط المدير يمكنه إدارة الأجهزة", true);
      return;
    }

    var payload = {
      name: deviceNameInput.value.trim(),
      externalDeviceId: deviceExternalDeviceIdInput.value.trim() || null,
      description: deviceDescriptionInput.value.trim(),
      minFrequency: parseOptionalNumberInput(deviceMinFrequencyInput.value),
      maxFrequency: parseOptionalNumberInput(deviceMaxFrequencyInput.value)
    };

    if (
      Number.isFinite(payload.minFrequency) &&
      Number.isFinite(payload.maxFrequency) &&
      payload.maxFrequency <= payload.minFrequency
    ) {
      setGlobalMessage("يجب أن يكون أعلى تردد أكبر من أقل تردد", true);
      return;
    }

    try {
      if (editingDeviceId) {
        await apiRequest("/api/devices/" + editingDeviceId, {
          method: "PUT",
          body: JSON.stringify(payload)
        });
        setGlobalMessage("تم تحديث الجهاز بنجاح", false);
      } else {
        await apiRequest("/api/devices", {
          method: "POST",
          body: JSON.stringify(payload)
        });
        setGlobalMessage("تم إنشاء الجهاز بنجاح", false);
      }

      resetDeviceForm();
      closeDeviceModal();
      await loadDevices();
    } catch (error) {
      setGlobalMessage(error instanceof Error ? error.message : "فشل حفظ الجهاز", true);
    }
  });

  deviceCancelBtn.addEventListener("click", function () {
    resetDeviceForm();
    closeDeviceModal();
  });

  historyRangeForm.addEventListener("submit", async function (event) {
    event.preventDefault();
    if (!selectedDeviceId) {
      setGlobalMessage("يرجى اختيار جهاز أولًا", true);
      return;
    }

    var queryDateInput = document.getElementById("queryDate");
    var fromTimeInput = document.getElementById("fromTime");
    var toTimeInput = document.getElementById("toTime");
    if (
      !(queryDateInput instanceof HTMLInputElement) ||
      !(fromTimeInput instanceof HTMLInputElement) ||
      !(toTimeInput instanceof HTMLInputElement)
    ) {
      return;
    }

    if (!queryDateInput.value || !fromTimeInput.value || !toTimeInput.value) {
      setGlobalMessage("اليوم ووقت البداية ووقت النهاية حقول مطلوبة", true);
      return;
    }

    try {
      var range = buildSameDayRange(queryDateInput.value, fromTimeInput.value, toTimeInput.value);

      await loadDeviceHistory(selectedDeviceId, toIso(range.fromLocal), toIso(range.toLocal));
      setGlobalMessage("تم تحميل سجل النطاق للجهاز " + selectedDeviceName, false);
    } catch (error) {
      setGlobalMessage(error instanceof Error ? error.message : "فشل تحميل السجل", true);
    }
  });

  latest24Btn.addEventListener("click", async function () {
    if (!selectedDeviceId) {
      setGlobalMessage("يرجى اختيار جهاز أولًا", true);
      return;
    }

    try {
      await loadDeviceHistory(selectedDeviceId, null, null, {
        liveWindowMs: ONE_HOUR_WINDOW_MS,
        modeLabel: "latest1h"
      });
      setGlobalMessage("تم تحميل البث المباشر لآخر ساعة للجهاز " + selectedDeviceName, false);
    } catch (error) {
      setGlobalMessage(error instanceof Error ? error.message : "فشل تحميل السجل", true);
    }
  });

  latest5hBtn.addEventListener("click", async function () {
    try {
      await loadRecentHours(5, "آخر 5 ساعات");
    } catch (error) {
      setGlobalMessage(error instanceof Error ? error.message : "فشل تحميل السجل", true);
    }
  });

  latest24hBtn.addEventListener("click", async function () {
    try {
      await loadRecentHours(24, "آخر 24 ساعة");
    } catch (error) {
      setGlobalMessage(error instanceof Error ? error.message : "فشل تحميل السجل", true);
    }
  });

  latestPacketBtn.addEventListener("click", async function () {
    try {
      await loadLatestPacketOnly();
    } catch (error) {
      setGlobalMessage(error instanceof Error ? error.message : "فشل تحميل آخر باكت", true);
    }
  });

  multiViewBtn.addEventListener("click", function () {
    openMultiViewPicker();
  });

  multiViewCancelBtn.addEventListener("click", function () {
    closeMultiViewPicker();
  });

  multiViewContinueBtn.addEventListener("click", async function () {
    var selectedIds = getSelectedMultiViewDeviceIds();
    if (!selectedIds.length) {
      setGlobalMessage("اختر جهازًا واحدًا على الأقل", true);
      return;
    }

    closeMultiViewPicker();
    await openMultiViewOverlay(selectedIds);
  });

  multiViewPickerModal.addEventListener("click", function (event) {
    if (event.target === multiViewPickerModal) {
      closeMultiViewPicker();
    }
  });

  window.addEventListener("keydown", function (event) {
    if (event.key !== "Escape") {
      return;
    }

    if (!multiViewOverlay.classList.contains("hidden")) {
      closeMultiViewOverlay();
      return;
    }

    if (!multiViewPickerModal.classList.contains("hidden")) {
      closeMultiViewPicker();
    }
  });

  resetViewBtn.addEventListener("click", function () {
    resetViewport();
  });

  clearMarkersBtn.addEventListener("click", function () {
    if (!timeMarkers.length) {
      return;
    }

    timeMarkers = [];
    renderedTimeMarkerHits = [];
    scheduleRender({ skipTable: true });
  });

  bindHoldAction(panLeftBtn, function () {
    panViewport(-1, 0.08);
  });
  bindHoldAction(panRightBtn, function () {
    panViewport(1, 0.08);
  });
  bindHoldAction(zoomInBtn, function () {
    zoomViewport(0.9);
  });
  bindHoldAction(zoomOutBtn, function () {
    zoomViewport(1.11);
  });

  fitPacketsBtn.addEventListener("click", function () {
    fitViewportToPackets();
  });

  colorMapBtn.addEventListener("click", function () {
    toggleColorMap();
  });

  followLiveBtn.addEventListener("click", async function () {
    if (!selectedDeviceId) {
      return;
    }
    await loadDeviceHistory(selectedDeviceId, null, null, {
      liveWindowMs: DEFAULT_LIVE_WINDOW_MS,
      modeLabel: "latest30m"
    });
    updateFollowLiveButtonState();
  });

  applyIntensityBtn.addEventListener("click", function () {
    applyIntensitySettings();
  });

  applyFreqRangeBtn.addEventListener("click", applyFrequencyRangeFilter);
  clearFreqRangeBtn.addEventListener("click", clearFrequencyRangeFilter);
  freqMinInput.addEventListener("keydown", function (event) {
    if (event.key === "Enter") {
      applyFrequencyRangeFilter();
    }
  });
  freqMaxInput.addEventListener("keydown", function (event) {
    if (event.key === "Enter") {
      applyFrequencyRangeFilter();
    }
  });

  intensityModeSelect.addEventListener("change", function () {
    applyIntensitySettings();
  });

  displayGainInput.addEventListener("input", function () {
    applyDisplayGainSettings();
  });
  displayGainInput.addEventListener("change", function () {
    applyDisplayGainSettings();
  });

  [dbMinInput, dbMaxInput, pctLowInput, pctHighInput].forEach(function (inputEl) {
    inputEl.addEventListener("change", function () {
      applyIntensitySettings();
    });
  });

  applyNoiseBtn.addEventListener("click", function () {
    applyNoiseSettings();
  });

  [
    compareViewSelect,
    noiseSuppressionEnabledInput,
    noiseFloorPercentileInput,
    noiseThresholdInput,
    isolatedPixelRemovalEnabledInput,
    minActiveNeighborsInput,
    neighborhoodSizeSelect,
    bucketAggregationSelect,
    debugStatsEnabledInput
  ].forEach(function (el) {
    el.addEventListener("change", function () {
      applyNoiseSettings();
    });
  });

  logFrequencyViewToggle.addEventListener("change", function () {
    applyLogFrequencyViewSettings();
  });

  canvas.style.cursor = "grab";

  canvas.addEventListener("mousedown", function (event) {
    if (event.button !== 0) {
      return;
    }

    suppressNextProbeClick = false;
    pressStartedAtMs = Date.now();

    var markerHit = findMarkerHitAtCanvasPoint(event);
    if (markerHit && markerHit.markerIndex >= 0 && markerHit.markerIndex < timeMarkers.length) {
      isDraggingMarker = true;
      draggedMarkerIndex = markerHit.markerIndex;
      markerDragStartClientX = event.clientX;
      markerDragHasMoved = false;
      canvas.style.cursor = "ew-resize";
      gapTooltipEl.classList.add("hidden");
      event.preventDefault();
      return;
    }

    var span = getCurrentViewSpanMs();
    if (!span || span <= 0) {
      return;
    }

    isPanning = true;
    panHasMoved = false;
    panStartClientX = event.clientX;
    panStartFromMs = viewportFromMs;
    panStartToMs = viewportToMs;
    canvas.style.cursor = "grabbing";
    gapTooltipEl.classList.add("hidden");
    event.preventDefault();
  });

  window.addEventListener("mousemove", function (event) {
    if (isDraggingMarker) {
      if (!lastRenderMeta || !lastRenderMeta.layout) {
        return;
      }

      if (!Number.isFinite(lastRenderMeta.fromMs) || !Number.isFinite(lastRenderMeta.toMs)) {
        return;
      }

      if (draggedMarkerIndex < 0 || draggedMarkerIndex >= timeMarkers.length) {
        return;
      }

      var rect = canvas.getBoundingClientRect();
      var layout = lastRenderMeta.layout;
      var clampedX = clamp(event.clientX - rect.left, layout.plotLeft, layout.plotRight);
      var spanMs = lastRenderMeta.toMs - lastRenderMeta.fromMs;
      if (!Number.isFinite(spanMs) || spanMs <= 0) {
        return;
      }

      var xFrac = (clampedX - layout.plotLeft) / Math.max(1e-9, layout.plotRight - layout.plotLeft);
      var timeMs = lastRenderMeta.fromMs + xFrac * spanMs;

      timeMarkers[draggedMarkerIndex].timeMs = timeMs;
      if (!markerDragHasMoved && Math.abs(event.clientX - markerDragStartClientX) >= 3) {
        markerDragHasMoved = true;
      }

      scheduleRender({ skipTable: true });
      return;
    }

    if (!isPanning) {
      return;
    }

    var span = panStartToMs - panStartFromMs;
    if (!Number.isFinite(span) || span <= 0) {
      return;
    }

    var canvasWidth = Math.max(1, canvas.clientWidth || 1);
    var dx = event.clientX - panStartClientX;

    if (!panHasMoved && Math.abs(dx) >= PAN_MOVE_THRESHOLD_PX) {
      panHasMoved = true;
      liveManualBrowseActive = true;
    }

    var shiftMs = Math.round((-dx / canvasWidth) * span);

    viewportFromMs = panStartFromMs + shiftMs;
    viewportToMs = panStartToMs + shiftMs;
    scheduleRender({ skipTable: true });
    markInteractionActive();
  });

  window.addEventListener("mouseup", function () {
    if (isDraggingMarker) {
      isDraggingMarker = false;
      draggedMarkerIndex = -1;
      skipMarkerRemovalClick = markerDragHasMoved;
      markerDragHasMoved = false;
      canvas.style.cursor = "grab";
      scheduleRender({ skipTable: false });
      return;
    }

    if (!isPanning) {
      return;
    }
    var didPan = panHasMoved;
    var heldTooLong = pressStartedAtMs > 0 && Date.now() - pressStartedAtMs > CLICK_MAX_DURATION_MS;
    suppressNextProbeClick = didPan || heldTooLong;
    isPanning = false;
    panHasMoved = false;
    canvas.style.cursor = "grab";
    if (didPan) {
      scheduleRender({ skipTable: false });
    }
  });

  canvas.addEventListener(
    "wheel",
    function (event) {
      var rect = canvas.getBoundingClientRect();
      var x = event.clientX - rect.left;
      var anchor = clamp(x / Math.max(1, rect.width), 0, 1);

      if (Math.abs(event.deltaX) > Math.abs(event.deltaY) + 2) {
        var directionX = event.deltaX > 0 ? 1 : -1;
        panViewport(directionX, 0.05);
      } else if (event.shiftKey) {
        var directionY = event.deltaY > 0 ? 1 : -1;
        panViewport(directionY, 0.08);
      } else {
        var factor;
        if (event.altKey) {
          factor = event.deltaY < 0 ? 0.94 : 1.07;
        } else if (event.ctrlKey || event.metaKey) {
          factor = event.deltaY < 0 ? 0.8 : 1.24;
        } else {
          factor = event.deltaY < 0 ? 0.88 : 1.14;
        }
        zoomViewportAt(factor, anchor);
      }

      gapTooltipEl.classList.add("hidden");
      event.preventDefault();
    },
    { passive: false }
  );

  canvas.addEventListener("dblclick", function (event) {
    if (event.button !== 0) {
      event.preventDefault();
      return;
    }
    addTimeMarkerFromEvent(event);
    event.preventDefault();
  });

  canvas.addEventListener("contextmenu", function (event) {
    // Disable right-click zoom interaction on the canvas.
    event.preventDefault();
  });

  window.addEventListener("keydown", function (event) {
    if (isTypingTarget(event.target)) {
      return;
    }

    if (event.key === "ArrowLeft") {
      panViewport(-1, 0.1);
      event.preventDefault();
      return;
    }

    if (event.key === "ArrowRight") {
      panViewport(1, 0.1);
      event.preventDefault();
      return;
    }

    if (event.key === "+" || event.key === "=") {
      zoomViewport(0.88);
      event.preventDefault();
      return;
    }

    if (event.key === "-") {
      zoomViewport(1.14);
      event.preventDefault();
      return;
    }

    if (event.key === "0") {
      resetViewport();
      event.preventDefault();
      return;
    }

    if (event.key === "f" || event.key === "F") {
      fitViewportToPackets();
      event.preventDefault();
      return;
    }

    if ((event.key === "l" || event.key === "L") && selectedDeviceId) {
      loadDeviceHistory(selectedDeviceId).catch(function (error) {
        setGlobalMessage(error instanceof Error ? error.message : "فشل التبديل إلى الوضع المباشر", true);
      });
      event.preventDefault();
      return;
    }

    if (event.key === "Escape") {
      probeTooltipEl.classList.add("hidden");
    }
  });

  function formatGapTooltip(gap) {
    var mins = Math.round(gap.durationMs / 60000);
    return (
      "فجوة بيانات<br>" +
      "البداية: " +
      formatLocalDateTime(gap.start) +
      "<br>النهاية: " +
      formatLocalDateTime(gap.end) +
      "<br>المدة: " +
      mins +
      " دقيقة"
    );
  }

  function getPacketValueAt(packet, row, col) {
    if (!packet || !Array.isArray(packet.data) || packet.data.length === 0 || !Array.isArray(packet.data[0])) {
      return NaN;
    }

    if (!Array.isArray(packet.data[row])) {
      return NaN;
    }

    var value = packet.data[row][col];
    return Number.isFinite(value) ? value : NaN;
  }

  function magnitudeToDb(value) {
    var n = Number(value);
    if (!Number.isFinite(n) || n <= 0) {
      return Number.NEGATIVE_INFINITY;
    }
    return 20 * Math.log10(n);
  }

  function formatDbValue(dbValue) {
    if (!Number.isFinite(dbValue)) {
      return "-inf dB";
    }
    return dbValue.toFixed(1) + " dB";
  }

  function findProbeSample(timeMs, rowIndex) {
    if (!lastRenderMeta || !Number.isFinite(lastRenderMeta.fromMs) || !Number.isFinite(lastRenderMeta.toMs)) {
      return null;
    }

    var visiblePackets = getVisiblePackets(lastRenderMeta.fromMs, lastRenderMeta.toMs);
    for (var i = 0; i < visiblePackets.length; i += 1) {
      var packet = visiblePackets[i];
      var matrix = packet && packet.data;
      if (!Array.isArray(matrix) || matrix.length === 0 || !Array.isArray(matrix[0]) || matrix[0].length === 0) {
        continue;
      }

      var rows = matrix.length;
      var cols = matrix[0].length;
      if (rowIndex < 0 || rowIndex >= rows) {
        continue;
      }

      var interval = getPacketInterval(packet);
      var startMs;
      var endMs;
      if (interval) {
        startMs = interval.startMs;
        endMs = interval.endMs;
      } else {
        var ts = getPacketTimestampMs(packet);
        if (!Number.isFinite(ts)) {
          continue;
        }
        var stepMs = Number(packet.timeStepMs || activeTimeStepMs);
        if (!Number.isFinite(stepMs) || stepMs <= 0) {
          stepMs = 1;
        }
        startMs = ts - (cols - 1) * stepMs;
        endMs = ts + stepMs;
      }

      if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || endMs <= startMs) {
        continue;
      }

      if (timeMs < startMs || timeMs > endMs) {
        continue;
      }

      var colIndex = Math.floor(((timeMs - startMs) / (endMs - startMs)) * cols);
      colIndex = clamp(colIndex, 0, cols - 1);

      return {
        packet: packet,
        rowIndex: rowIndex,
        colIndex: colIndex,
        rows: rows,
        cols: cols
      };
    }

    return null;
  }

  function getProbeFrequencyHz(sample) {
    var bins = getPacketFrequencyBins(sample.packet);
    if (bins && bins.length === sample.rows) {
      return bins[sample.rowIndex];
    }

    if (
      lastRenderMeta &&
      Number.isFinite(lastRenderMeta.minFrequency) &&
      Number.isFinite(lastRenderMeta.maxFrequency) &&
      lastRenderMeta.maxFrequency > lastRenderMeta.minFrequency
    ) {
      if (sample.rows <= 1) {
        return lastRenderMeta.minFrequency;
      }
      var ratio = sample.rowIndex / (sample.rows - 1);
      return lastRenderMeta.minFrequency + ratio * (lastRenderMeta.maxFrequency - lastRenderMeta.minFrequency);
    }

    return null;
  }

  function buildProbeInfo(event) {
    if (!lastRenderMeta || !lastRenderMeta.layout) {
      return null;
    }

    var rect = canvas.getBoundingClientRect();
    var x = event.clientX - rect.left;
    var y = event.clientY - rect.top;
    var layout = lastRenderMeta.layout;

    if (x < layout.plotLeft || x > layout.plotRight || y < layout.plotTop || y > layout.plotBottom) {
      return null;
    }

    if (!Number.isFinite(lastRenderMeta.fromMs) || !Number.isFinite(lastRenderMeta.toMs)) {
      return null;
    }

    var xFrac = clamp((x - layout.plotLeft) / Math.max(1, layout.plotRight - layout.plotLeft), 0, 1);
    var yFrac = clamp((y - layout.plotTop) / Math.max(1, layout.plotBottom - layout.plotTop), 0, 1);
    var timeMs = lastRenderMeta.fromMs + xFrac * (lastRenderMeta.toMs - lastRenderMeta.fromMs);
    var rowIndex = Math.round((1 - yFrac) * Math.max(0, lastRenderMeta.binCount - 1));

    if (
      activeLogFrequencyView &&
      window.LogSpectrogram &&
      typeof window.LogSpectrogram.getLastRenderInfo === "function" &&
      typeof window.LogSpectrogram.positionToFrequency === "function"
    ) {
      var logInfo = window.LogSpectrogram.getLastRenderInfo();
      if (
        logInfo &&
        Number.isFinite(logInfo.viewMinHz) &&
        Number.isFinite(logInfo.viewMaxHz) &&
        logInfo.viewMaxHz > logInfo.viewMinHz
      ) {
        var positionFromLow = logInfo.lowAtTop ? yFrac : 1 - yFrac;
        var probeHz = window.LogSpectrogram.positionToFrequency(positionFromLow);
        if (Number.isFinite(probeHz)) {
          var hzRatio = (probeHz - logInfo.viewMinHz) / (logInfo.viewMaxHz - logInfo.viewMinHz);
          rowIndex = Math.round(
            Math.min(1, Math.max(0, hzRatio)) * Math.max(0, lastRenderMeta.binCount - 1)
          );
        }
      }
    }

    var sample = findProbeSample(timeMs, rowIndex);
    if (!sample) {
      return null;
    }

    var rawValue = getPacketValueAt(sample.packet, sample.rowIndex, sample.colIndex);
    var dbValue = magnitudeToDb(rawValue);
    var freqHz = getProbeFrequencyHz(sample);

    return {
      timeMs: timeMs,
      rowIndex: sample.rowIndex,
      colIndex: sample.colIndex,
      rawValue: rawValue,
      dbValue: dbValue,
      freqHz: freqHz
    };
  }

  function formatProbeTooltip(info) {
    var frequencyText = Number.isFinite(info.freqHz)
      ? Math.round(info.freqHz) + " Hz"
      : "نطاق " + info.rowIndex;

    return (
      "نقطة فحص<br>" +
      "الوقت: " +
      new Date(info.timeMs).toISOString().replace(".000Z", "") +
      "<br>التردد: " +
      frequencyText +
      "<br>القيمة الخام: " +
      (Number.isFinite(info.rawValue) ? info.rawValue.toFixed(3) : "NaN") +
      "<br>السعة: " +
      formatDbValue(info.dbValue)
    );
  }

  canvas.addEventListener("mousemove", function (event) {
    if (isPanning || !lastRenderMeta || !Array.isArray(lastRenderMeta.gaps) || !lastRenderMeta.layout) {
      gapTooltipEl.classList.add("hidden");
      return;
    }

    var rect = canvas.getBoundingClientRect();
    var x = event.clientX - rect.left;
    var y = event.clientY - rect.top;
    var layout = lastRenderMeta.layout;

    if (x < layout.plotLeft || x > layout.plotRight || y < layout.plotTop || y > layout.plotBottom) {
      gapTooltipEl.classList.add("hidden");
      return;
    }

    var hitGap = null;
    for (var i = 0; i < lastRenderMeta.gaps.length; i += 1) {
      var gap = lastRenderMeta.gaps[i];
      if (x >= gap.xStart && x <= gap.xEnd) {
        hitGap = gap;
        break;
      }
    }

    if (!hitGap) {
      gapTooltipEl.classList.add("hidden");
      return;
    }

    gapTooltipEl.innerHTML = formatGapTooltip(hitGap);
    gapTooltipEl.style.left = event.clientX + 14 + "px";
    gapTooltipEl.style.top = event.clientY + 14 + "px";
    gapTooltipEl.classList.remove("hidden");
  });

  canvas.addEventListener("mouseleave", function () {
    gapTooltipEl.classList.add("hidden");
  });

  canvas.addEventListener("click", function (event) {
    if (suppressNextProbeClick) {
      suppressNextProbeClick = false;
      return;
    }

    if (isPanning) {
      return;
    }

    if (skipMarkerRemovalClick) {
      skipMarkerRemovalClick = false;
      return;
    }

    if (removeTimeMarkerAtCanvasPoint(event)) {
      probeTooltipEl.classList.add("hidden");
      return;
    }

    var info = buildProbeInfo(event);
    if (!info) {
      probeTooltipEl.classList.add("hidden");
      return;
    }

    probeTooltipEl.innerHTML = formatProbeTooltip(info);
    probeTooltipEl.style.left = event.clientX + 14 + "px";
    probeTooltipEl.style.top = event.clientY + 14 + "px";
    probeTooltipEl.classList.remove("hidden");
    scheduleProbeAutoHide();
  });

  function setupSocket() {
    var socket = io({
      auth: {
        token: token
      }
    });
    var lastHeartbeatAt = 0;

    function markHeartbeat() {
      lastHeartbeatAt = Date.now();
      setSocketStatus(true, "نبضة الاتصال سليمة");
    }

    socket.on("connect", function () {
      markHeartbeat();
      socket.emit("client:heartbeat", { ts: Date.now() });
    });

    socket.on("disconnect", function (reason) {
      setSocketStatus(false, reason || "انقطع الاتصال");
    });

    socket.on("connect_error", function () {
      setSocketStatus(false, "خطأ في الاتصال");
    });

    socket.on("server:heartbeat", function () {
      markHeartbeat();
    });

    socket.on("devices_status", function (payload) {
      var normalizedPayload = normalizeLiveDeviceStatusPayload(payload);
      if (!Object.keys(normalizedPayload).length) {
        return;
      }

      liveDeviceStatusMap = Object.assign({}, liveDeviceStatusMap, normalizedPayload);
      saveStoredLiveDeviceStatus(liveDeviceStatusMap);
      if (devicesCardsGrid) {
        renderDevicesViews(devicesStatusCache);
      }
    });

    socket.on("ping", function (entries) {
      // TEMP DEBUG
      console.log("[ping] raw entries received:", entries);
      if (!Array.isArray(entries)) {
        return;
      }

      var changed = false;
      entries.forEach(function (entry) {
        if (!entry) {
          return;
        }
        var key = normalizeDeviceStatusKey(entry.device_id || entry.deviceId);
        if (!key) {
          return;
        }
        var existing = liveDeviceStatusMap[key] || {};
        // TEMP DEBUG
        console.log("[ping] device=" + key, "existing before merge:", existing);
        var mergedResult = Object.assign({}, existing, {
          internet: entry.status,
          ping: entry.ping,
          date: entry.date || existing.date,
          time: entry.time || existing.time
        });
        // TEMP DEBUG
        console.log("[ping] device=" + key, "merged result:", mergedResult);
        liveDeviceStatusMap[key] = mergedResult;
        changed = true;
      });

      if (!changed) {
        return;
      }

      saveStoredLiveDeviceStatus(liveDeviceStatusMap);
      if (devicesCardsGrid) {
        renderDevicesViews(devicesStatusCache);
      }
    });

    var heartbeatTimer = setInterval(function () {
      if (!socket.connected) {
        setSocketStatus(false, "جاري إعادة المحاولة");
        return;
      }

      if (lastHeartbeatAt && Date.now() - lastHeartbeatAt > 30000) {
        setSocketStatus(false, "لا توجد نبضات اتصال");
      }

      socket.emit("client:heartbeat", { ts: Date.now() });
    }, 15000);

    socket.on("device:data", function (payload) {
      handleMultiViewLivePayload(payload);
      markLiveTrace("socket-received");

      if (!payloadMatchesSelectedDevice(payload)) {
        markLiveTrace("drop-device", { issue: "payload does not match selected device" });
        return;
      }
      markLiveTrace("socket-matched");

      normalizePacketTiming(payload);
      var payloadTime = getPacketTimestampMs(payload);
      if (!Number.isFinite(payloadTime)) {
        markLiveTrace("drop-time", { issue: "payload timestamp is invalid" });
        return;
      }

      if (isHistoryLoading) {
        pendingLivePackets.push(payload);
        markLiveTrace("buffered", { packetTimeMs: payloadTime });
        return;
      }

      var inserted = insertPacketSorted(payload);
      if (!inserted) {
        markLiveTrace("duplicate", { packetTimeMs: payloadTime });
        return;
      }
      expectingLiveRender = true;
      markLiveTrace("inserted", { packetTimeMs: payloadTime });
      if (liveFollowEnabled) {
        liveManualBrowseActive = false;
        syncLatestLiveViewport(getPacketEndMs(payload));
      }
      scheduleRender({ skipTable: false });

      if (payload.persisted === false) {
        var nowMs = Date.now();
        if (nowMs - lastPersistenceWarningAt > 10000) {
          lastPersistenceWarningAt = nowMs;
          setGlobalMessage(
            "تم استقبال بيانات مباشرة للجهاز " + selectedDeviceName + " لكن فشل حفظ باكت واحد على الأقل في قاعدة البيانات.",
            true
          );
        }
      }

      historyInfoEl.textContent =
        "تحديث مباشر | عدد الباكتات: " +
        currentPackets.length +
        " | آخر توقيت: " +
        formatLocalDateTime(payload.timestamp) +
        " | النمط: " +
        activeRangeMode;
    });

    socket.on("device:error", function (payload) {
      if (payload && payload.message) {
        setGlobalMessage(payload.message, true);
      }
    });
  }

  logoutBtn.addEventListener("click", function () {
    localStorage.removeItem("token");
    localStorage.removeItem("user");
    window.location.href = "/login";
  });

  window.DashboardBridge = {
    apiRequest: apiRequest,
    getDevices: function () {
      return devicesCache.slice();
    },
    getSelectedDeviceId: function () {
      return selectedDeviceId;
    },
    getCurrentUser: function () {
      return user;
    },
    activateTab: activateTab,
    setGlobalMessage: setGlobalMessage
  };

  activateTab("history");
  resetUserForm();
  resetDeviceForm();

  var queryDateInput = document.getElementById("queryDate");
  var fromTimeInput = document.getElementById("fromTime");
  var toTimeInput = document.getElementById("toTime");
  if (
    queryDateInput instanceof HTMLInputElement &&
    fromTimeInput instanceof HTMLInputElement &&
    toTimeInput instanceof HTMLInputElement
  ) {
    var now = new Date();
    var fromDate = new Date(now.getTime() - 30 * 60 * 1000);
    queryDateInput.value = formatDateOnly(now);
    fromTimeInput.value = formatTimeOnly(fromDate);
    toTimeInput.value = formatTimeOnly(now);
  }

  loadDevices().catch(function (error) {
    setGlobalMessage(error instanceof Error ? error.message : "Failed to load devices", true);
  });

  if (isAdmin) {
    loadUsersPanelData().catch(function (error) {
      setGlobalMessage(error instanceof Error ? error.message : "Failed to load users", true);
    });
  }

  if (!isAdmin) {
    userFormMessage.textContent = "فقط المدير يمكنه إضافة أو تعديل أو حذف المستخدمين.";
    deviceFormMessage.textContent = "فقط المدير يمكنه إضافة أو تعديل أو حذف الأجهزة.";
    tabButtons.forEach(function (btn) {
      var tabName = btn.getAttribute("data-tab");
      if (tabName === "users" || tabName === "devices") {
        btn.classList.add("hidden");
      }
    });
    if (usersPanel.classList.contains("active") || devicesPanel.classList.contains("active")) {
      activateTab("history");
    }
  }

  toggleRightPanelBtn.addEventListener("click", function () {
    var willCollapse = !rightPanel.classList.contains("collapsed");
    setRightPanelCollapsed(willCollapse);
    scheduleRender({ skipTable: false });
    window.setTimeout(function () {
      scheduleRender({ skipTable: false });
    }, 240);
  });

  window.addEventListener("resize", function () {
    scheduleRender({ skipTable: false });
  });

  toggleMapFullscreenBtn.addEventListener("click", function () {
    var container = document.getElementById("topLevelDevicesMapContainer");
    if (!container) {
      return;
    }
    if (!document.fullscreenElement) {
      container.requestFullscreen().catch(function () {});
    } else {
      document.exitFullscreen();
    }
  });

  document.addEventListener("fullscreenchange", function () {
    if (devicesOverviewMapInstance) {
      devicesOverviewMapInstance.invalidateSize();
    }
  });

  var mapPanelObserver = new MutationObserver(function (mutations) {
    mutations.forEach(function (mutation) {
      if (
        mutation.type === "attributes" &&
        mutation.attributeName === "class" &&
        mapPanel.classList.contains("active") &&
        devicesOverviewMapInstance
      ) {
        devicesOverviewMapInstance.invalidateSize();
        if (!hasFitInitialOverviewBounds) {
          if (lastKnownDeviceBounds.length > 0) {
            devicesOverviewMapInstance.fitBounds(L.latLngBounds(lastKnownDeviceBounds), { padding: [40, 40] });
          } else {
            var syriaBounds = L.latLngBounds([[32.0, 35.5], [37.5, 42.5]]);
            devicesOverviewMapInstance.fitBounds(syriaBounds);
          }
          hasFitInitialOverviewBounds = true;
        }
      }
    });
  });

  mapPanelObserver.observe(mapPanel, {
    attributes: true,
    attributeFilter: ["class"]
  });

  window.Spectrogram.configure({
    colorMap: "magma",
    inputValueMax: 255,
    gamma: 1.0,
    axisMinFrequency: 30,
    intensityMode: "linear",
    dbMin: -95,
    dbMax: -20,
    percentileLow: 5,
    percentileHigh: 99,
    noiseSuppressionEnabled: true,
    noiseFloorPercentile: 72,
    noiseThreshold: 0.06,
    isolatedPixelRemovalEnabled: true,
    minActiveNeighbors: 1,
    neighborhoodSize: 3,
    morphologyEnabled: true,
    compareView: "denoised",
    bucketAggregation: "max",
    debugStatsEnabled: false
  });
  activeColorMap = "magma";
  updateColorMapButtonLabel();
  displayGainInput.value = String(activeDisplayGainDb);
  displayGainValue.textContent = String(activeDisplayGainDb) + " dB";
  intensityModeSelect.value = activeIntensityMode;
  dbMinInput.value = String(activeDbMin);
  dbMaxInput.value = String(activeDbMax);
  pctLowInput.value = String(activePercentileLow);
  pctHighInput.value = String(activePercentileHigh);
  compareViewSelect.value = activeCompareView;
  noiseSuppressionEnabledInput.checked = activeNoiseSuppressionEnabled;
  noiseFloorPercentileInput.value = String(activeNoiseFloorPercentile);
  noiseThresholdInput.value = String(activeNoiseThreshold);
  isolatedPixelRemovalEnabledInput.checked = activeIsolatedPixelRemovalEnabled;
  minActiveNeighborsInput.value = String(activeMinActiveNeighbors);
  neighborhoodSizeSelect.value = String(activeNeighborhoodSize);
  bucketAggregationSelect.value = activeBucketAggregation;
  debugStatsEnabledInput.checked = activeDebugStatsEnabled;
  activeLogFrequencyView = readStoredLogFrequencyView();
  logFrequencyViewToggle.checked = activeLogFrequencyView;
  updateIntensityControlsState();
  applyNoiseSettings();
  updateFollowLiveButtonState();
  window.Spectrogram.drawLegend(legendCanvas);

  setupSocket();
})();
