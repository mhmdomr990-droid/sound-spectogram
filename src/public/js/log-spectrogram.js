(function () {
  // Focus + logarithmic frequency view for the spectrogram.
  //
  // Axis definition (bottom = low frequency, top = high frequency, same as the linear view):
  //   - From the minimum frequency up to the FOCUS frequency the axis is LINEAR and takes
  //     FOCUS_SHARE of the plot height (this is where the interesting signals are).
  //   - Above the focus frequency the axis is LOGARITHMIC and is compressed into the
  //     remaining height. The curve is chosen so that its slope matches at the focus point.
  //
  // Strategy: the existing renderer draws the normal linear spectrogram directly on the real
  // canvas (unmodified, used as a black box), then a GPU fragment shader re-maps ONLY the plot
  // area vertically and the result is written back onto the same canvas.

  var FOCUS_SHARE = 0.75;
  var DEFAULT_FOCUS_HZ = 200;
  var FOCUS_STORAGE_KEY = "logFocusHz";
  // Set to true ONLY if your normal linear view shows LOW frequencies at the TOP of the plot.
  var LOW_FREQUENCY_AT_TOP = false;

  var LOG_WEBGL_RENDERER = {
    supported: null,
    gl: null,
    canvas: null,
    program: null,
    positionLocation: -1,
    vertexBuffer: null,
    sourceTexture: null,
    locations: null
  };

  var lastRenderInfo = null;

  var VERTEX_SOURCE = [
    "attribute vec2 a_position;",
    "varying vec2 v_uv;",
    "void main() {",
    "  gl_Position = vec4(a_position, 0.0, 1.0);",
    "  v_uv = vec2((a_position.x + 1.0) * 0.5, 1.0 - (a_position.y + 1.0) * 0.5);",
    "}"
  ].join("\n");

  // v_uv.y = 0 is the TOP of the image, 1 is the BOTTOM.
  // Where the axis compresses many source rows into one output pixel, the shader keeps the
  // brightest (peak) sample, matching the app's existing max column aggregation, so real
  // signals are never averaged away by the compression.
  var FRAGMENT_SOURCE = [
    "#ifdef GL_FRAGMENT_PRECISION_HIGH",
    "precision highp float;",
    "#else",
    "precision mediump float;",
    "#endif",
    "uniform sampler2D u_source;",
    "uniform float u_share;",
    "uniform float u_focusFrac;",
    "uniform float u_k2Frac;",
    "uniform float u_logD;",
    "uniform float u_topLinear;",
    "uniform float u_lowAtTop;",
    "uniform float u_pixelV;",
    "uniform vec4 u_plotUv;",
    "varying vec2 v_uv;",
    "float srcFromLowAt(float d) {",
    "  if (d <= u_share) {",
    "    return (d / u_share) * u_focusFrac;",
    "  }",
    "  float u = (d - u_share) / (1.0 - u_share);",
    "  if (u_topLinear > 0.5) {",
    "    return u_focusFrac + u * (1.0 - u_focusFrac);",
    "  }",
    "  return u_focusFrac + u_k2Frac * (exp(u * u_logD) - 1.0);",
    "}",
    "float mapY(float vy) {",
    "  float t = clamp((vy - u_plotUv.y) / (u_plotUv.w - u_plotUv.y), 0.0, 1.0);",
    "  float destFromLow = (u_lowAtTop > 0.5) ? t : (1.0 - t);",
    "  float srcFromLow = clamp(srcFromLowAt(destFromLow), 0.0, 1.0);",
    "  float srcT = (u_lowAtTop > 0.5) ? srcFromLow : (1.0 - srcFromLow);",
    "  return u_plotUv.y + srcT * (u_plotUv.w - u_plotUv.y);",
    "}",
    "float luma(vec4 c) {",
    "  return dot(c.rgb, vec3(0.299, 0.587, 0.114));",
    "}",
    "void main() {",
    "  bool insidePlot = v_uv.x >= u_plotUv.x && v_uv.x <= u_plotUv.z && v_uv.y >= u_plotUv.y && v_uv.y <= u_plotUv.w;",
    "  if (!insidePlot) {",
    "    gl_FragColor = texture2D(u_source, v_uv);",
    "    return;",
    "  }",
    "  float halfDy = 0.5 * u_pixelV;",
    "  float ya = mapY(v_uv.y - halfDy);",
    "  float yb = mapY(v_uv.y + halfDy);",
    "  vec4 best = texture2D(u_source, vec2(v_uv.x, mapY(v_uv.y)));",
    "  float bestLuma = luma(best);",
    "  for (int i = 0; i < 12; i++) {",
    "    float f = (float(i) + 0.5) / 12.0;",
    "    vec4 c = texture2D(u_source, vec2(v_uv.x, mix(ya, yb, f)));",
    "    float l = luma(c);",
    "    if (l > bestLuma) {",
    "      bestLuma = l;",
    "      best = c;",
    "    }",
    "  }",
    "  gl_FragColor = best;",
    "}"
  ].join("\n");

  function pickFinite() {
    for (var i = 0; i < arguments.length; i += 1) {
      var value = arguments[i];
      if (value === null || value === undefined || value === "") {
        continue;
      }
      var n = Number(value);
      if (Number.isFinite(n)) {
        return n;
      }
    }
    return null;
  }

  // ---------- focus control (small numeric input injected next to the existing checkbox) ----------

  function readStoredFocusHz() {
    try {
      var stored = Number(window.localStorage.getItem(FOCUS_STORAGE_KEY));
      if (Number.isFinite(stored) && stored > 0) {
        return stored;
      }
    } catch (_error) {
      // localStorage may be unavailable; fall back to the default.
    }
    return DEFAULT_FOCUS_HZ;
  }

  function getFocusHz() {
    var input = document.getElementById("logFocusHzInput");
    if (input) {
      var value = Number(input.value);
      if (Number.isFinite(value) && value > 0) {
        return value;
      }
    }
    return readStoredFocusHz();
  }

  function injectFocusControl() {
    if (document.getElementById("logFocusHzInput")) {
      return true;
    }

    var checkbox = document.getElementById("logFrequencyViewToggle");
    if (!checkbox || !checkbox.parentElement) {
      return false;
    }

    var label = document.createElement("label");
    label.className = "toolbar-check";
    label.title = "أعلى تردد يأخذ معظم مساحة الرسم بدون تشويه؛ ما فوقه يُضغط لوغاريتمياً";
    label.appendChild(document.createTextNode("تركيز حتى "));

    var input = document.createElement("input");
    input.id = "logFocusHzInput";
    input.type = "number";
    input.min = "1";
    input.step = "10";
    input.value = String(readStoredFocusHz());
    input.style.width = "72px";
    label.appendChild(input);
    label.appendChild(document.createTextNode(" Hz"));

    input.addEventListener("change", function () {
      var value = Number(input.value);
      if (!Number.isFinite(value) || value <= 0) {
        input.value = String(DEFAULT_FOCUS_HZ);
        value = DEFAULT_FOCUS_HZ;
      }
      try {
        window.localStorage.setItem(FOCUS_STORAGE_KEY, String(value));
      } catch (_error) {
        // Ignore storage failures.
      }
      if (checkbox.checked) {
        // Re-use the page's existing checkbox handler to trigger a re-render.
        checkbox.dispatchEvent(new Event("change", { bubbles: true }));
      }
    });

    checkbox.parentElement.insertAdjacentElement("afterend", label);
    return true;
  }

  if (!injectFocusControl() && document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", injectFocusControl);
  }

  // ---------- axis math ----------

  // Solve k * ln(1 + D / k) = C for k (the function is increasing in k).
  function solveLogScale(dHz, target) {
    var lo = 1e-6;
    var hi = 1e9;
    for (var i = 0; i < 80; i += 1) {
      var mid = Math.sqrt(lo * hi);
      var value = mid * Math.log(1 + dHz / mid);
      if (value < target) {
        lo = mid;
      } else {
        hi = mid;
      }
    }
    return Math.sqrt(lo * hi);
  }

  function buildAxis(minHz, maxHz, focusHz) {
    var range = maxHz - minHz;
    var clampedFocus = Math.min(Math.max(focusHz, minHz + range * 0.05), minHz + range * 0.9);
    var lowSpan = clampedFocus - minHz;
    var dHz = maxHz - clampedFocus;
    var share = FOCUS_SHARE;
    var target = ((1 - share) / share) * lowSpan;
    var topLinear = false;
    var k2 = 1;

    if (target >= dHz * 0.999) {
      // No compression is possible with this focus: fall back to a plain linear axis.
      topLinear = true;
      share = lowSpan / range;
    } else {
      k2 = solveLogScale(dHz, target);
    }

    return {
      minHz: minHz,
      maxHz: maxHz,
      focusHz: clampedFocus,
      share: share,
      k2: k2,
      dHz: dHz,
      topLinear: topLinear,
      lowAtTop: LOW_FREQUENCY_AT_TOP
    };
  }

  // Frequency -> 0..1 position measured from the LOW-frequency edge of the plot.
  function frequencyToPosition(frequency) {
    var axis = lastRenderInfo && lastRenderInfo.axis;
    if (!axis) {
      return null;
    }
    var f = Math.min(Math.max(Number(frequency), axis.minHz), axis.maxHz);
    var position;
    if (f <= axis.focusHz) {
      position = axis.share * ((f - axis.minHz) / (axis.focusHz - axis.minHz));
    } else if (axis.topLinear) {
      position = axis.share + (1 - axis.share) * ((f - axis.focusHz) / axis.dHz);
    } else {
      position =
        axis.share +
        (1 - axis.share) * (Math.log(1 + (f - axis.focusHz) / axis.k2) / Math.log(1 + axis.dHz / axis.k2));
    }
    return Math.min(Math.max(position, 0), 1);
  }

  // Inverse of frequencyToPosition: 0..1 position measured from the LOW-frequency edge of the
  // plot -> frequency in Hz. Used by the click probe so it reports the correct frequency.
  function positionToFrequency(position) {
    var axis = lastRenderInfo && lastRenderInfo.axis;
    if (!axis) {
      return null;
    }
    var p = Math.min(Math.max(Number(position), 0), 1);
    if (!Number.isFinite(p)) {
      return null;
    }
    if (p <= axis.share) {
      return axis.minHz + (p / axis.share) * (axis.focusHz - axis.minHz);
    }
    var u = (p - axis.share) / (1 - axis.share);
    if (axis.topLinear) {
      return axis.focusHz + u * axis.dHz;
    }
    return axis.focusHz + axis.k2 * (Math.exp(u * Math.log(1 + axis.dHz / axis.k2)) - 1);
  }

  // ---------- WebGL setup ----------

  function createShader(gl, type, source) {
    var shader = gl.createShader(type);
    if (!shader) {
      return null;
    }

    gl.shaderSource(shader, source);
    gl.compileShader(shader);
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
      console.error("Log spectrogram shader compile error:", gl.getShaderInfoLog(shader) || "Unknown shader compile error");
      gl.deleteShader(shader);
      return null;
    }

    return shader;
  }

  function createProgram(gl, vertexSource, fragmentSource) {
    var vertexShader = createShader(gl, gl.VERTEX_SHADER, vertexSource);
    var fragmentShader = createShader(gl, gl.FRAGMENT_SHADER, fragmentSource);

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
      console.error("Log spectrogram program link error:", gl.getProgramInfoLog(program) || "Unknown program link error");
      gl.deleteProgram(program);
      return null;
    }

    return program;
  }

  function resetRenderer() {
    LOG_WEBGL_RENDERER.gl = null;
    LOG_WEBGL_RENDERER.canvas = null;
    LOG_WEBGL_RENDERER.program = null;
    LOG_WEBGL_RENDERER.vertexBuffer = null;
    LOG_WEBGL_RENDERER.sourceTexture = null;
    LOG_WEBGL_RENDERER.locations = null;
  }

  function getLogWebGlRenderer(width, height) {
    if (LOG_WEBGL_RENDERER.supported === false) {
      return null;
    }

    if (!LOG_WEBGL_RENDERER.canvas) {
      var canvas = document.createElement("canvas");
      canvas.width = width;
      canvas.height = height;

      var contextOptions = {
        alpha: false,
        antialias: false,
        depth: false,
        stencil: false,
        preserveDrawingBuffer: true
      };
      var gl = canvas.getContext("webgl", contextOptions) || canvas.getContext("experimental-webgl", contextOptions);
      if (!gl) {
        LOG_WEBGL_RENDERER.supported = false;
        return null;
      }

      var program = createProgram(gl, VERTEX_SOURCE, FRAGMENT_SOURCE);
      if (!program) {
        LOG_WEBGL_RENDERER.supported = false;
        return null;
      }

      var vertexBuffer = gl.createBuffer();
      var sourceTexture = gl.createTexture();
      if (!vertexBuffer || !sourceTexture) {
        LOG_WEBGL_RENDERER.supported = false;
        return null;
      }

      gl.bindBuffer(gl.ARRAY_BUFFER, vertexBuffer);
      gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);

      canvas.addEventListener("webglcontextlost", function (event) {
        event.preventDefault();
        resetRenderer();
      });

      LOG_WEBGL_RENDERER.supported = true;
      LOG_WEBGL_RENDERER.gl = gl;
      LOG_WEBGL_RENDERER.canvas = canvas;
      LOG_WEBGL_RENDERER.program = program;
      LOG_WEBGL_RENDERER.positionLocation = gl.getAttribLocation(program, "a_position");
      LOG_WEBGL_RENDERER.vertexBuffer = vertexBuffer;
      LOG_WEBGL_RENDERER.sourceTexture = sourceTexture;
      LOG_WEBGL_RENDERER.locations = {
        source: gl.getUniformLocation(program, "u_source"),
        share: gl.getUniformLocation(program, "u_share"),
        focusFrac: gl.getUniformLocation(program, "u_focusFrac"),
        k2Frac: gl.getUniformLocation(program, "u_k2Frac"),
        logD: gl.getUniformLocation(program, "u_logD"),
        topLinear: gl.getUniformLocation(program, "u_topLinear"),
        lowAtTop: gl.getUniformLocation(program, "u_lowAtTop"),
        pixelV: gl.getUniformLocation(program, "u_pixelV"),
        plotUv: gl.getUniformLocation(program, "u_plotUv")
      };
    }

    if (LOG_WEBGL_RENDERER.canvas.width !== width || LOG_WEBGL_RENDERER.canvas.height !== height) {
      LOG_WEBGL_RENDERER.canvas.width = width;
      LOG_WEBGL_RENDERER.canvas.height = height;
    }

    return LOG_WEBGL_RENDERER;
  }

  // The frequency range that the existing linear renderer maps across the plot's full height.
  // renderSpectrogram returns display-aware min/max, so prefer those.
  function resolveViewRange(options, result) {
    var minHz = pickFinite(result && result.minFrequency, options.displayMinFrequency, options.minFrequency);
    var maxHz = pickFinite(result && result.maxFrequency, options.displayMaxFrequency, options.maxFrequency);
    if (minHz === null || maxHz === null || !(maxHz > minHz)) {
      return null;
    }
    return { viewMinHz: minHz, viewMaxHz: maxHz };
  }

  function applyLogWarp(options, result) {
    if (!result || !result.layout) {
      return;
    }

    var layout = result.layout;
    var plotLeft = Number(layout.plotLeft);
    var plotTop = Number(layout.plotTop);
    var plotRight = Number(layout.plotRight);
    var plotBottom = Number(layout.plotBottom);
    if (
      !Number.isFinite(plotLeft) ||
      !Number.isFinite(plotTop) ||
      !Number.isFinite(plotRight) ||
      !Number.isFinite(plotBottom) ||
      plotRight <= plotLeft ||
      plotBottom <= plotTop
    ) {
      return;
    }

    var range = resolveViewRange(options, result);
    if (!range) {
      return;
    }

    var canvas = options.canvas;
    var width = canvas.width;
    var height = canvas.height;
    if (!(width > 0 && height > 0)) {
      return;
    }

    var ctx = canvas.getContext("2d");
    if (!ctx) {
      return;
    }

    var renderer = getLogWebGlRenderer(width, height);
    if (!renderer) {
      console.warn("Log spectrogram: WebGL unavailable, keeping linear rendering.");
      return;
    }

    var axis = buildAxis(range.viewMinHz, range.viewMaxHz, getFocusHz());
    var rangeHz = axis.maxHz - axis.minHz;
    var loc = renderer.locations;
    var gl = renderer.gl;
    var dpr = window.devicePixelRatio || 1;
    var plotLeftUv = Math.round(plotLeft * dpr) / width;
    var plotRightUv = Math.round(plotRight * dpr) / width;
    var plotTopUv = Math.round(plotTop * dpr) / height;
    var plotBottomUv = Math.round(plotBottom * dpr) / height;

    gl.useProgram(renderer.program);
    gl.viewport(0, 0, width, height);

    gl.bindBuffer(gl.ARRAY_BUFFER, renderer.vertexBuffer);
    gl.enableVertexAttribArray(renderer.positionLocation);
    gl.vertexAttribPointer(renderer.positionLocation, 2, gl.FLOAT, false, 0, 0);

    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, renderer.sourceTexture);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
    // The real canvas (already holding the finished linear spectrogram) is the source texture.
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, canvas);

    // REQUIRED for non-power-of-two textures in WebGL1.
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);

    gl.uniform1i(loc.source, 0);
    gl.uniform1f(loc.share, axis.share);
    gl.uniform1f(loc.focusFrac, (axis.focusHz - axis.minHz) / rangeHz);
    gl.uniform1f(loc.k2Frac, axis.k2 / rangeHz);
    gl.uniform1f(loc.logD, axis.topLinear ? 0 : Math.log(1 + axis.dHz / axis.k2));
    gl.uniform1f(loc.topLinear, axis.topLinear ? 1 : 0);
    gl.uniform1f(loc.lowAtTop, axis.lowAtTop ? 1 : 0);
    gl.uniform1f(loc.pixelV, 1 / height);
    gl.uniform4f(loc.plotUv, plotLeftUv, plotTopUv, plotRightUv, plotBottomUv);

    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);

    // Write the warped image back 1:1 in device pixels, then restore the caller's transform
    // (the existing renderer leaves a devicePixelRatio transform active for later overlays).
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.drawImage(renderer.canvas, 0, 0, width, height);
    ctx.restore();

    lastRenderInfo = {
      viewMinHz: axis.minHz,
      viewMaxHz: axis.maxHz,
      axis: axis,
      lowAtTop: axis.lowAtTop,
      layout: {
        plotLeft: plotLeft,
        plotTop: plotTop,
        plotRight: plotRight,
        plotBottom: plotBottom
      }
    };

    if (window.LogFrequencyLabels && typeof window.LogFrequencyLabels.drawLogFrequencyAxisLabels === "function") {
      window.LogFrequencyLabels.drawLogFrequencyAxisLabels(ctx, axis.minHz, axis.maxHz, lastRenderInfo.layout);
    }
  }

  function renderLogSpectrogram(options) {
    if (!options || !options.canvas || !window.Spectrogram || typeof window.Spectrogram.renderSpectrogram !== "function") {
      return null;
    }

    // Normal linear render on the real canvas: identical to the default mode.
    var result = window.Spectrogram.renderSpectrogram(options);
    lastRenderInfo = null;

    try {
      applyLogWarp(options, result);
    } catch (error) {
      // The linear image is already on the canvas, so a failure here degrades gracefully.
      console.error("Log spectrogram: warp failed, keeping linear rendering.", error);
    }

    return result;
  }

  function getLastRenderInfo() {
    return lastRenderInfo;
  }

  window.LogSpectrogram = {
    renderLogSpectrogram: renderLogSpectrogram,
    getLastRenderInfo: getLastRenderInfo,
    frequencyToPosition: frequencyToPosition,
    positionToFrequency: positionToFrequency
  };
})();