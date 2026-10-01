(function () {
  // Harmonic cursor for the spectrogram.
  //
  // When switched on (button above the plot), the pointer becomes a crosshair:
  //   - a HORIZONTAL line at the frequency under the pointer (f), labelled with its value;
  //   - a VERTICAL line at the pointer's time position, carrying a tick + label at every
  //     integer multiple of f (f, 2f, 3f, ...), so you can see at a glance whether an extra
  //     trace above a signal sits at 2f, 3f... (i.e. is a harmonic).
  // Works with both the linear axis and the focus+logarithmic axis.
  //
  // It draws on its own transparent overlay canvas (pointer-events: none), so moving the
  // pointer never re-renders the spectrogram and never interferes with panning/clicking.

  var MAX_HARMONICS = 40;
  var MIN_LABEL_GAP_PX = 15;
  var TICK_HALF_WIDTH_PX = 9;
  var SHOW_GUIDE_LINES = false; // true = also draw a faint dashed line across the plot at every harmonic

  var COLORS = {
    fundamental: "#00e5ff",
    vertical: "rgba(255, 255, 255, 0.9)",
    harmonic: "#ffd400",
    labelText: "#fff2b3",
    fundamentalText: "#b8f6ff",
    labelBackground: "rgba(10, 8, 25, 0.8)",
    outline: "rgba(0, 0, 0, 0.6)",
    guide: "rgba(255, 212, 0, 0.3)"
  };

  var state = {
    initialised: false,
    active: false,
    canvas: null,
    overlay: null,
    ctx: null,
    button: null,
    getMeta: null,
    isLogView: null,
    mouse: null,
    rafId: null
  };

  function formatHz(value) {
    var n = Number(value);
    if (!Number.isFinite(n)) {
      return "- Hz";
    }
    if (Math.abs(n) >= 1000) {
      return Math.round(n) + " Hz";
    }
    return Math.round(n * 10) / 10 + " Hz";
  }

  // Builds the mapping between a vertical pixel position and a frequency, consistent with the
  // axis that is currently DRAWN (focus+log when active and applied, otherwise linear).
  function buildAxisModel() {
    var meta = typeof state.getMeta === "function" ? state.getMeta() : null;
    if (!meta || !meta.layout) {
      return null;
    }

    var layout = meta.layout;
    var plotHeight = layout.plotBottom - layout.plotTop;
    if (!(plotHeight > 0) || !(layout.plotRight > layout.plotLeft)) {
      return null;
    }

    var minHz = Number(meta.minFrequency);
    var maxHz = Number(meta.maxFrequency);
    if (!Number.isFinite(minHz) || !Number.isFinite(maxHz) || !(maxHz > minHz)) {
      return null;
    }

    var logApi = window.LogSpectrogram;
    var logInfo =
      typeof state.isLogView === "function" &&
      state.isLogView() &&
      logApi &&
      typeof logApi.getLastRenderInfo === "function" &&
      typeof logApi.frequencyToPosition === "function" &&
      typeof logApi.positionToFrequency === "function"
        ? logApi.getLastRenderInfo()
        : null;

    if (logInfo && logInfo.axis) {
      var lowAtTop = !!logInfo.lowAtTop;
      return {
        layout: layout,
        maxHz: logInfo.viewMaxHz,
        hzAtY: function (y) {
          var fraction = (y - layout.plotTop) / plotHeight;
          return logApi.positionToFrequency(lowAtTop ? fraction : 1 - fraction);
        },
        yAtHz: function (frequency) {
          var position = logApi.frequencyToPosition(frequency);
          if (position === null) {
            return null;
          }
          return layout.plotTop + (lowAtTop ? position : 1 - position) * plotHeight;
        }
      };
    }

    return {
      layout: layout,
      maxHz: maxHz,
      hzAtY: function (y) {
        var fraction = (y - layout.plotTop) / plotHeight;
        return maxHz - fraction * (maxHz - minHz);
      },
      yAtHz: function (frequency) {
        return layout.plotTop + (1 - (frequency - minHz) / (maxHz - minHz)) * plotHeight;
      }
    };
  }

  // Keeps the overlay exactly on top of the spectrogram canvas (same position, same pixel grid).
  function syncOverlayGeometry() {
    var canvas = state.canvas;
    var overlay = state.overlay;
    var rect = canvas.getBoundingClientRect();
    if (!(rect.width > 0) || !(rect.height > 0) || !(canvas.width > 0) || !(canvas.height > 0)) {
      return null;
    }

    overlay.style.left = canvas.offsetLeft + "px";
    overlay.style.top = canvas.offsetTop + "px";
    overlay.style.width = rect.width + "px";
    overlay.style.height = rect.height + "px";
    if (overlay.width !== canvas.width || overlay.height !== canvas.height) {
      overlay.width = canvas.width;
      overlay.height = canvas.height;
    }

    return { scaleX: overlay.width / rect.width, scaleY: overlay.height / rect.height };
  }

  // Crisp lines: everything is snapped to whole DEVICE pixels and drawn as rectangles, so a 1 px
  // line never gets smeared over two pixel rows/columns (which makes it look dim and blurry).
  function fillLineRect(ctx, spec, extra) {
    var x0 = spec.x0 - extra;
    var y0 = spec.y0 - extra;
    ctx.fillRect(x0, y0, spec.x1 - spec.x0 + extra * 2, spec.y1 - spec.y0 + extra * 2);
  }

  function horizontalLine(x0, x1, y, thickness, color, scale) {
    var top = Math.round(y * scale.scaleY - thickness / 2);
    return { x0: Math.round(x0 * scale.scaleX), x1: Math.round(x1 * scale.scaleX), y0: top, y1: top + thickness, color: color };
  }

  function verticalLine(x, y0, y1, thickness, color, scale) {
    var left = Math.round(x * scale.scaleX - thickness / 2);
    return { x0: left, x1: left + thickness, y0: Math.round(y0 * scale.scaleY), y1: Math.round(y1 * scale.scaleY), color: color };
  }

  function paintLines(ctx, lines) {
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = COLORS.outline;
    for (var i = 0; i < lines.length; i += 1) {
      fillLineRect(ctx, lines[i], 1);
    }
    for (var j = 0; j < lines.length; j += 1) {
      ctx.fillStyle = lines[j].color;
      fillLineRect(ctx, lines[j], 0);
    }
  }

  function drawLabel(ctx, text, x, y, alignRight, textColor) {
    ctx.save();
    ctx.font = "12px Segoe UI";
    var padding = 4;
    var height = 16;
    var width = ctx.measureText(text).width + padding * 2;
    var boxX = alignRight ? x - width : x;
    ctx.fillStyle = COLORS.labelBackground;
    ctx.fillRect(boxX, y - height / 2, width, height);
    ctx.fillStyle = textColor;
    ctx.textAlign = "left";
    ctx.textBaseline = "middle";
    ctx.fillText(text, boxX + padding, y);
    ctx.restore();
  }

  function measureLabel(ctx, text) {
    ctx.save();
    ctx.font = "12px Segoe UI";
    var width = ctx.measureText(text).width + 8;
    ctx.restore();
    return width;
  }

  function drawNow() {
    state.rafId = null;
    var overlay = state.overlay;
    var ctx = state.ctx;
    if (!overlay || !ctx) {
      return;
    }

    if (!state.active) {
      return;
    }

    var scale = syncOverlayGeometry();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, overlay.width, overlay.height);
    if (!scale || !state.mouse) {
      return;
    }

    var model = buildAxisModel();
    if (!model) {
      return;
    }

    var layout = model.layout;
    var x = state.mouse.x;
    var y = state.mouse.y;
    if (x < layout.plotLeft || x > layout.plotRight || y < layout.plotTop || y > layout.plotBottom) {
      return;
    }

    var frequency = model.hzAtY(y);
    if (!Number.isFinite(frequency)) {
      return;
    }

    var thin = Math.max(1, Math.round(Math.min(scale.scaleX, scale.scaleY)));
    var thick = Math.max(2, Math.round(2 * Math.min(scale.scaleX, scale.scaleY)));
    var lines = [];

    // Fundamental: horizontal line at the pointer frequency + vertical line at the pointer time.
    lines.push(horizontalLine(layout.plotLeft, layout.plotRight, y, thin, COLORS.fundamental, scale));
    lines.push(verticalLine(x, layout.plotTop, layout.plotBottom, thin, COLORS.vertical, scale));

    // Harmonics: ticks (and labels where there is room) on the vertical line at n * f.
    var labels = [];
    if (frequency > 0) {
      var lastLabelY = null;
      for (var n = 2; n <= MAX_HARMONICS; n += 1) {
        var harmonicHz = n * frequency;
        if (harmonicHz > model.maxHz) {
          break;
        }

        var harmonicY = model.yAtHz(harmonicHz);
        if (harmonicY === null || harmonicY < layout.plotTop - 1 || harmonicY > layout.plotBottom + 1) {
          continue;
        }

        if (SHOW_GUIDE_LINES) {
          var dash = Math.max(2, Math.round(4 * scale.scaleX));
          var guide = horizontalLine(layout.plotLeft, layout.plotRight, harmonicY, thin, COLORS.guide, scale);
          for (var gx = guide.x0; gx < guide.x1; gx += dash * 2) {
            lines.push({ x0: gx, x1: Math.min(gx + dash, guide.x1), y0: guide.y0, y1: guide.y1, color: COLORS.guide });
          }
        }

        lines.push({
          x0: Math.round((x - TICK_HALF_WIDTH_PX) * scale.scaleX),
          x1: Math.round((x + TICK_HALF_WIDTH_PX) * scale.scaleX),
          y0: Math.round(harmonicY * scale.scaleY - thick / 2),
          y1: Math.round(harmonicY * scale.scaleY - thick / 2) + thick,
          color: COLORS.harmonic
        });

        if (lastLabelY === null || Math.abs(harmonicY - lastLabelY) >= MIN_LABEL_GAP_PX) {
          labels.push({ n: n, hz: harmonicHz, y: harmonicY });
          lastLabelY = harmonicY;
        }
      }
    }

    paintLines(ctx, lines);

    // Text is drawn in CSS pixels (scaled), after the lines.
    ctx.setTransform(scale.scaleX, 0, 0, scale.scaleY, 0, 0);
    var fundamentalLabelY = Math.min(Math.max(y - 11, layout.plotTop + 9), layout.plotBottom - 9);
    drawLabel(ctx, "f = " + formatHz(frequency), layout.plotLeft + 6, fundamentalLabelY, false, COLORS.fundamentalText);

    var labelsOnRight = x + 10 + measureLabel(ctx, "\u00d740  " + formatHz(model.maxHz)) <= layout.plotRight;
    for (var k = 0; k < labels.length; k += 1) {
      var item = labels[k];
      var labelY = Math.min(Math.max(item.y, layout.plotTop + 9), layout.plotBottom - 9);
      drawLabel(
        ctx,
        "\u00d7" + item.n + "  " + formatHz(item.hz),
        labelsOnRight ? x + 12 : x - 12,
        labelY,
        !labelsOnRight,
        COLORS.labelText
      );
    }
  }

  function scheduleDraw() {
    if (!state.initialised || !state.active || state.rafId !== null) {
      return;
    }
    state.rafId = window.requestAnimationFrame(drawNow);
  }

  function clearOverlay() {
    if (!state.overlay || !state.ctx) {
      return;
    }
    state.ctx.setTransform(1, 0, 0, 1, 0, 0);
    state.ctx.clearRect(0, 0, state.overlay.width, state.overlay.height);
  }

  function onMouseMove(event) {
    if (!state.active) {
      return;
    }
    var rect = state.canvas.getBoundingClientRect();
    state.mouse = { x: event.clientX - rect.left, y: event.clientY - rect.top };
    scheduleDraw();
  }

  function onMouseLeave() {
    state.mouse = null;
    if (state.active) {
      scheduleDraw();
    }
  }

  function updateButton() {
    var button = state.button;
    if (!button) {
      return;
    }
    button.setAttribute("aria-pressed", state.active ? "true" : "false");
    button.textContent = state.active ? "إيقاف مؤشر التوافقيات" : "مؤشر التوافقيات";
    button.style.background = state.active ? "#0e7490" : "";
    button.style.color = state.active ? "#ffffff" : "";
    button.style.borderColor = state.active ? "#0e7490" : "";
  }

  function setActive(active) {
    if (!state.initialised) {
      return;
    }
    state.active = !!active;
    state.overlay.style.display = state.active ? "block" : "none";
    if (!state.active) {
      state.mouse = null;
      clearOverlay();
    } else {
      scheduleDraw();
    }
    updateButton();
  }

  function injectButton(container) {
    if (!container || document.getElementById("harmonicCursorBtn")) {
      return;
    }

    var button = document.createElement("button");
    button.id = "harmonicCursorBtn";
    button.type = "button";
    button.className = "ghost-btn";
    button.title = "يرسم خطاً أفقياً عند تردد المؤشر وخطاً عمودياً عليه علامات عند مضاعفاته (×2، ×3...) لكشف التوافقيات";
    button.addEventListener("click", function () {
      setActive(!state.active);
    });
    container.insertBefore(button, container.firstChild);
    state.button = button;
    updateButton();
  }

  // config: { canvas, getMeta: () => lastRenderMeta, isLogView: () => boolean, buttonContainer? }
  function init(config) {
    if (state.initialised) {
      return true;
    }

    var canvas = config && config.canvas;
    if (!canvas || !canvas.parentElement) {
      return false;
    }

    var overlay = document.createElement("canvas");
    overlay.setAttribute("aria-hidden", "true");
    overlay.style.position = "absolute";
    overlay.style.pointerEvents = "none";
    overlay.style.zIndex = "3";
    overlay.style.display = "none";
    canvas.parentElement.appendChild(overlay);

    state.canvas = canvas;
    state.overlay = overlay;
    state.ctx = overlay.getContext("2d");
    state.getMeta = config.getMeta;
    state.isLogView = config.isLogView;
    state.initialised = true;

    canvas.addEventListener("mousemove", onMouseMove, { passive: true });
    canvas.addEventListener("mouseleave", onMouseLeave);
    injectButton(config.buttonContainer || document.querySelector(".history-top-controls"));
    return true;
  }

  window.HarmonicCursor = {
    init: init,
    // Call after every spectrogram render so the crosshair follows a changed axis/size.
    redraw: scheduleDraw,
    drawNow: drawNow,
    setActive: setActive,
    isActive: function () {
      return state.active;
    }
  };
})();