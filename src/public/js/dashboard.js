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
  var panStartClientX = 0;
  var panStartFromMs = 0;
  var panStartToMs = 0;
  var renderRafId = null;
  var pendingRenderOptions = null;
  var interactionEndTimer = null;
  var lastRenderMeta = null;
  var devicesCache = [];
  var editingUserId = null;
  var editingDeviceId = null;
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

  var topNav = document.getElementById("topNav");
  var dashboardLayoutEl = document.getElementById("dashboardLayout");
  var tabButtons = document.querySelectorAll(".tab-btn");
  var historyPanel = document.getElementById("historyPanel");
  var usersPanel = document.getElementById("usersPanel");
  var devicesPanel = document.getElementById("devicesPanel");
  var globalMessageEl = document.getElementById("globalMessage");
  var userBadgeEl = document.getElementById("userBadge");
  var socketStatusBadgeEl = document.getElementById("socketStatusBadge");
  var rightPanelEl = document.getElementById("rightPanel");
  var toggleRightPanelBtn = document.getElementById("toggleRightPanelBtn");

  var deviceListEl = document.getElementById("deviceList");
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

  var devicesTableBody = document.getElementById("devicesTableBody");
  var deviceForm = document.getElementById("deviceForm");
  var deviceIdInput = document.getElementById("deviceId");
  var deviceNameInput = document.getElementById("deviceName");
  var deviceDescriptionInput = document.getElementById("deviceDescription");
  var deviceMinFrequencyInput = document.getElementById("deviceMinFrequency");
  var deviceMaxFrequencyInput = document.getElementById("deviceMaxFrequency");
  var deviceSaveBtn = document.getElementById("deviceSaveBtn");
  var deviceCancelBtn = document.getElementById("deviceCancelBtn");
  var deviceFormMessage = document.getElementById("deviceFormMessage");

  var logoutBtn = document.getElementById("logoutBtn");

  if (
    !topNav ||
    !dashboardLayoutEl ||
    !historyPanel ||
    !usersPanel ||
    !devicesPanel ||
    !globalMessageEl ||
    !userBadgeEl ||
    !socketStatusBadgeEl ||
    !rightPanelEl ||
    !toggleRightPanelBtn ||
    !deviceListEl ||
    !selectedDeviceTitleEl ||
    !historyInfoEl ||
    !historyTableBody ||
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
    !devicesTableBody ||
    !deviceForm ||
    !deviceIdInput ||
    !deviceNameInput ||
    !deviceDescriptionInput ||
    !deviceMinFrequencyInput ||
    !deviceMaxFrequencyInput ||
    !deviceSaveBtn ||
    !deviceCancelBtn ||
    !deviceFormMessage ||
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
    rightPanelEl.classList.toggle("collapsed", !!collapsed);
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
    usersPanel.classList.toggle("active", tabName === "users");
    devicesPanel.classList.toggle("active", tabName === "devices");
    setGlobalMessage("", false);
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
      historyTableBody.innerHTML = "";
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
    var intensityType = null;
    for (var i = 0; i < visiblePackets.length; i += 1) {
      var packet = visiblePackets[i];
      if (!intensityType && typeof packet.intensityType === "string") {
        intensityType = packet.intensityType;
      }
      var packetBins = getPacketFrequencyBins(packet);
      if (packetBins && packetBins.length > 1) {
        frequencyBins = packetBins;
        minFrequency = packetBins[0];
        maxFrequency = packetBins[packetBins.length - 1];
        if (maxFrequency > minFrequency) {
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

    var renderResult = window.Spectrogram.renderSpectrogram({
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
      frequencyBins: frequencyBins,
      minFrequency: minFrequency,
      maxFrequency: maxFrequency,
      displayMinFrequency: displayFrequencyRange ? displayFrequencyRange.min : null,
      displayMaxFrequency: displayFrequencyRange ? displayFrequencyRange.max : null
    });
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
    var cssHeight = Math.max(320, Math.floor((canvas.clientWidth || 960) * 0.43));
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
    historyTableBody.innerHTML = "";
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
      latestPacket = await apiRequest("/api/devices/" + selectedDeviceId + "/history/latest");
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

    decodePacketMatrix(latestPacket);
    normalizePacketTiming(latestPacket);
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
    renderDevicesTable();
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
      historyTableBody.innerHTML = "";
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
    userFormMessage.textContent = "";
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
    deviceDescriptionInput.value = "";
    deviceMinFrequencyInput.value = "";
    deviceMaxFrequencyInput.value = "";
    deviceSaveBtn.textContent = "إضافة جهاز";
    deviceFormMessage.textContent = "";
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
            userFormMessage.textContent = "تعديل المستخدم رقم " + u.id;
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
              if (Number(editingUserId) === Number(u.id)) {
                resetUserForm();
              }
              await loadUsers();
              setGlobalMessage("تم حذف المستخدم بنجاح", false);
            } catch (error) {
              setGlobalMessage(error instanceof Error ? error.message : "فشل الحذف", true);
            }
          });

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

  function renderDevicesTable() {
    devicesTableBody.innerHTML = "";

    devicesCache.forEach(function (device) {
      var tr = document.createElement("tr");
      tr.innerHTML =
        "<td>" +
        device.id +
        "</td><td>" +
        device.name +
        "</td><td>" +
        (device.description || "") +
        "</td><td>" +
        (Number.isFinite(device.minFrequency) && Number.isFinite(device.maxFrequency)
          ? device.minFrequency + " - " + device.maxFrequency + " Hz"
          : "-") +
        "</td>";

      if (isAdmin) {
        var actionTd = document.createElement("td");
        actionTd.className = "action-buttons";

        var editBtn = document.createElement("button");
        editBtn.type = "button";
        editBtn.className = "ghost-btn";
          editBtn.textContent = "تعديل";
        editBtn.addEventListener("click", function () {
          editingDeviceId = device.id;
          deviceIdInput.value = String(device.id);
          deviceNameInput.value = device.name;
          deviceDescriptionInput.value = device.description || "";
          deviceMinFrequencyInput.value = Number.isFinite(device.minFrequency) ? String(device.minFrequency) : "";
          deviceMaxFrequencyInput.value = Number.isFinite(device.maxFrequency) ? String(device.maxFrequency) : "";
          deviceSaveBtn.textContent = "تحديث جهاز";
          deviceFormMessage.textContent = "تعديل الجهاز رقم " + device.id;
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
            }
            await loadDevices();
            setGlobalMessage("تم حذف الجهاز بنجاح", false);
          } catch (error) {
            setGlobalMessage(error instanceof Error ? error.message : "فشل الحذف", true);
          }
        });

        actionTd.appendChild(editBtn);
        actionTd.appendChild(deleteBtn);
        tr.appendChild(actionTd);
      }

      devicesTableBody.appendChild(tr);
    });
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

      resetUserForm();
      await loadUsers();
    } catch (error) {
      setGlobalMessage(error instanceof Error ? error.message : "فشل حفظ المستخدم", true);
    }
  });

  userCancelBtn.addEventListener("click", function () {
    resetUserForm();
  });

  userRoleInput.addEventListener("change", function () {
    updateUserDeviceAssignmentVisibility();
    if (userRoleInput.value !== "emp") {
      clearUserDeviceSelections();
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
      await loadDevices();
    } catch (error) {
      setGlobalMessage(error instanceof Error ? error.message : "فشل حفظ الجهاز", true);
    }
  });

  deviceCancelBtn.addEventListener("click", function () {
    resetDeviceForm();
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

  canvas.style.cursor = "grab";

  canvas.addEventListener("mousedown", function (event) {
    if (event.button !== 0) {
      return;
    }

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

    if (!panHasMoved && Math.abs(dx) >= 3) {
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
    isPanning = false;
    panHasMoved = false;
    canvas.style.cursor = "grab";
    scheduleRender({ skipTable: false });
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
    loadUsers().catch(function (error) {
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
    var willCollapse = !rightPanelEl.classList.contains("collapsed");
    setRightPanelCollapsed(willCollapse);
    scheduleRender({ skipTable: false });
    window.setTimeout(function () {
      scheduleRender({ skipTable: false });
    }, 240);
  });

  window.addEventListener("resize", function () {
    scheduleRender({ skipTable: false });
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
  updateIntensityControlsState();
  applyNoiseSettings();
  updateFollowLiveButtonState();
  window.Spectrogram.drawLegend(legendCanvas);

  setupSocket();
})();
