(function () {
  var DEFAULT_CONFIG = {
    matrixOrientation: "frequency-time",
    blockTimestampMode: "end",
    colorMap: "magma",
    inputValueMax: 255,
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
    debugStatsEnabled: false,
    bucketAggregation: "max",
    gamma: 1.0,
    smoothVertical: true,
    axisMinFrequency: 30,
    displayGainDb: 0,
    background: "#140d28",
    gapFill: "rgba(54, 103, 194, 0.26)",
    gapStroke: "rgba(102, 196, 231, 0.9)",
    axisColor: "#cfd7e6",
    gridColor: "rgba(207, 215, 230, 0.16)",
    textColor: "#d8e2ff",
    maxFastColumnStride: 8
  };

  var COLOR_MAP_STOPS = {
    magma: [
      { p: 0.0, c: [0, 0, 4] },
      { p: 0.16, c: [28, 16, 68] },
      { p: 0.33, c: [79, 18, 123] },
      { p: 0.5, c: [129, 37, 129] },
      { p: 0.66, c: [181, 54, 122] },
      { p: 0.83, c: [229, 80, 100] },
      { p: 1.0, c: [252, 253, 191] }
    ],
    sunset: [
      { p: 0.0, c: [15, 16, 50] },
      { p: 0.2, c: [45, 24, 105] },
      { p: 0.4, c: [98, 33, 135] },
      { p: 0.6, c: [170, 52, 112] },
      { p: 0.8, c: [235, 96, 70] },
      { p: 1.0, c: [255, 190, 92] }
    ]
  };

  var WEBGL_RENDERER = {
    supported: null,
    canvas: null,
    gl: null,
    program: null,
    vertexBuffer: null,
    intensityTexture: null,
    paletteTexture: null,
    positionLocation: null,
    intensityLocation: null,
    paletteLocation: null,
    paletteKey: ""
  };

  var PROCESS_CONTEXT_CACHE = new Map();
  var BLOCK_PROCESS_CACHE = new WeakMap();
  var MAX_PROCESS_CONTEXT_CACHE = 24;
  var MAX_BLOCK_KEYS_PER_PACKET = 6;
  var FrequencyMapping = (typeof window !== "undefined" && window.FrequencyMapping) || {
    getFrequencyBinDirection: function (frequencyBins) {
      if (!Array.isArray(frequencyBins) || frequencyBins.length < 2) {
        return "ascending";
      }

      var ascending = true;
      var descending = true;
      for (var i = 1; i < frequencyBins.length; i += 1) {
        var prev = Number(frequencyBins[i - 1]);
        var curr = Number(frequencyBins[i]);
        if (!Number.isFinite(prev) || !Number.isFinite(curr)) {
          return "ascending";
        }
        if (curr > prev) {
          descending = false;
        }
        if (curr < prev) {
          ascending = false;
        }
      }

      if (ascending) {
        return "ascending";
      }
      if (descending) {
        return "descending";
      }
      return "mixed";
    },
    mapRawRowToScreen: function (rowIndex, frequencyBins, rowCount) {
      var count = Number(rowCount);
      if (!Number.isFinite(count) || count <= 0) {
        return 0;
      }

      var safeCount = Math.max(1, Math.floor(count));
      var safeIndex = Math.max(0, Math.min(safeCount - 1, Math.round(Number(rowIndex) || 0)));
      if (FrequencyMapping.getFrequencyBinDirection(frequencyBins) === "descending") {
        return safeIndex;
      }
      return safeCount - 1 - safeIndex;
    },
    mapScreenYToRawRow: function (screenY, frequencyBins, rowCount) {
      var count = Number(rowCount);
      if (!Number.isFinite(count) || count <= 0) {
        return 0;
      }

      var safeCount = Math.max(1, Math.floor(count));
      var safeIndex = Math.max(0, Math.min(safeCount - 1, Math.round(Number(screenY) || 0)));
      if (FrequencyMapping.getFrequencyBinDirection(frequencyBins) === "descending") {
        return safeIndex;
      }
      return safeCount - 1 - safeIndex;
    }
  };

  function clamp01(value) {
    var n = Number(value);
    if (!Number.isFinite(n)) return 0;
    if (n < 0) return 0;
    if (n > 1) return 1;
    return n;
  }

  function lerp(a, b, t) {
    return a + (b - a) * t;
  }

  function normalizeIntensity(value) {
    var n = Number(value);
    if (!Number.isFinite(n)) {
      return 0;
    }

    if (n <= 1) {
      return clamp01(n);
    }

    var maxValue = Number(DEFAULT_CONFIG.inputValueMax);
    if (!Number.isFinite(maxValue) || maxValue <= 0) {
      maxValue = 255;
    }

    return clamp01(n / maxValue);
  }

  function getColorStops() {
    var mapName = String(DEFAULT_CONFIG.colorMap || "").toLowerCase();
    return COLOR_MAP_STOPS[mapName] || COLOR_MAP_STOPS.magma;
  }

  function valueToColor(value) {
    var gamma = Number(DEFAULT_CONFIG.gamma);
    if (!Number.isFinite(gamma) || gamma <= 0) {
      gamma = 1.0;
    }

    var v = Math.pow(normalizeIntensity(value), gamma);
    var stops = getColorStops();

    for (var i = 0; i < stops.length - 1; i += 1) {
      var a = stops[i];
      var b = stops[i + 1];
      if (v >= a.p && v <= b.p) {
        var t = (v - a.p) / (b.p - a.p || 1);
        return [
          Math.round(lerp(a.c[0], b.c[0], t)),
          Math.round(lerp(a.c[1], b.c[1], t)),
          Math.round(lerp(a.c[2], b.c[2], t))
        ];
      }
    }

    return stops[stops.length - 1].c;
  }

  function createWebGlShader(gl, type, source) {
    var shader = gl.createShader(type);
    if (!shader) {
      return null;
    }

    gl.shaderSource(shader, source);
    gl.compileShader(shader);
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
      gl.deleteShader(shader);
      return null;
    }

    return shader;
  }

  function createWebGlProgram(gl, vertexSource, fragmentSource) {
    var vertexShader = createWebGlShader(gl, gl.VERTEX_SHADER, vertexSource);
    var fragmentShader = createWebGlShader(gl, gl.FRAGMENT_SHADER, fragmentSource);
    if (!vertexShader || !fragmentShader) {
      if (vertexShader) {
        gl.deleteShader(vertexShader);
      }
      if (fragmentShader) {
        gl.deleteShader(fragmentShader);
      }
      return null;
    }

    var program = gl.createProgram();
    if (!program) {
      gl.deleteShader(vertexShader);
      gl.deleteShader(fragmentShader);
      return null;
    }

    gl.attachShader(program, vertexShader);
    gl.attachShader(program, fragmentShader);
    gl.linkProgram(program);
    gl.deleteShader(vertexShader);
    gl.deleteShader(fragmentShader);

    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
      gl.deleteProgram(program);
      return null;
    }

    return program;
  }

  function getWebGlRenderer(width, height) {
    if (WEBGL_RENDERER.supported === false) {
      return null;
    }

    if (!WEBGL_RENDERER.canvas) {
      var canvas = document.createElement("canvas");
      var gl =
        canvas.getContext("webgl", {
          alpha: false,
          antialias: false,
          depth: false,
          stencil: false,
          preserveDrawingBuffer: true
        }) ||
        canvas.getContext("experimental-webgl", {
          alpha: false,
          antialias: false,
          depth: false,
          stencil: false,
          preserveDrawingBuffer: true
        });

      if (!gl) {
        WEBGL_RENDERER.supported = false;
        return null;
      }

      var vertexSource = [
        "attribute vec2 a_position;",
        "varying vec2 v_uv;",
        "void main() {",
        "  gl_Position = vec4(a_position, 0.0, 1.0);",
        "  v_uv = vec2((a_position.x + 1.0) * 0.5, 1.0 - (a_position.y + 1.0) * 0.5);",
        "}"
      ].join("\n");
      var fragmentSource = [
        "precision mediump float;",
        "uniform sampler2D u_intensity;",
        "uniform sampler2D u_palette;",
        "varying vec2 v_uv;",
        "void main() {",
        "  float value = texture2D(u_intensity, v_uv).r;",
        "  gl_FragColor = texture2D(u_palette, vec2(value, 0.5));",
        "}"
      ].join("\n");
      var program = createWebGlProgram(gl, vertexSource, fragmentSource);
      if (!program) {
        WEBGL_RENDERER.supported = false;
        return null;
      }

      var vertexBuffer = gl.createBuffer();
      var intensityTexture = gl.createTexture();
      var paletteTexture = gl.createTexture();
      if (!vertexBuffer || !intensityTexture || !paletteTexture) {
        WEBGL_RENDERER.supported = false;
        return null;
      }

      gl.bindBuffer(gl.ARRAY_BUFFER, vertexBuffer);
      gl.bufferData(
        gl.ARRAY_BUFFER,
        new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]),
        gl.STATIC_DRAW
      );

      gl.bindTexture(gl.TEXTURE_2D, intensityTexture);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);

      gl.bindTexture(gl.TEXTURE_2D, paletteTexture);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);

      WEBGL_RENDERER.supported = true;
      WEBGL_RENDERER.canvas = canvas;
      WEBGL_RENDERER.gl = gl;
      WEBGL_RENDERER.program = program;
      WEBGL_RENDERER.vertexBuffer = vertexBuffer;
      WEBGL_RENDERER.intensityTexture = intensityTexture;
      WEBGL_RENDERER.paletteTexture = paletteTexture;
      WEBGL_RENDERER.positionLocation = gl.getAttribLocation(program, "a_position");
      WEBGL_RENDERER.intensityLocation = gl.getUniformLocation(program, "u_intensity");
      WEBGL_RENDERER.paletteLocation = gl.getUniformLocation(program, "u_palette");
    }

    var maxTextureSize = WEBGL_RENDERER.gl.getParameter(WEBGL_RENDERER.gl.MAX_TEXTURE_SIZE);
    if (width > maxTextureSize || height > maxTextureSize) {
      return null;
    }

    if (WEBGL_RENDERER.canvas.width !== width) {
      WEBGL_RENDERER.canvas.width = width;
    }
    if (WEBGL_RENDERER.canvas.height !== height) {
      WEBGL_RENDERER.canvas.height = height;
    }

    return WEBGL_RENDERER;
  }

  function buildPaletteTextureData() {
    var bytes = new Uint8Array(256 * 4);
    for (var i = 0; i < 256; i += 1) {
      var rgb = valueToColor(i / 255);
      var base = i * 4;
      bytes[base] = rgb[0];
      bytes[base + 1] = rgb[1];
      bytes[base + 2] = rgb[2];
      bytes[base + 3] = 255;
    }
    return bytes;
  }

  function renderIntensityWithWebGl(renderer, intensityBuffer, width, height) {
    if (!renderer || !renderer.gl || !renderer.program) {
      return false;
    }

    var gl = renderer.gl;
    var paletteKey = String(DEFAULT_CONFIG.colorMap || "magma") + "|" + String(DEFAULT_CONFIG.gamma || 1);
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);

    gl.useProgram(renderer.program);
    gl.viewport(0, 0, width, height);

    gl.bindBuffer(gl.ARRAY_BUFFER, renderer.vertexBuffer);
    gl.enableVertexAttribArray(renderer.positionLocation);
    gl.vertexAttribPointer(renderer.positionLocation, 2, gl.FLOAT, false, 0, 0);

    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, renderer.intensityTexture);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.LUMINANCE, width, height, 0, gl.LUMINANCE, gl.UNSIGNED_BYTE, intensityBuffer);
    gl.uniform1i(renderer.intensityLocation, 0);

    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, renderer.paletteTexture);
    if (renderer.paletteKey !== paletteKey) {
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 256, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, buildPaletteTextureData());
      renderer.paletteKey = paletteKey;
    }
    gl.uniform1i(renderer.paletteLocation, 1);

    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    return gl.getError() === gl.NO_ERROR;
  }

  function createCanvasFromIntensityBuffer(width, height, intensityBuffer) {
    var canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    var ctx = canvas.getContext("2d");
    if (!ctx) {
      return null;
    }

    var image = ctx.createImageData(width, height);
    var palette = buildPaletteTextureData();
    for (var i = 0; i < intensityBuffer.length; i += 1) {
      var paletteOffset = intensityBuffer[i] * 4;
      var pixelOffset = i * 4;
      image.data[pixelOffset] = palette[paletteOffset];
      image.data[pixelOffset + 1] = palette[paletteOffset + 1];
      image.data[pixelOffset + 2] = palette[paletteOffset + 2];
      image.data[pixelOffset + 3] = 255;
    }

    ctx.putImageData(image, 0, 0);
    return canvas;
  }

  function parseDateMs(value) {
    if (value === null || value === undefined || value === "") {
      return NaN;
    }

    if (value instanceof Date) {
      return Number.isFinite(value.getTime()) ? value.getTime() : NaN;
    }

    if (typeof value === "string") {
      var trimmed = value.trim();
      var naiveMatch = trimmed.match(/^(\d{4})-(\d{2})-(\d{2})[T\s](\d{2}):(\d{2})(?::(\d{2})(?:\.(\d{1,3}))?)?$/);
      if (naiveMatch) {
        return new Date(
          Number(naiveMatch[1]),
          Number(naiveMatch[2]) - 1,
          Number(naiveMatch[3]),
          Number(naiveMatch[4]),
          Number(naiveMatch[5]),
          Number(naiveMatch[6] || 0),
          Number(String(naiveMatch[7] || "0").padEnd(3, "0"))
        ).getTime();
      }

      var parsedFromString = new Date(trimmed).getTime();
      if (Number.isFinite(parsedFromString)) {
        return parsedFromString;
      }
    }

    var numericValue = Number(value);
    if (Number.isFinite(numericValue)) {
      return numericValue;
    }

    return NaN;
  }

  function getCachedMs(block, cacheKey, fallbackKeys) {
    if (!block) {
      return NaN;
    }

    if (Number.isFinite(block[cacheKey])) {
      return block[cacheKey];
    }

    for (var i = 0; i < fallbackKeys.length; i += 1) {
      var key = fallbackKeys[i];
      if (Number.isFinite(block[key])) {
        block[cacheKey] = block[key];
        return block[cacheKey];
      }
    }

    var ms = parseDateMs(block.timestamp || block.startTime || block.start_time || block.endTime || block.end_time);
    if (Number.isFinite(ms)) {
      block[cacheKey] = ms;
    }
    return ms;
  }

  function getBlockStartMs(block) {
    return getCachedMs(block, "__startMs", ["startMs", "start_ms"]);
  }

  function getBlockEndMs(block) {
    return getCachedMs(block, "__endMs", ["endMs", "end_ms"]);
  }

  function getBlockTimestampMs(block) {
    return getCachedMs(block, "__timestampMs", ["timestampMs", "timestamp_ms"]);
  }

  function formatTimeLabel(ms, withDate) {
    var d = new Date(ms);
    var hh = String(d.getHours()).padStart(2, "0");
    var mm = String(d.getMinutes()).padStart(2, "0");
    if (!withDate) return hh + ":" + mm;

    var yyyy = d.getFullYear();
    var mon = String(d.getMonth() + 1).padStart(2, "0");
    var day = String(d.getDate()).padStart(2, "0");
    return yyyy + "-" + mon + "-" + day + " " + hh + ":" + mm;
  }

  function formatNaiveDateTimeMs(ms) {
    var d = new Date(ms);
    if (Number.isNaN(d.getTime())) {
      return "";
    }

    var yyyy = String(d.getFullYear());
    var mon = String(d.getMonth() + 1).padStart(2, "0");
    var day = String(d.getDate()).padStart(2, "0");
    var hh = String(d.getHours()).padStart(2, "0");
    var mm = String(d.getMinutes()).padStart(2, "0");
    var ss = String(d.getSeconds()).padStart(2, "0");
    return yyyy + "-" + mon + "-" + day + "T" + hh + ":" + mm + ":" + ss;
  }

  function formatDisplayedFrequencyLabel(hz) {
    var n = Number(hz);
    if (!Number.isFinite(n)) {
      return "- Hz";
    }
    return Math.round(n) + " Hz";
  }

  function getBinCount(blocks) {
    for (var i = 0; i < blocks.length; i += 1) {
      var matrix = blocks[i] && blocks[i].data;
      if (Array.isArray(matrix) && matrix.length > 0 && Array.isArray(matrix[0]) && matrix[0].length > 0) {
        if (DEFAULT_CONFIG.matrixOrientation === "time-frequency") {
          return matrix[0].length;
        }
        return matrix.length;
      }
    }
    return 0;
  }

  function getMatrixDimensions(matrix) {
    if (!Array.isArray(matrix) || matrix.length === 0 || !Array.isArray(matrix[0]) || matrix[0].length === 0) {
      return { rows: 0, cols: 0 };
    }

    if (DEFAULT_CONFIG.matrixOrientation === "time-frequency") {
      return {
        rows: matrix[0].length,
        cols: matrix.length
      };
    }

    return {
      rows: matrix.length,
      cols: matrix[0].length
    };
  }

  function getMatrixValue(matrix, row, col) {
    if (DEFAULT_CONFIG.matrixOrientation === "time-frequency") {
      if (!Array.isArray(matrix[col])) return 0;
      return matrix[col][row];
    }
    if (!Array.isArray(matrix[row])) return 0;
    return matrix[row][col];
  }

  function normalizeFrequencyBins(rawBins) {
    if (!Array.isArray(rawBins) || rawBins.length === 0) {
      return null;
    }

    var bins = [];
    for (var i = 0; i < rawBins.length; i += 1) {
      var item = rawBins[i];
      var value = Array.isArray(item) ? item[0] : item;
      var n = Number(value);
      if (!Number.isFinite(n)) {
        return null;
      }
      bins.push(n);
    }

    return bins;
  }

  function dbFromMagnitude(value) {
    var n = Number(value);
    if (!Number.isFinite(n) || n <= 0) {
      return Number.NEGATIVE_INFINITY;
    }
    return 20 * Math.log10(n);
  }

  function parsePercent(value, fallback) {
    var n = Number(value);
    if (!Number.isFinite(n)) {
      return fallback;
    }
    return n;
  }

  function resolveDisplayGainDb(options) {
    var gainDb = Number(options && options.displayGainDb);
    if (!Number.isFinite(gainDb)) {
      gainDb = Number(DEFAULT_CONFIG.displayGainDb);
    }
    if (!Number.isFinite(gainDb)) {
      gainDb = 0;
    }
    if (gainDb < -24) {
      gainDb = -24;
    }
    if (gainDb > 24) {
      gainDb = 24;
    }
    return gainDb;
  }

  function applyDisplayGain(mappedValue, displayGainDb) {
    var value = clamp01(mappedValue);
    if (!value) {
      return 0;
    }

    if (!displayGainDb) {
      return value;
    }

    var gainScale = Math.pow(10, displayGainDb / 20);
    return clamp01(value * gainScale);
  }

  function quantileSorted(sortedValues, quantile) {
    if (!Array.isArray(sortedValues) || sortedValues.length === 0) {
      return NaN;
    }

    var q = clamp01(quantile);
    var pos = q * (sortedValues.length - 1);
    var lower = Math.floor(pos);
    var upper = Math.ceil(pos);
    if (lower === upper) {
      return sortedValues[lower];
    }

    var t = pos - lower;
    return lerp(sortedValues[lower], sortedValues[upper], t);
  }

  function collectDbSamples(blocks, maxSamples) {
    var samples = [];
    var maxCount = Number.isFinite(maxSamples) ? Math.max(1000, Math.floor(maxSamples)) : 20000;

    for (var bi = 0; bi < blocks.length; bi += 1) {
      var matrix = blocks[bi] && blocks[bi].data;
      if (!Array.isArray(matrix) || matrix.length === 0 || !Array.isArray(matrix[0]) || matrix[0].length === 0) {
        continue;
      }

      var dims = getMatrixDimensions(matrix);
      var rows = dims.rows;
      var cols = dims.cols;
      if (rows <= 0 || cols <= 0) {
        continue;
      }

      var rowStep = Math.max(1, Math.floor(rows / 48));
      var colStep = Math.max(1, Math.floor(cols / 48));

      for (var r = 0; r < rows; r += rowStep) {
        for (var c = 0; c < cols; c += colStep) {
          var raw = getMatrixValue(matrix, r, c);
          var db = dbFromMagnitude(raw);
          if (Number.isFinite(db)) {
            samples.push(db);
          }

          if (samples.length >= maxCount) {
            return samples;
          }
        }
      }
    }

    return samples;
  }

  function buildIntensityMapper(options, blocks, intensityType) {
    var modeRaw = (options && options.intensityMode) || DEFAULT_CONFIG.intensityMode;
    var mode = String(modeRaw || "linear").toLowerCase();
    if (mode !== "db-fixed" && mode !== "db-percentile") {
      mode = "linear";
    }

    var allowsDb = intensityType === "magnitude" || intensityType === "db";
    if (!allowsDb && mode !== "linear") {
      mode = "linear";
    }

    if (mode === "linear") {
      return {
        mode: mode,
        map: function (value) {
          return normalizeIntensity(value);
        },
        legend: {
          lowLabel: "Low",
          highLabel: "High",
          title: allowsDb ? "Linear" : "Image"
        }
      };
    }

    var defaultDbMin = Number(DEFAULT_CONFIG.dbMin);
    var defaultDbMax = Number(DEFAULT_CONFIG.dbMax);
    if (!Number.isFinite(defaultDbMin)) {
      defaultDbMin = -95;
    }
    if (!Number.isFinite(defaultDbMax)) {
      defaultDbMax = -20;
    }

    var dbMin = Number(options && options.dbMin);
    var dbMax = Number(options && options.dbMax);
    if (!Number.isFinite(dbMin)) {
      dbMin = defaultDbMin;
    }
    if (!Number.isFinite(dbMax)) {
      dbMax = defaultDbMax;
    }

    if (mode === "db-percentile") {
      var lowP = parsePercent((options && options.percentileLow) || DEFAULT_CONFIG.percentileLow, 5);
      var highP = parsePercent((options && options.percentileHigh) || DEFAULT_CONFIG.percentileHigh, 99);
      lowP = Math.max(0, Math.min(99, lowP));
      highP = Math.max(1, Math.min(100, highP));
      if (highP <= lowP) {
        highP = Math.min(100, lowP + 1);
      }

      var dbSamples = collectDbSamples(blocks, 20000).sort(function (a, b) {
        return a - b;
      });

      if (dbSamples.length > 0) {
        var qLow = quantileSorted(dbSamples, lowP / 100);
        var qHigh = quantileSorted(dbSamples, highP / 100);
        if (Number.isFinite(qLow) && Number.isFinite(qHigh) && qHigh > qLow) {
          dbMin = qLow;
          dbMax = qHigh;
        }
      }
    }

    if (!(dbMax > dbMin)) {
      dbMin = defaultDbMin;
      dbMax = defaultDbMax;
    }

    return {
      mode: mode,
      dbMin: dbMin,
      dbMax: dbMax,
      map: function (value) {
        var db = dbFromMagnitude(value);
        if (!Number.isFinite(db)) {
          return 0;
        }
        return clamp01((db - dbMin) / (dbMax - dbMin));
      },
      legend: {
        lowLabel: Math.round(dbMin) + " dB",
        highLabel: Math.round(dbMax) + " dB",
        title: mode === "db-percentile" ? "dB (percentile)" : "dB (fixed)"
      }
    };
  }

  function normalizeScalarByType(value, intensityType) {
    var n = Number(value);
    if (!Number.isFinite(n)) {
      return 0;
    }

    if (intensityType === "normalized") {
      return clamp01(n);
    }

    if (intensityType === "uint8") {
      return clamp01(n / 255);
    }

    if (intensityType === "db") {
      var dbMin = Number(DEFAULT_CONFIG.dbMin);
      var dbMax = Number(DEFAULT_CONFIG.dbMax);
      if (!Number.isFinite(dbMin)) dbMin = -95;
      if (!Number.isFinite(dbMax) || dbMax <= dbMin) dbMax = dbMin + 75;
      return clamp01((n - dbMin) / (dbMax - dbMin));
    }

    return normalizeIntensity(n);
  }

  function inferImageIntensityType(blocks) {
    for (var bi = 0; bi < blocks.length; bi += 1) {
      var matrix = blocks[bi] && blocks[bi].data;
      if (!Array.isArray(matrix) || matrix.length === 0 || !Array.isArray(matrix[0]) || matrix[0].length === 0) {
        continue;
      }

      var dims = getMatrixDimensions(matrix);
      var rows = dims.rows;
      var cols = dims.cols;
      var maxValue = Number.NEGATIVE_INFINITY;
      for (var r = 0; r < rows; r += Math.max(1, Math.floor(rows / 24))) {
        for (var c = 0; c < cols; c += Math.max(1, Math.floor(cols / 24))) {
          var value = getMatrixValue(matrix, r, c);
          if (Number.isFinite(value) && value > maxValue) {
            maxValue = value;
          }
        }
      }

      if (Number.isFinite(maxValue)) {
        return maxValue <= 1.5 ? "normalized" : "uint8";
      }
    }

    return "uint8";
  }

  function resolveIntensityType(options, blocks) {
    var candidate = options && typeof options.intensityType === "string" ? options.intensityType.toLowerCase() : "";
    if (candidate === "normalized" || candidate === "uint8" || candidate === "magnitude" || candidate === "db") {
      return candidate;
    }

    return inferImageIntensityType(blocks);
  }

  function collectNormalizedHistogram(blocks, intensityType, maxSamples, histogramBins) {
    var limit = Number.isFinite(maxSamples) ? Math.max(1000, Math.floor(maxSamples)) : 200000;
    var binsCount = Number.isFinite(histogramBins) ? Math.max(64, Math.floor(histogramBins)) : 1024;
    var hist = new Array(binsCount).fill(0);
    var total = 0;
    var sum = 0;
    var min = Number.POSITIVE_INFINITY;
    var max = Number.NEGATIVE_INFINITY;

    for (var bi = 0; bi < blocks.length; bi += 1) {
      var matrix = blocks[bi] && blocks[bi].data;
      if (!Array.isArray(matrix) || matrix.length === 0 || !Array.isArray(matrix[0]) || matrix[0].length === 0) {
        continue;
      }

      var dims = getMatrixDimensions(matrix);
      var rows = dims.rows;
      var cols = dims.cols;
      var rowStep = Math.max(1, Math.floor(rows / 64));
      var colStep = Math.max(1, Math.floor(cols / 64));

      for (var r = 0; r < rows; r += rowStep) {
        for (var c = 0; c < cols; c += colStep) {
          var v = normalizeScalarByType(getMatrixValue(matrix, r, c), intensityType);
          if (v < min) {
            min = v;
          }
          if (v > max) {
            max = v;
          }

          sum += v;
          total += 1;

          var binIndex = Math.min(binsCount - 1, Math.max(0, Math.floor(v * (binsCount - 1))));
          hist[binIndex] += 1;

          if (total >= limit) {
            return {
              hist: hist,
              total: total,
              sum: sum,
              min: Number.isFinite(min) ? min : 0,
              max: Number.isFinite(max) ? max : 0,
              binsCount: binsCount
            };
          }
        }
      }
    }

    return {
      hist: hist,
      total: total,
      sum: sum,
      min: Number.isFinite(min) ? min : 0,
      max: Number.isFinite(max) ? max : 0,
      binsCount: binsCount
    };
  }

  function quantileFromHistogram(histogramData, q) {
    if (!histogramData || !Array.isArray(histogramData.hist) || histogramData.total <= 0) {
      return 0;
    }

    var hist = histogramData.hist;
    var binsCount = histogramData.binsCount;
    var target = clamp01(q) * (histogramData.total - 1);
    var acc = 0;
    for (var i = 0; i < binsCount; i += 1) {
      acc += hist[i];
      if (acc > target) {
        return i / Math.max(1, binsCount - 1);
      }
    }

    return 1;
  }

  function buildStatsFromHistogram(histogramData) {
    if (!histogramData || histogramData.total <= 0) {
      return {
        min: 0,
        max: 0,
        mean: 0,
        median: 0,
        p50: 0,
        p75: 0,
        p90: 0,
        p95: 0,
        p99: 0
      };
    }

    var p50 = quantileFromHistogram(histogramData, 0.5);
    var p75 = quantileFromHistogram(histogramData, 0.75);
    var p90 = quantileFromHistogram(histogramData, 0.9);
    var p95 = quantileFromHistogram(histogramData, 0.95);
    var p99 = quantileFromHistogram(histogramData, 0.99);

    return {
      min: histogramData.min,
      max: histogramData.max,
      mean: histogramData.sum / histogramData.total,
      median: p50,
      p50: p50,
      p75: p75,
      p90: p90,
      p95: p95,
      p99: p99
    };
  }

  function countActiveNeighbors(mask, row, col, radius) {
    var rows = mask.length;
    var cols = rows > 0 ? mask[0].length : 0;
    var neighbors = 0;

    for (var dr = -radius; dr <= radius; dr += 1) {
      for (var dc = -radius; dc <= radius; dc += 1) {
        if (dr === 0 && dc === 0) {
          continue;
        }

        var rr = row + dr;
        var cc = col + dc;
        if (rr < 0 || cc < 0 || rr >= rows || cc >= cols) {
          continue;
        }

        if (mask[rr][cc]) {
          neighbors += 1;
        }
      }
    }

    return neighbors;
  }

  function hasLineSupport(mask, row, col) {
    var rows = mask.length;
    var cols = rows > 0 ? mask[0].length : 0;
    var up = row - 1 >= 0 ? !!mask[row - 1][col] : false;
    var down = row + 1 < rows ? !!mask[row + 1][col] : false;
    var left = col - 1 >= 0 ? !!mask[row][col - 1] : false;
    var right = col + 1 < cols ? !!mask[row][col + 1] : false;
    return (up && down) || (left && right);
  }

  function removeSingletonComponents(mask) {
    var rows = mask.length;
    var cols = rows > 0 ? mask[0].length : 0;
    var visited = new Array(rows);
    for (var r = 0; r < rows; r += 1) {
      visited[r] = new Array(cols).fill(false);
    }

    var dirs = [
      [-1, -1],
      [-1, 0],
      [-1, 1],
      [0, -1],
      [0, 1],
      [1, -1],
      [1, 0],
      [1, 1]
    ];

    for (var row = 0; row < rows; row += 1) {
      for (var col = 0; col < cols; col += 1) {
        if (!mask[row][col] || visited[row][col]) {
          continue;
        }

        var queue = [{ r: row, c: col }];
        var members = [];
        visited[row][col] = true;

        while (queue.length) {
          var node = queue.pop();
          if (!node) {
            continue;
          }
          members.push(node);

          for (var di = 0; di < dirs.length; di += 1) {
            var rr = node.r + dirs[di][0];
            var cc = node.c + dirs[di][1];
            if (rr < 0 || cc < 0 || rr >= rows || cc >= cols) {
              continue;
            }
            if (!mask[rr][cc] || visited[rr][cc]) {
              continue;
            }
            visited[rr][cc] = true;
            queue.push({ r: rr, c: cc });
          }
        }

        if (members.length === 1) {
          var only = members[0];
          mask[only.r][only.c] = false;
        }
      }
    }
  }

  function bridgeThinGaps(mask) {
    var rows = mask.length;
    var cols = rows > 0 ? mask[0].length : 0;
    var next = new Array(rows);

    for (var r = 0; r < rows; r += 1) {
      next[r] = mask[r].slice();
    }

    for (var row = 1; row < rows - 1; row += 1) {
      for (var col = 1; col < cols - 1; col += 1) {
        if (mask[row][col]) {
          continue;
        }

        var verticalBridge = mask[row - 1][col] && mask[row + 1][col];
        var horizontalBridge = mask[row][col - 1] && mask[row][col + 1];
        if (verticalBridge || horizontalBridge) {
          next[row][col] = true;
        }
      }
    }

    return next;
  }

  function buildBlockSetSignature(blocks) {
    if (!Array.isArray(blocks) || blocks.length === 0) {
      return "empty";
    }

    var first = blocks[0];
    var last = blocks[blocks.length - 1];
    return [
      String(blocks.length),
      String(getBlockStartMs(first)),
      String(getBlockEndMs(last)),
      String(getBlockTimestampMs(first)),
      String(getBlockTimestampMs(last))
    ].join("|");
  }

  function buildProcessingContextCacheKey(options, blocks, intensityType) {
    var floorPct = Number((options && options.noiseFloorPercentile) || DEFAULT_CONFIG.noiseFloorPercentile);
    var minThreshold = Number((options && options.noiseThreshold) || DEFAULT_CONFIG.noiseThreshold);
    return [
      intensityType,
      String(buildBlockSetSignature(blocks)),
      Number.isFinite(floorPct) ? floorPct.toFixed(2) : "72.00",
      Number.isFinite(minThreshold) ? minThreshold.toFixed(4) : "0.0600"
    ].join("::");
  }

  function getCachedProcessContext(key) {
    return PROCESS_CONTEXT_CACHE.get(key) || null;
  }

  function setCachedProcessContext(key, processCtx) {
    if (PROCESS_CONTEXT_CACHE.has(key)) {
      PROCESS_CONTEXT_CACHE.delete(key);
    }
    PROCESS_CONTEXT_CACHE.set(key, {
      intensityType: processCtx.intensityType,
      threshold: processCtx.threshold,
      stats: processCtx.stats
    });

    if (PROCESS_CONTEXT_CACHE.size > MAX_PROCESS_CONTEXT_CACHE) {
      var firstKey = PROCESS_CONTEXT_CACHE.keys().next();
      if (!firstKey.done) {
        PROCESS_CONTEXT_CACHE.delete(firstKey.value);
      }
    }
  }

  function createProcessingContext(options, blocks, fastMode) {
    var compareView = String((options && options.compareView) || DEFAULT_CONFIG.compareView || "denoised").toLowerCase();
    if (compareView !== "original" && compareView !== "thresholded" && compareView !== "denoised") {
      compareView = "denoised";
    }

    var intensityType = resolveIntensityType(options || {}, blocks);
    var contextCacheKey = buildProcessingContextCacheKey(options || {}, blocks, intensityType);
    var cachedCtx = getCachedProcessContext(contextCacheKey);

    var histogramData;
    var stats;
    var adaptiveFloor;
    if (cachedCtx && fastMode) {
      stats = cachedCtx.stats;
      adaptiveFloor = cachedCtx.threshold;
    } else {
      histogramData = collectNormalizedHistogram(blocks, intensityType, 200000, 1024);
      stats = buildStatsFromHistogram(histogramData);
    }
    var floorPct = Number((options && options.noiseFloorPercentile) || DEFAULT_CONFIG.noiseFloorPercentile);
    if (!Number.isFinite(floorPct)) {
      floorPct = 72;
    }
    floorPct = Math.max(1, Math.min(99, floorPct));

    if (!(cachedCtx && fastMode)) {
      adaptiveFloor = quantileFromHistogram(histogramData, floorPct / 100);
      if (!Number.isFinite(adaptiveFloor)) {
        adaptiveFloor = 0;
      }
    }

    var minimumThreshold = Number((options && options.noiseThreshold) || DEFAULT_CONFIG.noiseThreshold);
    if (!Number.isFinite(minimumThreshold)) {
      minimumThreshold = 0;
    }
    minimumThreshold = clamp01(minimumThreshold);

    var threshold = Math.max(adaptiveFloor, minimumThreshold);
    threshold = clamp01(threshold);

    var neighborhoodSize = Number((options && options.neighborhoodSize) || DEFAULT_CONFIG.neighborhoodSize);
    if (neighborhoodSize !== 5) {
      neighborhoodSize = 3;
    }

    var minActiveNeighbors = Number((options && options.minActiveNeighbors) || DEFAULT_CONFIG.minActiveNeighbors);
    if (!Number.isFinite(minActiveNeighbors)) {
      minActiveNeighbors = 1;
    }
    minActiveNeighbors = Math.max(0, Math.floor(minActiveNeighbors));

    var processCtx = {
      intensityType: intensityType,
      compareView: compareView,
      noiseSuppressionEnabled:
        options && typeof options.noiseSuppressionEnabled === "boolean"
          ? options.noiseSuppressionEnabled
          : !!DEFAULT_CONFIG.noiseSuppressionEnabled,
      isolatedPixelRemovalEnabled:
        options && typeof options.isolatedPixelRemovalEnabled === "boolean"
          ? options.isolatedPixelRemovalEnabled
          : !!DEFAULT_CONFIG.isolatedPixelRemovalEnabled,
      morphologyEnabled:
        options && typeof options.morphologyEnabled === "boolean"
          ? options.morphologyEnabled
          : !!DEFAULT_CONFIG.morphologyEnabled,
      neighborhoodSize: neighborhoodSize,
      minActiveNeighbors: minActiveNeighbors,
      threshold: threshold,
      stats: stats,
      processKey: [
        intensityType,
        threshold.toFixed(4),
        options && options.noiseSuppressionEnabled === false ? 0 : 1,
        options && options.isolatedPixelRemovalEnabled === false ? 0 : 1,
        options && options.morphologyEnabled === false ? 0 : 1,
        neighborhoodSize,
        minActiveNeighbors
      ].join("|"),
      removedBefore: 0,
      removedAfter: 0
    };

    if (!cachedCtx || !fastMode) {
      setCachedProcessContext(contextCacheKey, processCtx);
    }

    return processCtx;
  }

  function processBlockMatrix(matrix, processCtx) {
    var dims = getMatrixDimensions(matrix);
    var rows = dims.rows;
    var cols = dims.cols;

    var original = new Array(rows);
    var thresholded = new Array(rows);
    var mask = new Array(rows);

    var activeBefore = 0;

    for (var r = 0; r < rows; r += 1) {
      original[r] = new Array(cols);
      thresholded[r] = new Array(cols);
      mask[r] = new Array(cols);
      for (var c = 0; c < cols; c += 1) {
        var normalized = normalizeScalarByType(getMatrixValue(matrix, r, c), processCtx.intensityType);
        original[r][c] = normalized;

        var gated = processCtx.noiseSuppressionEnabled && normalized < processCtx.threshold ? 0 : normalized;
        thresholded[r][c] = gated;
        var active = gated > 0;
        mask[r][c] = active;
        if (active) {
          activeBefore += 1;
        }
      }
    }

    if (processCtx.isolatedPixelRemovalEnabled) {
      var radius = Math.floor((processCtx.neighborhoodSize - 1) / 2);
      var filteredMask = new Array(rows);
      for (var rr = 0; rr < rows; rr += 1) {
        filteredMask[rr] = new Array(cols);
        for (var cc = 0; cc < cols; cc += 1) {
          if (!mask[rr][cc]) {
            filteredMask[rr][cc] = false;
            continue;
          }

          var neighborCount = countActiveNeighbors(mask, rr, cc, radius);
          var keep = neighborCount >= processCtx.minActiveNeighbors || hasLineSupport(mask, rr, cc);
          filteredMask[rr][cc] = keep;
        }
      }
      mask = filteredMask;
      removeSingletonComponents(mask);
    }

    if (processCtx.morphologyEnabled) {
      mask = bridgeThinGaps(mask);
    }

    var denoised = new Array(rows);
    var activeAfter = 0;
    for (var r2 = 0; r2 < rows; r2 += 1) {
      denoised[r2] = new Array(cols);
      for (var c2 = 0; c2 < cols; c2 += 1) {
        var keepValue = mask[r2][c2] ? thresholded[r2][c2] : 0;
        denoised[r2][c2] = keepValue;
        if (keepValue > 0) {
          activeAfter += 1;
        }
      }
    }

    return {
      original: original,
      thresholded: thresholded,
      denoised: denoised,
      activeBefore: activeBefore,
      activeAfter: activeAfter,
      rows: rows,
      cols: cols
    };
  }

  function getBlockProcessedCache(block) {
    var cache = BLOCK_PROCESS_CACHE.get(block);
    if (!cache) {
      cache = {
        order: [],
        values: Object.create(null)
      };
      BLOCK_PROCESS_CACHE.set(block, cache);
    }
    return cache;
  }

  function getProcessedBlockMatrix(block, matrix, processCtx) {
    var cache = getBlockProcessedCache(block);
    var key = processCtx.processKey;
    var cached = cache.values[key];
    if (!cached) {
      cached = processBlockMatrix(matrix, processCtx);
      cache.values[key] = cached;
      cache.order.push(key);

      if (cache.order.length > MAX_BLOCK_KEYS_PER_PACKET) {
        var evictKey = cache.order.shift();
        if (evictKey) {
          delete cache.values[evictKey];
        }
      }
    }

    processCtx.removedBefore += cached.activeBefore;
    processCtx.removedAfter += cached.activeAfter;

    if (processCtx.compareView === "original") {
      return cached.original;
    }
    if (processCtx.compareView === "thresholded") {
      return cached.thresholded;
    }
    return cached.denoised;
  }

  function chooseTicks(widthPx, minTicks, maxTicks) {
    var byWidth = Math.floor(widthPx / 120);
    return Math.max(minTicks, Math.min(maxTicks, byWidth));
  }

  function estimateStepMs(blocks, blockIndex, rangeMs) {
    var block = blocks[blockIndex];
    var matrix = block.data;
    var dims = getMatrixDimensions(matrix);
    var cols = dims.cols;

    if (Number.isFinite(block.timeStepMs) && block.timeStepMs > 0) {
      return block.timeStepMs;
    }

    if (
      Number.isFinite(block.hopSize) &&
      block.hopSize > 0 &&
      Number.isFinite(block.sampleRate) &&
      block.sampleRate > 0
    ) {
      return (block.hopSize / block.sampleRate) * 1000;
    }

    for (var i = blockIndex + 1; i < blocks.length; i += 1) {
      var nextTs = getBlockTimestampMs(blocks[i]);
      var ts = getBlockTimestampMs(block);
      if (Number.isFinite(nextTs) && Number.isFinite(ts) && nextTs > ts) {
        return Math.max(1, Math.round((nextTs - ts) / Math.max(1, cols)));
      }
    }

    return Math.max(10, Math.round(rangeMs / Math.max(200, cols * Math.max(1, blocks.length))));
  }

  function drawLegend(legendCanvas, legendMeta) {
    if (!legendCanvas) return;
    var ctx = legendCanvas.getContext("2d");
    if (!ctx) return;

    var dpr = window.devicePixelRatio || 1;
    var width = Math.max(320, Math.floor(legendCanvas.clientWidth || 560));
    var height = 46;
    legendCanvas.width = Math.floor(width * dpr);
    legendCanvas.height = Math.floor(height * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    ctx.clearRect(0, 0, width, height);
    ctx.fillStyle = "#111026";
    ctx.fillRect(0, 0, width, height);

    var x0 = 68;
    var y0 = 12;
    var w = Math.max(140, width - 130);
    var h = 16;

    for (var x = 0; x < w; x += 1) {
      var v = x / (w - 1 || 1);
      var rgb = valueToColor(v);
      ctx.fillStyle = "rgb(" + rgb[0] + "," + rgb[1] + "," + rgb[2] + ")";
      ctx.fillRect(x0 + x, y0, 1, h);
    }

    ctx.strokeStyle = "#4b5677";
    ctx.strokeRect(x0, y0, w, h);

    var lowLabel = legendMeta && legendMeta.lowLabel ? legendMeta.lowLabel : "Low 0";
    var highLabel = legendMeta && legendMeta.highLabel ? legendMeta.highLabel : "High 255";
    var title = legendMeta && legendMeta.title ? legendMeta.title : "Linear";

    ctx.fillStyle = "#d8e2ff";
    ctx.font = "12px Segoe UI";
    ctx.textBaseline = "middle";
    ctx.textAlign = "left";
    ctx.fillText(lowLabel, 10, y0 + h / 2);
    ctx.textAlign = "center";
    ctx.fillText(title, x0 + w / 2, y0 + h / 2);
    ctx.textAlign = "right";
    ctx.fillText(highLabel, width - 10, y0 + h / 2);
  }

  function configure(configPatch) {
    if (!configPatch || typeof configPatch !== "object") {
      return;
    }

    var keys = Object.keys(configPatch);
    for (var i = 0; i < keys.length; i += 1) {
      var key = keys[i];
      if (Object.prototype.hasOwnProperty.call(DEFAULT_CONFIG, key)) {
        DEFAULT_CONFIG[key] = configPatch[key];
      }
    }
  }

  function renderSpectrogram(options) {
    var canvas = options && options.canvas;
    if (!canvas) return;

    var blocks = Array.isArray(options.blocks) ? options.blocks.slice() : [];
    var fastMode = !!(options && options.fastMode);
    var assumeSorted = options && options.assumeSorted !== false;
    var fromMs = parseDateMs(options.from);
    var toMs = parseDateMs(options.to);
    if (!Number.isFinite(fromMs) || !Number.isFinite(toMs) || toMs <= fromMs) {
      return { gaps: [] };
    }

    var binCount = getBinCount(blocks);
    var ctx = canvas.getContext("2d");
    if (!ctx || binCount <= 0) {
      if (ctx) {
        var dpr = window.devicePixelRatio || 1;
        var emptyRect = typeof canvas.getBoundingClientRect === "function" ? canvas.getBoundingClientRect() : null;
        var emptyClientWidth = Math.floor((emptyRect && emptyRect.width) || canvas.clientWidth || 960);
        var emptyClientHeight = Math.floor((emptyRect && emptyRect.height) || canvas.clientHeight || 0);
        var cssWidth = Math.max(480, emptyClientWidth);
        var cssHeight = Math.max(420, emptyClientHeight || Math.floor((canvas.clientWidth || 960) * 0.62));
        canvas.width = Math.floor(cssWidth * dpr);
        canvas.height = Math.floor(cssHeight * dpr);
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        ctx.fillStyle = DEFAULT_CONFIG.background;
        ctx.fillRect(0, 0, cssWidth, cssHeight);
        ctx.fillStyle = DEFAULT_CONFIG.textColor;
        ctx.font = "16px Segoe UI";
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText("لا توجد بيانات للجهاز المحدد.", cssWidth / 2, cssHeight / 2);
      }
      return { gaps: [] };
    }

    if (!assumeSorted) {
      blocks.sort(function (a, b) {
        return getBlockStartMs(a) - getBlockStartMs(b);
      });
    }

    var dpr = window.devicePixelRatio || 1;
    var canvasRect = typeof canvas.getBoundingClientRect === "function" ? canvas.getBoundingClientRect() : null;
    var measuredCssWidth = Math.floor((canvasRect && canvasRect.width) || canvas.clientWidth || 960);
    var measuredCssHeight = Math.floor((canvasRect && canvasRect.height) || canvas.clientHeight || 0);
    var cssWidth = Math.max(480, measuredCssWidth);
    var cssHeight = Math.max(420, measuredCssHeight || Math.floor((canvas.clientWidth || 960) * 0.62));
    canvas.width = Math.floor(cssWidth * dpr);
    canvas.height = Math.floor(cssHeight * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    var p = {
      left: 66,
      right: 14,
      top: 14,
      bottom: 72
    };

    var plotW = Math.max(10, cssWidth - p.left - p.right);
    var plotH = Math.max(10, cssHeight - p.top - p.bottom);

    ctx.fillStyle = DEFAULT_CONFIG.background;
    ctx.fillRect(0, 0, cssWidth, cssHeight);

    var surfaceHeight = Math.max(1, binCount);
    var gpuRenderer = getWebGlRenderer(plotW, surfaceHeight);
    var intensityBuffer = new Uint8Array(plotW * surfaceHeight);
    var selectedDisplayMinFrequency = options && options.displayMinFrequency;
    var selectedDisplayMaxFrequency = options && options.displayMaxFrequency;
    var hasDisplayFrequencyRange =
      Number.isFinite(selectedDisplayMinFrequency) &&
      Number.isFinite(selectedDisplayMaxFrequency) &&
      selectedDisplayMaxFrequency > selectedDisplayMinFrequency;

    function detectFrequencyBinDirection(frequencyBins) {
      return FrequencyMapping.getFrequencyBinDirection(frequencyBins);
    }

    function mapFrequencyRowToScreen(rowIndex, frequencyBins) {
      return FrequencyMapping.mapRawRowToScreen(rowIndex, frequencyBins, surfaceHeight);
    }

    function resolveVisibleRowRange() {
      if (!hasDisplayFrequencyRange) {
        return { start: 0, end: Math.max(0, surfaceHeight - 1) };
      }

      var effectiveMin = Number(options && options.minFrequency);
      var effectiveMax = Number(options && options.maxFrequency);
      if (!Number.isFinite(effectiveMin) || !Number.isFinite(effectiveMax) || effectiveMax <= effectiveMin) {
        effectiveMin = 0;
        effectiveMax = Math.max(1, nativeCanvas.height - 1);
      }

      var visibleRowCount = Math.max(1, surfaceHeight);
      var candidateStart = 0;
      var candidateEnd = visibleRowCount - 1;
      var frequencyBins = normalizeFrequencyBins(options && options.frequencyBins);
      if (Array.isArray(frequencyBins) && frequencyBins.length === binCount) {
        var matches = [];
        for (var rowIndex = 0; rowIndex < frequencyBins.length; rowIndex += 1) {
          var rowFreq = Number(frequencyBins[rowIndex]);
          if (Number.isFinite(rowFreq) && rowFreq >= selectedDisplayMinFrequency && rowFreq <= selectedDisplayMaxFrequency) {
            matches.push(rowIndex);
          }
        }

        if (matches.length > 0) {
          candidateStart = matches[0];
          candidateEnd = matches[matches.length - 1];
        }
      } else {
        var relativeMin = (selectedDisplayMinFrequency - effectiveMin) / (effectiveMax - effectiveMin || 1);
        var relativeMax = (selectedDisplayMaxFrequency - effectiveMin) / (effectiveMax - effectiveMin || 1);
        candidateStart = Math.max(0, Math.min(visibleRowCount - 1, Math.floor(relativeMin * (visibleRowCount - 1))));
        candidateEnd = Math.max(0, Math.min(visibleRowCount - 1, Math.ceil(relativeMax * (visibleRowCount - 1))));
        if (candidateStart > candidateEnd) {
          var tmp = candidateStart;
          candidateStart = candidateEnd;
          candidateEnd = tmp;
        }
      }

      return {
        start: Math.max(0, candidateStart),
        end: Math.min(visibleRowCount - 1, candidateEnd)
      };
    }

    var processCtx = createProcessingContext(options || {}, blocks, fastMode);
    var intensityMapper = buildIntensityMapper(options, blocks, processCtx.intensityType);
    var displayGainDb = resolveDisplayGainDb(options);
    var bucketAggregation = String((options && options.bucketAggregation) || DEFAULT_CONFIG.bucketAggregation || "max").toLowerCase();
    if (bucketAggregation !== "hybrid") {
      bucketAggregation = "max";
    }

    function mapX(ms) {
      return Math.floor(((ms - fromMs) / (toMs - fromMs)) * (plotW - 1));
    }

    function resolveAiStatusColor(statusValue) {
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

    function resolveAiStatusLabel(statusValue) {
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

    var rangeMs = toMs - fromMs;
    var coverageIntervals = [];

    function aggregateBucketValue(maxValue, sumValue, countValue) {
      if (bucketAggregation === "hybrid") {
        if (!Number.isFinite(countValue) || countValue <= 0) {
          return 0;
        }
        var meanValue = sumValue / countValue;
        return 0.7 * maxValue + 0.3 * meanValue;
      }
      return maxValue;
    }

    var fastRowStride = fastMode ? Math.max(1, Math.floor(binCount / 260)) : 1;

    function flushColumnBucket(rows, bucketMax, bucketSum, bucketCount, xStart, xEnd) {
      for (var r = 0; r < rows; r += fastRowStride) {
        var rowEnd = Math.min(rows, r + fastRowStride);
        var groupedValue = 0;
        for (var rg = r; rg < rowEnd; rg += 1) {
          var candidate = aggregateBucketValue(bucketMax[rg], bucketSum[rg], bucketCount[rg]);
          if (candidate > groupedValue) {
            groupedValue = candidate;
          }
        }

        var yNativeTop = rows - rowEnd;
        var yNativeBottom = rows - 1 - r;
        if (yNativeBottom < 0 || yNativeTop >= surfaceHeight) {
          continue;
        }

        var yStart = Math.max(0, yNativeTop);
        var yStop = Math.min(surfaceHeight - 1, yNativeBottom);
        if (yStop < yStart) {
          continue;
        }

        var value = intensityMapper.map(groupedValue);
        if (!Number.isFinite(value)) {
          value = 0;
        }
        value = applyDisplayGain(value, displayGainDb);

        var byteValue = Math.max(0, Math.min(255, Math.round(clamp01(value) * 255)));
        for (var yNative = yStart; yNative <= yStop; yNative += 1) {
          var rowOffset = yNative * plotW;
          for (var x = xStart; x < xEnd && x < plotW; x += 1) {
            intensityBuffer[rowOffset + x] = byteValue;
          }
        }
      }
    }

    for (var bi = 0; bi < blocks.length; bi += 1) {
      var block = blocks[bi];
      var matrix = block && block.data;
      if (!Array.isArray(matrix) || matrix.length === 0 || !Array.isArray(matrix[0]) || matrix[0].length === 0) {
        continue;
      }

      var processedMatrix = getProcessedBlockMatrix(block, matrix, processCtx);

      var dims = getMatrixDimensions(matrix);
      var rows = dims.rows;
      var cols = dims.cols;
      var blockStartMs = getBlockStartMs(block);
      var blockEndMs = getBlockEndMs(block);
      if (!Number.isFinite(blockStartMs) || !Number.isFinite(blockEndMs)) {
        continue;
      }

      if (blockEndMs < blockStartMs) {
        var swap = blockStartMs;
        blockStartMs = blockEndMs;
        blockEndMs = swap;
      }

      var hasExplicitInterval = blockEndMs > blockStartMs;
      var stepMs = hasExplicitInterval
        ? (blockEndMs - blockStartMs) / Math.max(1, cols)
        : estimateStepMs(blocks, bi, rangeMs);
      var oversampleRatio = cols / Math.max(1, plotW);
      var columnStride = 1;
      if (fastMode && oversampleRatio > 1.5) {
        columnStride = Math.min(
          DEFAULT_CONFIG.maxFastColumnStride,
          Math.max(2, Math.floor(oversampleRatio))
        );
      }

      if (!hasExplicitInterval) {
        var blockTs = getBlockTimestampMs(block);
        if (!Number.isFinite(blockTs)) {
          continue;
        }

        if (DEFAULT_CONFIG.blockTimestampMode === "end") {
          blockStartMs = blockTs - (cols - 1) * stepMs;
          blockEndMs = blockTs + stepMs;
        } else {
          blockStartMs = blockTs;
          blockEndMs = blockTs + cols * stepMs;
        }
      }

      coverageIntervals.push({ start: blockStartMs, end: blockEndMs });

      var bucketX0 = -1;
      var bucketX1 = -1;
      var hasBucket = false;
      var bucketMax = new Array(rows);
      var bucketSum = new Array(rows);
      var bucketCount = new Array(rows);

      function resetBucketRow(rowIndex, value) {
        bucketMax[rowIndex] = value;
        bucketSum[rowIndex] = value;
        bucketCount[rowIndex] = 1;
      }

      function mergeBucketRow(rowIndex, value) {
        if (value > bucketMax[rowIndex]) {
          bucketMax[rowIndex] = value;
        }
        bucketSum[rowIndex] += value;
        bucketCount[rowIndex] += 1;
      }

      for (var c = 0; c < cols; c += columnStride) {
        var timeMs;
        var nextTimeMs;
        if (hasExplicitInterval) {
          timeMs = blockStartMs + c * stepMs;
          nextTimeMs = blockStartMs + (c + columnStride) * stepMs;
          if (nextTimeMs > blockEndMs) {
            nextTimeMs = blockEndMs;
          }
        } else if (DEFAULT_CONFIG.blockTimestampMode === "end") {
          var blockTs = getBlockTimestampMs(block);
          timeMs = blockTs - (cols - 1 - c) * stepMs;
          nextTimeMs = timeMs + stepMs * columnStride;
        } else {
          var blockTsStart = getBlockTimestampMs(block);
          timeMs = blockTsStart + c * stepMs;
          nextTimeMs = timeMs + stepMs * columnStride;
        }

        if (nextTimeMs < fromMs || timeMs > toMs) {
          continue;
        }

        var x0 = Math.max(0, Math.min(plotW - 1, mapX(timeMs)));
        var x1 = Math.max(x0 + 1, Math.min(plotW, mapX(nextTimeMs) + 1));

        if (!hasBucket) {
          hasBucket = true;
          bucketX0 = x0;
          bucketX1 = x1;
          for (var initR = 0; initR < rows; initR += 1) {
            resetBucketRow(initR, processedMatrix[initR][c]);
          }
          continue;
        }

        if (x0 === bucketX0) {
          if (x1 > bucketX1) {
            bucketX1 = x1;
          }

          for (var mergeR = 0; mergeR < rows; mergeR += 1) {
            mergeBucketRow(mergeR, processedMatrix[mergeR][c]);
          }
          continue;
        }

        flushColumnBucket(rows, bucketMax, bucketSum, bucketCount, bucketX0, bucketX1);
        bucketX0 = x0;
        bucketX1 = x1;
        for (var resetR = 0; resetR < rows; resetR += 1) {
          resetBucketRow(resetR, processedMatrix[resetR][c]);
        }
      }

      if (hasBucket) {
        flushColumnBucket(rows, bucketMax, bucketSum, bucketCount, bucketX0, bucketX1);
      }
    }

    var drawSurfaceCanvas = null;
    if (gpuRenderer) {
      if (renderIntensityWithWebGl(gpuRenderer, intensityBuffer, plotW, surfaceHeight)) {
        drawSurfaceCanvas = gpuRenderer.canvas;
      }
    }
    if (!drawSurfaceCanvas) {
      drawSurfaceCanvas = createCanvasFromIntensityBuffer(plotW, surfaceHeight, intensityBuffer);
      if (!drawSurfaceCanvas) {
        return { gaps: [] };
      }
    }

    var visibleRowRange = resolveVisibleRowRange();
    var sourceY = 0;
    var sourceHeight = surfaceHeight;
    if (hasDisplayFrequencyRange) {
      var frequencyBins = normalizeFrequencyBins(options && options.frequencyBins);
      var firstRawRow = Math.min(visibleRowRange.start, visibleRowRange.end);
      var lastRawRow = Math.max(visibleRowRange.start, visibleRowRange.end);
      var mappedStart = mapFrequencyRowToScreen(firstRawRow, frequencyBins);
      var mappedEnd = mapFrequencyRowToScreen(lastRawRow, frequencyBins);
      if (mappedStart > mappedEnd) {
        var temp = mappedStart;
        mappedStart = mappedEnd;
        mappedEnd = temp;
      }
      sourceY = mappedStart;
      sourceHeight = Math.max(1, mappedEnd - mappedStart + 1);
    }

    ctx.imageSmoothingEnabled = !!DEFAULT_CONFIG.smoothVertical;
    if (ctx.imageSmoothingEnabled && typeof ctx.imageSmoothingQuality === "string") {
      ctx.imageSmoothingQuality = "high";
    }
    ctx.drawImage(drawSurfaceCanvas, 0, sourceY, plotW, sourceHeight, p.left, p.top, plotW, plotH);
    ctx.imageSmoothingEnabled = false;

    function computeGaps(from, to, intervals) {
      if (!intervals.length) {
        return [{ start: from, end: to }];
      }

      var clipped = intervals
        .map(function (interval) {
          return {
            start: Math.max(from, interval.start),
            end: Math.min(to, interval.end)
          };
        })
        .filter(function (interval) {
          return interval.end > interval.start;
        })
        .sort(function (a, b) {
          return a.start - b.start;
        });

      if (!clipped.length) {
        return [{ start: from, end: to }];
      }

      var merged = [clipped[0]];
      for (var i = 1; i < clipped.length; i += 1) {
        var current = clipped[i];
        var last = merged[merged.length - 1];
        if (current.start <= last.end) {
          if (current.end > last.end) {
            last.end = current.end;
          }
        } else {
          merged.push(current);
        }
      }

      var gaps = [];
      var cursor = from;
      for (var j = 0; j < merged.length; j += 1) {
        var seg = merged[j];
        if (seg.start > cursor) {
          gaps.push({ start: cursor, end: seg.start });
        }
        if (seg.end > cursor) {
          cursor = seg.end;
        }
      }
      if (cursor < to) {
        gaps.push({ start: cursor, end: to });
      }

      return gaps;
    }

    var gaps = computeGaps(fromMs, toMs, coverageIntervals);
    var gapRenderInfo = [];
    if (gaps.length) {
      ctx.fillStyle = DEFAULT_CONFIG.gapFill;
      ctx.strokeStyle = DEFAULT_CONFIG.gapStroke;
      ctx.lineWidth = 1;
      ctx.font = "11px Segoe UI";
      ctx.textAlign = "center";
      ctx.textBaseline = "top";

      for (var g = 0; g < gaps.length; g += 1) {
        var gap = gaps[g];
        var gx0 = Math.max(0, Math.min(plotW - 1, mapX(gap.start)));
        var gx1 = Math.max(gx0 + 1, Math.min(plotW, mapX(gap.end) + 1));
        var gw = Math.max(1, gx1 - gx0);

        gapRenderInfo.push({
          start: gap.start,
          end: gap.end,
          durationMs: gap.end - gap.start,
          xStart: p.left + gx0,
          xEnd: p.left + gx1
        });

        ctx.fillRect(p.left + gx0, p.top, gw, plotH);

        ctx.beginPath();
        ctx.moveTo(p.left + gx0 + 0.5, p.top);
        ctx.lineTo(p.left + gx0 + 0.5, p.top + plotH);
        ctx.moveTo(p.left + gx1 - 0.5, p.top);
        ctx.lineTo(p.left + gx1 - 0.5, p.top + plotH);
        ctx.stroke();

        if (gw >= 52) {
          var gapMinutes = Math.round((gap.end - gap.start) / 60000);
          ctx.fillStyle = "rgba(225, 244, 255, 0.95)";
          ctx.fillText("لا توجد بيانات " + gapMinutes + " د", p.left + gx0 + gw / 2, p.top + 4);
          ctx.fillStyle = DEFAULT_CONFIG.gapFill;
        }
      }
    }

    var xTicks = chooseTicks(plotW, 4, 8);
    ctx.strokeStyle = DEFAULT_CONFIG.gridColor;
    ctx.lineWidth = 1;
    for (var tx = 0; tx <= xTicks; tx += 1) {
      var xFrac = tx / xTicks;
      var x = p.left + Math.round(xFrac * plotW);
      ctx.beginPath();
      ctx.moveTo(x, p.top);
      ctx.lineTo(x, p.top + plotH);
      ctx.stroke();
    }

    var yTicks = 5;
    for (var ty = 0; ty <= yTicks; ty += 1) {
      var yFrac = ty / yTicks;
      var y = p.top + Math.round(yFrac * plotH);
      ctx.beginPath();
      ctx.moveTo(p.left, y);
      ctx.lineTo(p.left + plotW, y);
      ctx.stroke();
    }

    ctx.strokeStyle = DEFAULT_CONFIG.axisColor;
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    ctx.moveTo(p.left, p.top);
    ctx.lineTo(p.left, p.top + plotH);
    ctx.lineTo(p.left + plotW, p.top + plotH);
    ctx.stroke();

    ctx.fillStyle = DEFAULT_CONFIG.textColor;
    ctx.font = "12px Segoe UI";

    var withDate = rangeMs > 24 * 60 * 60 * 1000;
    ctx.textAlign = "center";
    ctx.textBaseline = "top";
    for (var lx = 0; lx <= xTicks; lx += 1) {
      var lf = lx / xTicks;
      var labelMs = fromMs + lf * rangeMs;
      var labelX = p.left + Math.round(lf * plotW);
      ctx.fillText(formatTimeLabel(labelMs, withDate), labelX, p.top + plotH + 8);
    }

    var statusBarY = p.top + plotH + 36;
    var statusBarHeight = 28;
    var aiStatusBlocks = [];
    for (var biStatus = 0; biStatus < blocks.length; biStatus += 1) {
      var statusBlock = blocks[biStatus];
      if (!statusBlock) {
        continue;
      }

      var blockStartMs = getBlockStartMs(statusBlock);
      var blockEndMs = getBlockEndMs(statusBlock);
      if (!Number.isFinite(blockStartMs) || !Number.isFinite(blockEndMs)) {
        var blockTs = getBlockTimestampMs(statusBlock);
        if (!Number.isFinite(blockTs)) {
          continue;
        }

        var matrix = statusBlock.data;
        var cols = Array.isArray(matrix) && matrix.length > 0 && Array.isArray(matrix[0]) ? matrix[0].length : 1;
        var stepMs = estimateStepMs(blocks, biStatus, rangeMs);
        if (DEFAULT_CONFIG.blockTimestampMode === "end") {
          blockStartMs = blockTs - (Math.max(1, cols) - 1) * stepMs;
          blockEndMs = blockTs + stepMs;
        } else {
          blockStartMs = blockTs;
          blockEndMs = blockTs + Math.max(1, cols) * stepMs;
        }
      }

      if (blockEndMs < blockStartMs) {
        var tmpMs = blockStartMs;
        blockStartMs = blockEndMs;
        blockEndMs = tmpMs;
      }

      var clippedStart = Math.max(fromMs, blockStartMs);
      var clippedEnd = Math.min(toMs, blockEndMs);
      if (clippedEnd <= clippedStart) {
        continue;
      }

      var rawStatusValue = statusBlock.aiStatus ?? statusBlock.ai_status;
      var statusLabel = resolveAiStatusLabel(rawStatusValue);
      var rawConfidence = statusBlock.confidence ?? statusBlock.Confidence;
      if (Number.isFinite(Number(rawConfidence))) {
        statusLabel = statusLabel + " (" + Number(rawConfidence) + "%)";
      }
      aiStatusBlocks.push({
        start: clippedStart,
        end: clippedEnd,
        color: resolveAiStatusColor(rawStatusValue),
        label: statusLabel
      });
    }

    if (aiStatusBlocks.length > 0) {
      for (var sb = 0; sb < aiStatusBlocks.length; sb += 1) {
        var statusRange = aiStatusBlocks[sb];
        var sx0 = Math.max(0, Math.min(plotW - 1, mapX(statusRange.start)));
        var sx1 = Math.max(sx0 + 1, Math.min(plotW, mapX(statusRange.end) + 1));
        var sw = Math.max(1, sx1 - sx0);
        ctx.fillStyle = statusRange.color;
        ctx.fillRect(p.left + sx0, statusBarY, sw, statusBarHeight);

        if (sw >= 72) {
          ctx.fillStyle = "#ffffff";
          ctx.font = "bold 14px Segoe UI";
          ctx.textAlign = "center";
          ctx.textBaseline = "middle";
          ctx.fillText(statusRange.label, p.left + sx0 + sw / 2, statusBarY + statusBarHeight / 2);
        }
      }
    }

    ctx.textAlign = "right";
    ctx.textBaseline = "middle";
    var minFrequency = Number.isFinite(selectedDisplayMinFrequency) ? selectedDisplayMinFrequency : options.minFrequency;
    var maxFrequency = Number.isFinite(selectedDisplayMaxFrequency) ? selectedDisplayMaxFrequency : options.maxFrequency;
    var frequencyBins = normalizeFrequencyBins(options.frequencyBins);
    var hasFrequencyBins = Array.isArray(frequencyBins) && frequencyBins.length === binCount;
    var hasRealFrequency =
      hasFrequencyBins ||
      (Number.isFinite(minFrequency) && Number.isFinite(maxFrequency) && maxFrequency > minFrequency);
    var axisMinFrequency = Number(DEFAULT_CONFIG.axisMinFrequency);
    if (!Number.isFinite(axisMinFrequency) || axisMinFrequency < 0) {
      axisMinFrequency = 30;
    }
    var axisMinDisplayFrequency =
      !hasFrequencyBins && hasRealFrequency ? Math.max(minFrequency, axisMinFrequency) : null;
    var yAxisMinFrequency = Number.isFinite(axisMinDisplayFrequency) ? axisMinDisplayFrequency : minFrequency;

    for (var ly = 0; ly <= yTicks; ly += 1) {
      var yF = ly / yTicks;
      var yPos = p.top + Math.round(yF * plotH);
      var label;
      if (hasFrequencyBins) {
        var surfaceRowIndex;
        if (hasDisplayFrequencyRange) {
          // Axis labels must follow the displayed/cropped vertical slice.
          surfaceRowIndex = sourceY + Math.round(yF * Math.max(0, sourceHeight - 1));
        } else {
          surfaceRowIndex = Math.round(yF * (binCount - 1));
        }

        surfaceRowIndex = Math.max(0, Math.min(binCount - 1, surfaceRowIndex));
        var rawRowIndex = FrequencyMapping.mapScreenYToRawRow(surfaceRowIndex, frequencyBins, binCount);
        var mappedHz = frequencyBins[rawRowIndex];
        label = formatDisplayedFrequencyLabel(mappedHz);
      } else if (hasRealFrequency) {
        var hz = maxFrequency - yF * (maxFrequency - yAxisMinFrequency);
        label = formatDisplayedFrequencyLabel(hz);
      } else {
        var bin = Math.round((1 - yF) * (binCount - 1));
        label = "نطاق " + bin;
      }
      ctx.fillText(label, p.left - 8, yPos);
    }

    ctx.save();
    ctx.fillStyle = DEFAULT_CONFIG.textColor;
    ctx.font = "12px Segoe UI";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.translate(14, p.top + plotH / 2);
    ctx.rotate(-Math.PI / 2);
    ctx.fillText(hasRealFrequency ? "التردد (Hz)" : "نطاقات التردد (Hz غير متاح)", 0, 0);
    ctx.restore();

    ctx.fillStyle = DEFAULT_CONFIG.axisColor;
    ctx.font = "11px Segoe UI";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText("الزمن", p.left + plotW / 2, p.top + plotH + 27);

    if (options.legendCanvas) {
      drawLegend(options.legendCanvas, intensityMapper.legend);
    }

    var removedPercent = 0;
    if (processCtx.removedBefore > 0) {
      removedPercent = ((processCtx.removedBefore - processCtx.removedAfter) / processCtx.removedBefore) * 100;
      if (!Number.isFinite(removedPercent) || removedPercent < 0) {
        removedPercent = 0;
      }
    }

    return {
      fromMs: fromMs,
      toMs: toMs,
      binCount: binCount,
      minFrequency: Number.isFinite(minFrequency) ? minFrequency : null,
      maxFrequency: Number.isFinite(maxFrequency) ? maxFrequency : null,
      intensityMode: intensityMapper.mode,
      intensityDbMin: Number.isFinite(intensityMapper.dbMin) ? intensityMapper.dbMin : null,
      intensityDbMax: Number.isFinite(intensityMapper.dbMax) ? intensityMapper.dbMax : null,
      intensityType: processCtx.intensityType,
      compareView: processCtx.compareView,
      layout: {
        plotLeft: p.left,
        plotTop: p.top,
        plotRight: p.left + plotW,
        plotBottom: p.top + plotH
      },
      hasRealFrequency: hasRealFrequency,
      debugStats: {
        min: processCtx.stats.min,
        max: processCtx.stats.max,
        mean: processCtx.stats.mean,
        median: processCtx.stats.median,
        p50: processCtx.stats.p50,
        p75: processCtx.stats.p75,
        p90: processCtx.stats.p90,
        p95: processCtx.stats.p95,
        p99: processCtx.stats.p99,
        selectedNoiseThreshold: processCtx.threshold,
        removedPercent: removedPercent
      },
      gaps: gapRenderInfo.map(function (gap) {
        return {
          start: formatNaiveDateTimeMs(gap.start),
          end: formatNaiveDateTimeMs(gap.end),
          durationMs: gap.durationMs,
          xStart: gap.xStart,
          xEnd: gap.xEnd
        };
      })
    };
  }

  window.Spectrogram = {
    configure: configure,
    renderSpectrogram: renderSpectrogram,
    drawLegend: drawLegend,
    valueToColor: valueToColor
  };
})();
