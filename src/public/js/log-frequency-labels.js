(function () {
  var BACKGROUND_COLOR = "#140d28";
  var TEXT_COLOR = "#d8e2ff";
  var AXIS_COLOR = "#cfd7e6";
  var CANDIDATE_VALUES = [0, 10, 20, 50, 75, 100, 125, 150, 175, 200, 250, 300, 400, 500, 600, 800, 1000, 1500, 2000, 3000, 4000, 5000, 8000, 10000, 20000];
  var MIN_LABEL_GAP_PX = 14;
  var LABEL_COLUMN_LEFT = 22; // keep the rotated axis title (drawn near x = 14) untouched

  function formatLabel(hz) {
    var n = Number(hz);
    if (!Number.isFinite(n)) {
      return "- Hz";
    }
    return Math.round(n) + " Hz";
  }

  function readPlotArea(plotArea) {
    if (!plotArea) {
      return null;
    }
    // Accept both naming styles: {left,top,right,bottom} and {plotLeft,plotTop,plotRight,plotBottom}.
    var left = Number(plotArea.plotLeft !== undefined ? plotArea.plotLeft : plotArea.left);
    var top = Number(plotArea.plotTop !== undefined ? plotArea.plotTop : plotArea.top);
    var right = Number(plotArea.plotRight !== undefined ? plotArea.plotRight : plotArea.right);
    var bottom = Number(plotArea.plotBottom !== undefined ? plotArea.plotBottom : plotArea.bottom);
    if (
      !Number.isFinite(left) ||
      !Number.isFinite(top) ||
      !Number.isFinite(right) ||
      !Number.isFinite(bottom) ||
      right <= left ||
      bottom <= top
    ) {
      return null;
    }
    return { left: left, top: top, right: right, bottom: bottom };
  }

  function drawLogFrequencyAxisLabels(ctx, minFrequency, maxFrequency, plotArea) {
    if (!ctx || !window.LogSpectrogram || typeof window.LogSpectrogram.getLastRenderInfo !== "function") {
      return;
    }

    // Always use the exact axis and geometry of the last render, so any caller draws consistent labels.
    var info = window.LogSpectrogram.getLastRenderInfo();
    if (!info || !info.axis) {
      return;
    }

    var plot = readPlotArea(info.layout) || readPlotArea(plotArea);
    var minHz = info.viewMinHz;
    var maxHz = info.viewMaxHz;
    if (!plot || !Number.isFinite(minHz) || !Number.isFinite(maxHz) || maxHz <= minHz) {
      return;
    }

    var plotHeight = plot.bottom - plot.top;
    var lowAtTop = !!info.lowAtTop;

    var values = [minHz];
    for (var i = 0; i < CANDIDATE_VALUES.length; i += 1) {
      var candidate = CANDIDATE_VALUES[i];
      if (candidate > minHz && candidate < maxHz) {
        values.push(candidate);
      }
    }
    values.push(maxHz);

    var positioned = [];
    for (var j = 0; j < values.length; j += 1) {
      var position = window.LogSpectrogram.frequencyToPosition(values[j]);
      if (position === null) {
        return;
      }
      var fraction = lowAtTop ? position : 1 - position;
      positioned.push({
        value: values[j],
        y: plot.top + Math.round(fraction * plotHeight)
      });
    }

    // Keep labels readable: drop any that would sit closer than MIN_LABEL_GAP_PX to the previous one,
    // but always keep the maximum-frequency label.
    var kept = [];
    for (var k = 0; k < positioned.length; k += 1) {
      var item = positioned[k];
      var isLast = k === positioned.length - 1;
      if (kept.length && Math.abs(kept[kept.length - 1].y - item.y) < MIN_LABEL_GAP_PX) {
        if (isLast) {
          kept[kept.length - 1] = item;
        }
        continue;
      }
      kept.push(item);
    }

    ctx.save();

    // Erase the old (linear) numeric labels, but not the rotated axis title further left.
    ctx.fillStyle = BACKGROUND_COLOR;
    ctx.fillRect(LABEL_COLUMN_LEFT, plot.top - 8, Math.max(0, plot.left - 2 - LABEL_COLUMN_LEFT), plotHeight + 16);

    ctx.strokeStyle = AXIS_COLOR;
    ctx.lineWidth = 1;
    ctx.fillStyle = TEXT_COLOR;
    ctx.font = "12px Segoe UI";
    ctx.textAlign = "right";
    ctx.textBaseline = "middle";

    ctx.beginPath();
    for (var m = 0; m < kept.length; m += 1) {
      ctx.moveTo(plot.left - 4, kept[m].y + 0.5);
      ctx.lineTo(plot.left, kept[m].y + 0.5);
    }
    ctx.stroke();

    for (var n = 0; n < kept.length; n += 1) {
      ctx.fillText(formatLabel(kept[n].value), plot.left - 8, kept[n].y);
    }

    ctx.restore();
  }

  window.LogFrequencyLabels = {
    drawLogFrequencyAxisLabels: drawLogFrequencyAxisLabels
  };
})();
