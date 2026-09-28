(function () {
  var bridge = typeof window !== "undefined" ? window.DashboardBridge : null;
  if (!bridge) {
    return;
  }

  var statisticsPanel = document.getElementById("statisticsPanel");
  var deviceSelect = document.getElementById("statisticsDeviceSelect");
  var rangeForm = document.getElementById("statisticsRangeForm");
  var fromDateInput = document.getElementById("statisticsFromDate");
  var fromTimeInput = document.getElementById("statisticsFromTime");
  var toDateInput = document.getElementById("statisticsToDate");
  var toTimeInput = document.getElementById("statisticsToTime");
  var last24Btn = document.getElementById("statisticsLast24Btn");
  var messageEl = document.getElementById("statisticsMessage");
  var subtitleEl = document.getElementById("statisticsDeviceSubtitle");
  var insightEl = document.getElementById("statisticsInsightLine");
  var lastUpdatedEl = document.getElementById("statisticsLastUpdated");
  var heroStripEl = document.getElementById("statisticsHeroStrip");
  var statusTextEl = document.getElementById("statisticsStatusText");
  var packetsTextEl = document.getElementById("statisticsPacketsText");
  var downtimeSummaryEl = document.getElementById("statisticsDowntimeSummary");
  var downtimeListEl = document.getElementById("statisticsDowntimeList");
  var telemetryTextEl = document.getElementById("statisticsTelemetryText");
  var telemetryDetailsTextEl = document.getElementById("statisticsTelemetryDetailsText");
  var telemetryRawTableEl = document.getElementById("statisticsTelemetryRawTable");
  var connectivitySummaryEl = document.getElementById("statisticsConnectivitySummary");
  var connectivityListEl = document.getElementById("statisticsConnectivityList");
  var timelineStripEl = document.getElementById("statisticsTimelineStrip");
  var timelineTextEl = document.getElementById("statisticsTimelineText");
  var hourlyTextEl = document.getElementById("statisticsHourlyText");
  var comparisonTextEl = document.getElementById("statisticsComparisonText");
  var statusChartCanvas = document.getElementById("statisticsStatusChart");
  var packetsChartCanvas = document.getElementById("statisticsPacketsChart");
  var telemetryChartCanvas = document.getElementById("statisticsTelemetryChart");
  var telemetryPingChartCanvas = document.getElementById("statisticsTelemetryPingChart");
  var hourlyChartCanvas = document.getElementById("statisticsHourlyChart");
  var comparisonChartCanvas = document.getElementById("statisticsComparisonChart");

  if (
    !statisticsPanel ||
    !(deviceSelect instanceof HTMLSelectElement) ||
    !(rangeForm instanceof HTMLFormElement) ||
    !(fromDateInput instanceof HTMLInputElement) ||
    !(fromTimeInput instanceof HTMLInputElement) ||
    !(toDateInput instanceof HTMLInputElement) ||
    !(toTimeInput instanceof HTMLInputElement) ||
    !(last24Btn instanceof HTMLButtonElement) ||
    !messageEl ||
    !subtitleEl ||
    !insightEl ||
    !lastUpdatedEl ||
    !heroStripEl ||
    !statusTextEl ||
    !packetsTextEl ||
    !downtimeSummaryEl ||
    !downtimeListEl ||
    !telemetryTextEl ||
    !telemetryDetailsTextEl ||
    !telemetryRawTableEl ||
    !connectivitySummaryEl ||
    !connectivityListEl ||
    !timelineStripEl ||
    !timelineTextEl ||
    !hourlyTextEl ||
    !comparisonTextEl ||
    !(statusChartCanvas instanceof HTMLCanvasElement) ||
    !(packetsChartCanvas instanceof HTMLCanvasElement) ||
    !(telemetryChartCanvas instanceof HTMLCanvasElement) ||
    !(telemetryPingChartCanvas instanceof HTMLCanvasElement) ||
    !(hourlyChartCanvas instanceof HTMLCanvasElement) ||
    !(comparisonChartCanvas instanceof HTMLCanvasElement)
  ) {
    return;
  }

  var chartFactory = typeof window !== "undefined" ? window.Chart : null;
  var chartInstances = {
    status: null,
    packets: null,
    telemetry: null,
    telemetryPing: null,
    hourly: null,
    comparison: null
  };
  var hasAutoLoaded = false;
  var hasAnimatedEntrance = false;
  var doughnutCenterTextPlugin = {
    id: "statisticsDoughnutCenterText",
    afterDraw: function (chart, args, options) {
      if (!options || !options.text) {
        return;
      }

      var ctx = chart.ctx;
      var meta = chart.getDatasetMeta(0);
      var firstPoint = meta && meta.data && meta.data[0];
      if (!ctx || !firstPoint) {
        return;
      }

      ctx.save();
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillStyle = "#1b1f24";
      ctx.font = "700 24px Segoe UI";
      ctx.fillText(String(options.text), firstPoint.x, firstPoint.y - 6);
      ctx.fillStyle = "#5b626a";
      ctx.font = "600 11px Segoe UI";
      ctx.fillText(String(options.label || "الإجمالي"), firstPoint.x, firstPoint.y + 15);
      ctx.restore();
    }
  };
  var statusOrder = [
    { key: "detected", label: "هدف مكتشف", color: "#d13438" },
    { key: "possible", label: "هدف محتمل", color: "#f59e0b" },
    { key: "notDetected", label: "لا يوجد هدف", color: "#21a366" },
    { key: "unknown", label: "غير محدد", color: "#000000" }
  ];

  function setMessage(message, isError) {
    messageEl.textContent = message || "";
    messageEl.style.color = isError ? "#8a1c18" : "#375a4f";
  }

  function formatDateOnly(date) {
    var year = String(date.getFullYear()).padStart(4, "0");
    var month = String(date.getMonth() + 1).padStart(2, "0");
    var day = String(date.getDate()).padStart(2, "0");
    return year + "-" + month + "-" + day;
  }

  function formatTimeOnly(date) {
    var hours = String(date.getHours()).padStart(2, "0");
    var minutes = String(date.getMinutes()).padStart(2, "0");
    return hours + ":" + minutes;
  }

  function normalizeNaiveDateTimeString(value) {
    var date = new Date(value);
    if (!Number.isFinite(date.getTime())) {
      return null;
    }

    var year = String(date.getFullYear()).padStart(4, "0");
    var month = String(date.getMonth() + 1).padStart(2, "0");
    var day = String(date.getDate()).padStart(2, "0");
    var hours = String(date.getHours()).padStart(2, "0");
    var minutes = String(date.getMinutes()).padStart(2, "0");
    var seconds = String(date.getSeconds()).padStart(2, "0");
    return year + "-" + month + "-" + day + "T" + hours + ":" + minutes + ":" + seconds;
  }

  function formatLocalDateTime(value) {
    var date = new Date(value);
    if (!Number.isFinite(date.getTime())) {
      return String(value || "-");
    }

    return formatDateOnly(date) + " " + formatTimeOnly(date);
  }

  function formatShortDateTime(value) {
    var date = new Date(value);
    if (!Number.isFinite(date.getTime())) {
      return String(value || "-");
    }

    var day = String(date.getDate()).padStart(2, "0");
    var month = String(date.getMonth() + 1).padStart(2, "0");
    return day + "/" + month + " " + formatTimeOnly(date);
  }

  function formatClockNow() {
    return formatTimeOnly(new Date());
  }

  function applyLast24HoursRange() {
    var now = new Date();
    var from = new Date(now.getTime() - 24 * 60 * 60 * 1000);
    fromDateInput.value = formatDateOnly(from);
    fromTimeInput.value = formatTimeOnly(from);
    toDateInput.value = formatDateOnly(now);
    toTimeInput.value = formatTimeOnly(now);
  }

  function buildRangeQuery() {
    var fromLocal = fromDateInput.value + "T" + fromTimeInput.value;
    var toLocal = toDateInput.value + "T" + toTimeInput.value;
    var from = normalizeNaiveDateTimeString(fromLocal);
    var to = normalizeNaiveDateTimeString(toLocal);
    if (!from || !to) {
      throw new Error("قيم التاريخ أو الوقت غير صالحة");
    }

    if (new Date(from).getTime() > new Date(to).getTime()) {
      throw new Error("وقت البداية يجب أن يسبق وقت النهاية");
    }

    return "from=" + encodeURIComponent(from) + "&to=" + encodeURIComponent(to);
  }

  function syncDeviceOptions(devices, selectedId) {
    var list = Array.isArray(devices) ? devices : [];
    var previousValue = String(selectedId || deviceSelect.value || "");
    deviceSelect.innerHTML = "";

    list.forEach(function (device) {
      var option = document.createElement("option");
      option.value = String(device.id);
      option.textContent = device.name;
      deviceSelect.appendChild(option);
    });

    if (!list.length) {
      return;
    }

    var targetValue = previousValue;
    var exists = list.some(function (device) {
      return String(device.id) === targetValue;
    });
    deviceSelect.value = exists ? targetValue : String(list[0].id);
  }

  function ensureChart(name, canvas, config) {
    if (!chartFactory) {
      return null;
    }

    if (chartInstances[name]) {
      chartInstances[name].destroy();
    }

    chartInstances[name] = new chartFactory(canvas, config);
    return chartInstances[name];
  }

  function buildChartOptions(overrides) {
    var base = {
      responsive: true,
      maintainAspectRatio: false,
      animation: {
        duration: 420,
        easing: "easeOutCubic"
      },
      plugins: {
        legend: {
          position: "bottom",
          labels: {
            font: {
              family: "Segoe UI"
            },
            color: "#1b1f24"
          }
        },
        tooltip: {
          backgroundColor: "#1b1f24",
          titleColor: "#ffffff",
          bodyColor: "#f4f4ef",
          borderColor: "#d8d8d0",
          borderWidth: 1,
          padding: 10,
          titleFont: {
            family: "Segoe UI",
            weight: "700"
          },
          bodyFont: {
            family: "Segoe UI"
          }
        }
      },
      scales: {
        x: {
          ticks: {
            color: "#5b626a",
            font: {
              family: "Segoe UI"
            }
          },
          grid: {
            color: "rgba(216, 216, 208, 0.55)"
          }
        },
        y: {
          beginAtZero: true,
          ticks: {
            color: "#5b626a",
            font: {
              family: "Segoe UI"
            }
          },
          grid: {
            color: "rgba(216, 216, 208, 0.55)"
          }
        }
      }
    };

    return Object.assign(base, overrides || {});
  }

  function buildTableHtml(headers, rows) {
    var thead = headers.map(function (header) {
      return "<th>" + header + "</th>";
    }).join("");
    var tbody = rows.map(function (row) {
      return "<tr>" + row.map(function (cell) {
        return "<td>" + cell + "</td>";
      }).join("") + "</tr>";
    }).join("");
    return '<table class="statistics-summary-table"><thead><tr>' + thead + '</tr></thead><tbody>' + tbody + '</tbody></table>';
  }

  function renderTable(container, headers, rows) {
    container.innerHTML = buildTableHtml(headers, rows);
  }

  function formatNumber(value) {
    var normalized = Number(value);
    if (!Number.isFinite(normalized)) {
      return "0";
    }
    return normalized.toLocaleString("en-US");
  }

  function toFiniteOrNull(value) {
    var parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }

  function formatMetricNumber(value) {
    var parsed = Number(value);
    if (!Number.isFinite(parsed)) {
      return "-";
    }
    return parsed.toFixed(1).replace(/\.0$/, "");
  }

  function buildMetricSummary(values) {
    if (!values.length) {
      return null;
    }

    var sum = values.reduce(function (acc, item) { return acc + item; }, 0);
    return {
      min: Math.min.apply(null, values),
      max: Math.max.apply(null, values),
      avg: sum / values.length
    };
  }

  function getSampleTelemetryItems(items) {
    return (Array.isArray(items) ? items : []).filter(function (item) {
      return item && String(item.eventType || "sample").toLowerCase() === "sample";
    });
  }

  function getLatestTelemetryField(items, fieldName) {
    for (var index = items.length - 1; index >= 0; index -= 1) {
      var item = items[index];
      if (!item) {
        continue;
      }
      var value = item[fieldName];
      if (typeof value === "string" && value.trim()) {
        return value.trim();
      }
    }
    return null;
  }

  function escapeHtml(value) {
    return String(value || "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/\"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  function easeOutCubic(progress) {
    return 1 - Math.pow(1 - progress, 3);
  }

  function animateCountUp(element, targetValue, suffix, durationMs) {
    if (!element) {
      return;
    }

    var numericTarget = Number(targetValue);
    if (!Number.isFinite(numericTarget)) {
      element.textContent = String(targetValue) + (suffix || "");
      return;
    }

    var startTime = null;
    var decimals = Math.abs(numericTarget % 1) > 0.001 || suffix === "%" ? 1 : 0;
    if (suffix === " د" && Math.abs(numericTarget % 1) > 0.001) {
      decimals = 2;
    }

    function frame(timestamp) {
      if (startTime === null) {
        startTime = timestamp;
      }

      var progress = Math.min(1, (timestamp - startTime) / durationMs);
      var value = numericTarget * easeOutCubic(progress);
      var rendered = decimals > 0 ? value.toFixed(decimals) : String(Math.round(value));
      if (decimals > 0) {
        rendered = rendered.replace(/\.0$/, "");
        rendered = rendered.replace(/(\.\d*[1-9])0$/, "$1");
      }

      element.textContent = formatNumber(rendered) + (suffix || "");
      if (progress < 1) {
        window.requestAnimationFrame(frame);
      }
    }

    window.requestAnimationFrame(frame);
  }

  function resolveDetectedCount(statusDistribution) {
    if (!statusDistribution || !Array.isArray(statusDistribution.items)) {
      return 0;
    }
    for (var index = 0; index < statusDistribution.items.length; index += 1) {
      var item = statusDistribution.items[index];
      if (item && item.key === "detected") {
        return Number(item.count) || 0;
      }
    }
    return 0;
  }

  function resolveOnlineStatus(report) {
    var items = report && Array.isArray(report.timelineSummary) ? report.timelineSummary : [];
    if (!items.length) {
      return false;
    }

    var lastItem = items[items.length - 1] || {};
    var lastTimestamp = lastItem.endTime || lastItem.timestamp;
    var lastMs = new Date(lastTimestamp).getTime();
    var toMs = new Date(report.to).getTime();
    var packetIntervalMinutes = Number(report.packetIntervalMinutes) || 5;
    var onlineThresholdMs = packetIntervalMinutes * 1.5 * 60000;

    if (!Number.isFinite(lastMs) || !Number.isFinite(toMs)) {
      return false;
    }

    return toMs - lastMs <= onlineThresholdMs;
  }

  function resolveDominantStatus(statusDistribution) {
    var items = statusDistribution && Array.isArray(statusDistribution.items) ? statusDistribution.items : [];
    var filtered = items.filter(function (item) {
      return item && item.key !== "unknown";
    });
    if (!filtered.length) {
      return null;
    }

    return filtered.reduce(function (best, current) {
      if (!best) {
        return current;
      }
      return Number(current.count) > Number(best.count) ? current : best;
    }, null);
  }

  function renderInsightLine(report, isOnline) {
    var selectedOption = deviceSelect.options[deviceSelect.selectedIndex];
    var deviceName = selectedOption ? selectedOption.textContent : "الجهاز";
    var dominant = resolveDominantStatus(report.statusDistribution);
    var mainText = "الجهاز " + String(deviceName || "-") + (isOnline ? " متصل حالياً" : " غير متصل حالياً");
    var chips = [];

    if (dominant) {
      var dominantCount = Number(dominant.count) || 0;
      chips.push('<span class="statistics-insight-chip statistics-insight-chip--status">الحالة الأغلب: ' + escapeHtml(dominant.label) + '</span>');
      chips.push('<span class="statistics-insight-chip statistics-insight-chip--count">عدد حزم البيانات ضمن الفترة: ' + formatNumber(dominantCount) + ' حزمة</span>');

      if (Number.isFinite(Number(dominant.avgConfidence))) {
        chips.push(
          '<span class="statistics-insight-chip statistics-insight-chip--confidence">متوسط الثقة: ' +
          Number(dominant.avgConfidence).toFixed(1).replace(/\.0$/, "") +
          '%</span>'
        );
      }
    }

    var downtimeMinutes = Number(report.downtime && report.downtime.totalDowntimeMinutes) || 0;
    if (downtimeMinutes > 0) {
      chips.push(
        '<span class="statistics-insight-chip statistics-insight-chip--downtime">التوقف: ' +
        downtimeMinutes.toFixed(2).replace(/\.00$/, "") +
        ' د (' +
        formatNumber(report.downtime && report.downtime.periods ? report.downtime.periods.length : 0) +
        ' فترات)</span>'
      );
    }

    if (!chips.length) {
      chips.push('<span class="statistics-insight-chip">لا توجد بيانات كافية لاستخراج ملخص تفصيلي</span>');
    }

    insightEl.innerHTML =
      '<span class="statistics-insight-icon" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M9 18h6"></path><path d="M10 22h4"></path><path d="M8.5 14.5c-.92-.79-1.5-1.96-1.5-3.25a5 5 0 0 1 10 0c0 1.29-.58 2.46-1.5 3.25-.62.54-1 1.33-1 2.15V17h-5v-0.1c0-.82-.38-1.61-1-2.15Z"></path></svg></span>' +
      '<span class="statistics-insight-text">' +
      '<span class="statistics-insight-main">' + escapeHtml(mainText) + '</span>' +
      '<span class="statistics-insight-chips">' + chips.join("") + '</span>' +
      '</span>';
  }

  function renderHeroStrip(report) {
    var packetsEl = document.getElementById("statisticsHeroPackets");
    var detectionRateEl = document.getElementById("statisticsHeroDetectionRate");
    var downtimeEl = document.getElementById("statisticsHeroDowntime");
    var deviceStatusEl = document.getElementById("statisticsHeroDeviceStatus");
    var statusCardEl = document.getElementById("statisticsHeroStatusCard");
    if (!packetsEl || !detectionRateEl || !downtimeEl || !deviceStatusEl || !statusCardEl) {
      return;
    }

    var receivedCount = Number(report.receivedVsExpected && report.receivedVsExpected.receivedCount) || 0;
    var totalCount = Number(report.statusDistribution && report.statusDistribution.totalCount) || 0;
    var detectedCount = resolveDetectedCount(report.statusDistribution);
    var detectionRate = totalCount > 0 ? (detectedCount / totalCount) * 100 : 0;
    var totalDowntimeMinutes = Number(report.downtime && report.downtime.totalDowntimeMinutes) || 0;
    var isOnline = resolveOnlineStatus(report);

    animateCountUp(packetsEl, receivedCount, "", 700);
    animateCountUp(detectionRateEl, detectionRate, "%", 760);
    animateCountUp(downtimeEl, totalDowntimeMinutes, " د", 820);
    deviceStatusEl.style.opacity = "0";
    deviceStatusEl.textContent = isOnline ? "متصل" : "غير متصل";
    deviceStatusEl.style.transition = "opacity 220ms ease";
    window.requestAnimationFrame(function () {
      deviceStatusEl.style.opacity = "1";
    });

    detectionRateEl.classList.toggle("statistics-hero-value--good", detectionRate >= 50);
    detectionRateEl.classList.toggle("statistics-hero-value--warn", detectionRate < 50);
    downtimeEl.classList.toggle("statistics-hero-value--warn", totalDowntimeMinutes > 0);
    downtimeEl.classList.toggle("statistics-hero-value--good", totalDowntimeMinutes === 0);
    deviceStatusEl.classList.toggle("statistics-hero-value--good", isOnline);
    deviceStatusEl.classList.toggle("statistics-hero-value--warn", !isOnline);
    statusCardEl.classList.toggle("statistics-hero-card--online", isOnline);
    statusCardEl.classList.toggle("statistics-hero-card--offline", !isOnline);

    return isOnline;
  }

  function renderDeviceSubtitle(report) {
    var selectedOption = deviceSelect.options[deviceSelect.selectedIndex];
    var deviceName = selectedOption ? selectedOption.textContent : "-";
    subtitleEl.textContent = String(deviceName || "-") + " — " + formatShortDateTime(report.from) + " ← " + formatShortDateTime(report.to);
  }

  function renderLastUpdatedNow() {
    lastUpdatedEl.textContent = "آخر تحديث: " + formatClockNow();
  }

  function applyEntranceAnimationOnce() {
    if (hasAnimatedEntrance) {
      return;
    }

    hasAnimatedEntrance = true;
    statisticsPanel.classList.add("statistics-panel-animated");
  }

  function renderStatusDistribution(report) {
    var itemsByKey = {};
    (report.items || []).forEach(function (item) {
      itemsByKey[item.key] = item;
    });
    var orderedItems = statusOrder.map(function (status) {
      var item = itemsByKey[status.key] || {};
      return {
        label: status.label,
        color: status.color,
        count: Number(item.count) || 0,
        avgConfidence: Number.isFinite(Number(item.avgConfidence)) ? Number(item.avgConfidence) : null
      };
    });

    ensureChart("status", statusChartCanvas, {
      type: "doughnut",
      plugins: [doughnutCenterTextPlugin],
      data: {
        labels: orderedItems.map(function (item) { return item.label; }),
        datasets: [{
          data: orderedItems.map(function (item) { return item.count; }),
          backgroundColor: orderedItems.map(function (item) { return item.color; }),
          borderColor: "#ffffff",
          borderWidth: 2
        }]
      },
      options: buildChartOptions({
        cutout: "62%",
        scales: undefined,
        plugins: {
          legend: {
            position: "bottom",
            labels: {
              font: {
                family: "Segoe UI"
              },
              color: "#1b1f24"
            }
          },
          tooltip: {
            backgroundColor: "#1b1f24",
            titleColor: "#ffffff",
            bodyColor: "#f4f4ef",
            borderColor: "#d8d8d0",
            borderWidth: 1,
            padding: 10,
            titleFont: {
              family: "Segoe UI",
              weight: "700"
            },
            bodyFont: {
              family: "Segoe UI"
            }
          },
          statisticsDoughnutCenterText: {
            text: report.totalCount,
            label: "الإجمالي"
          }
        }
      })
    });

    renderTable(statusTextEl, ["الحالة", "العدد", "متوسط الثقة"], orderedItems.map(function (item) {
      return [item.label, String(item.count), item.avgConfidence === null ? "-" : String(item.avgConfidence) + "%"];
    }));
  }

  function renderReceivedVsExpected(report) {
    var missingClass = Number(report.missingCount) > 0
      ? "statistics-kpi-value statistics-kpi-value--warning"
      : "statistics-kpi-value statistics-kpi-value--ok";

    ensureChart("packets", packetsChartCanvas, {
      type: "bar",
      data: {
        labels: ["المستلم", "المتوقع", "المفقود"],
        datasets: [{
          label: "عدد الباكتات",
          data: [report.receivedCount, report.expectedCount, report.missingCount],
          backgroundColor: ["#0f766e", "#2563eb", "#d13438"],
          borderRadius: 6,
          maxBarThickness: 44
        }]
      },
      options: buildChartOptions({
        plugins: {
          legend: { display: false },
          tooltip: {
            backgroundColor: "#1b1f24",
            titleColor: "#ffffff",
            bodyColor: "#f4f4ef",
            borderColor: "#d8d8d0",
            borderWidth: 1,
            padding: 10,
            titleFont: { family: "Segoe UI", weight: "700" },
            bodyFont: { family: "Segoe UI" }
          }
        }
      })
    });

    packetsTextEl.innerHTML =
      '<div class="statistics-kpis">' +
      '<div class="statistics-kpi"><span class="statistics-kpi-label">المستلم</span><span class="statistics-kpi-value">' + report.receivedCount + '</span></div>' +
      '<div class="statistics-kpi"><span class="statistics-kpi-label">المتوقع</span><span class="statistics-kpi-value">' + report.expectedCount + '</span></div>' +
      '<div class="statistics-kpi"><span class="statistics-kpi-label">المفقود</span><span class="' + missingClass + '">' + report.missingCount + '</span></div>' +
      '</div>';
  }

  function renderDowntime(report) {
    var longest = report.longestDowntimePeriod;
    var listHtml = '';
    if (!report.periods.length) {
      listHtml = '<p class="history-info">لا توجد فجوات توقف تتجاوز عتبة ' + report.downtimeThresholdMinutes + ' دقيقة.</p>';
    } else {
      listHtml = '<div class="statistics-downtime-list">' + report.periods.map(function (period, index) {
      var isLongest = longest && period.startMs === longest.startMs && period.endMs === longest.endMs;
      return (
        '<div class="statistics-downtime-item' + (isLongest ? ' statistics-downtime-item--longest' : '') + '">' +
        '<div class="statistics-downtime-headline">' +
        '<span class="statistics-downtime-title-row"><span class="statistics-downtime-title">فترة #' + (index + 1) + '</span>' + (isLongest ? '<span class="statistics-badge statistics-badge--danger">الأطول</span>' : '') + '</span>' +
        '<span class="statistics-downtime-range">من ' + formatLocalDateTime(period.startTime) + ' إلى ' + formatLocalDateTime(period.endTime) + '</span>' +
        '</div>' +
        '<div>المدة: ' + period.durationMinutes + ' دقيقة</div>' +
        '</div>'
      );
      }).join("") + '</div>';
    }

    downtimeSummaryEl.innerHTML =
      '<div class="statistics-downtime-row">' +
      '<div class="statistics-kpis statistics-kpis-inline-3 statistics-downtime-kpis">' +
      '<div class="statistics-kpi statistics-kpi-compact"><span class="statistics-kpi-label">عدد فترات التوقف</span><span class="statistics-kpi-value statistics-kpi-value-compact">' + report.periods.length + '</span></div>' +
      '<div class="statistics-kpi statistics-kpi-compact"><span class="statistics-kpi-label">إجمالي التوقف</span><span class="statistics-kpi-value statistics-kpi-value-compact">' + report.totalDowntimeMinutes + ' د</span></div>' +
      '<div class="statistics-kpi statistics-kpi-compact"><span class="statistics-kpi-label">أطول توقف</span><span class="statistics-kpi-value statistics-kpi-value-compact">' + (longest ? longest.durationMinutes + ' د' : '-') + '</span></div>' +
      '</div>' +
      '<div class="statistics-downtime-scroll-panel">' + listHtml + '</div>' +
      '</div>';

    downtimeListEl.innerHTML = '';
  }

  function renderTelemetrySeries(report) {
    var items = getSampleTelemetryItems(report);
    var temperatureValues = items.map(function (item) {
      return toFiniteOrNull(item.temperature);
    }).filter(function (item) {
      return item !== null;
    });
    var batteryValues = items.map(function (item) {
      return toFiniteOrNull(item.battery);
    }).filter(function (item) {
      return item !== null;
    });

    ensureChart("telemetry", telemetryChartCanvas, {
      type: "line",
      data: {
        labels: items.map(function (item) { return formatShortDateTime(item.recordedAt); }),
        datasets: [
          {
            label: "درجة الحرارة",
            data: items.map(function (item) { return toFiniteOrNull(item.temperature); }),
            borderColor: "#ea7a1f",
            backgroundColor: "rgba(234, 122, 31, 0.16)",
            borderWidth: 3,
            tension: 0.32,
            pointRadius: 2,
            pointHoverRadius: 4,
            spanGaps: true,
            yAxisID: "yTemperature"
          },
          {
            label: "البطارية",
            data: items.map(function (item) { return toFiniteOrNull(item.battery); }),
            borderColor: "#2563eb",
            backgroundColor: "rgba(37, 99, 235, 0.14)",
            borderWidth: 3,
            tension: 0.28,
            pointRadius: 2,
            pointHoverRadius: 4,
            spanGaps: true,
            yAxisID: "yBattery"
          }
        ]
      },
      options: buildChartOptions({
        interaction: {
          mode: "index",
          intersect: false
        },
        plugins: {
          legend: {
            position: "bottom",
            labels: {
              font: {
                family: "Segoe UI"
              },
              color: "#1b1f24"
            }
          },
          tooltip: {
            backgroundColor: "#1b1f24",
            titleColor: "#ffffff",
            bodyColor: "#f4f4ef",
            borderColor: "#d8d8d0",
            borderWidth: 1,
            padding: 10,
            titleFont: {
              family: "Segoe UI",
              weight: "700"
            },
            bodyFont: {
              family: "Segoe UI"
            }
          }
        },
        scales: {
          x: {
            ticks: {
              color: "#5b626a",
              font: {
                family: "Segoe UI"
              }
            },
            grid: {
              color: "rgba(216, 216, 208, 0.55)"
            }
          },
          yTemperature: {
            type: "linear",
            position: "left",
            ticks: {
              color: "#5b626a",
              font: {
                family: "Segoe UI"
              }
            },
            title: {
              display: true,
              text: "الحرارة °",
              color: "#5b626a",
              font: {
                family: "Segoe UI",
                weight: "700"
              }
            },
            grid: {
              color: "rgba(216, 216, 208, 0.55)"
            }
          },
          yBattery: {
            type: "linear",
            position: "right",
            min: 0,
            max: 100,
            ticks: {
              color: "#5b626a",
              font: {
                family: "Segoe UI"
              }
            },
            title: {
              display: true,
              text: "البطارية %",
              color: "#5b626a",
              font: {
                family: "Segoe UI",
                weight: "700"
              }
            },
            grid: {
              drawOnChartArea: false
            }
          }
        }
      })
    });

    var rows = [];
    var temperatureSummary = buildMetricSummary(temperatureValues);
    if (temperatureSummary) {
      rows.push([
        "درجة الحرارة",
        formatMetricNumber(temperatureSummary.min) + "°",
        formatMetricNumber(temperatureSummary.max) + "°",
        formatMetricNumber(temperatureSummary.avg) + "°"
      ]);
    }

    var batterySummary = buildMetricSummary(batteryValues);
    if (batterySummary) {
      rows.push([
        "البطارية",
        formatMetricNumber(batterySummary.min) + "%",
        formatMetricNumber(batterySummary.max) + "%",
        formatMetricNumber(batterySummary.avg) + "%"
      ]);
    }

    if (!rows.length) {
      telemetryTextEl.innerHTML = '<p class="history-info">لا توجد عينات Telemetry ضمن النطاق المحدد.</p>';
      return;
    }

    renderTable(telemetryTextEl, ["المقياس", "الأدنى", "الأعلى", "المتوسط"], rows);
  }

  function renderTelemetryDetails(report) {
    var items = Array.isArray(report) ? report : [];
    var pingItems = items.filter(function (item) {
      return toFiniteOrNull(item && item.ping) !== null;
    });
    var pingValues = pingItems.map(function (item) {
      return Number(item.ping);
    });

    ensureChart("telemetryPing", telemetryPingChartCanvas, {
      type: "line",
      data: {
        labels: pingItems.map(function (item) { return formatShortDateTime(item.recordedAt); }),
        datasets: [{
          label: "Ping (ms)",
          data: pingValues,
          borderColor: "#0f766e",
          backgroundColor: "rgba(15, 118, 110, 0.12)",
          borderWidth: 3,
          tension: 0.28,
          pointRadius: 2,
          pointHoverRadius: 4,
          spanGaps: true,
          fill: false
        }]
      },
      options: buildChartOptions({
        interaction: {
          mode: "index",
          intersect: false
        }
      })
    });

    var pingSummary = buildMetricSummary(pingValues);
    var latestUptime = getLatestTelemetryField(items, "uptime");
    var latestInterface = getLatestTelemetryField(items, "interfaceName");
    var rows = [
      ["آخر مدة تشغيل", latestUptime || "-"],
      ["آخر واجهة معروفة", latestInterface || "-"]
    ];

    if (pingSummary) {
      rows.push(["أدنى Ping", formatMetricNumber(pingSummary.min) + " ms"]);
      rows.push(["أعلى Ping", formatMetricNumber(pingSummary.max) + " ms"]);
      rows.push(["متوسط Ping", formatMetricNumber(pingSummary.avg) + " ms"]);
    }

    renderTable(telemetryDetailsTextEl, ["المعلومة", "القيمة"], rows);
  }

  function renderConnectivityOutages(report) {
    var periods = report && Array.isArray(report.periods) ? report.periods : [];
    var longest = report ? report.longestDowntimePeriod : null;
    var listHtml = '';
    if (!periods.length) {
      listHtml = '<p class="history-info">لم يتم تسجيل انقطاعات اتصال ضمن النطاق المحدد.</p>';
    } else {
      listHtml = '<div class="statistics-downtime-list">' + periods.map(function (period, index) {
        var isLongest = longest && period.startMs === longest.startMs && period.endMs === longest.endMs;
        var rangeText = period.endTime
          ? 'من ' + formatLocalDateTime(period.startTime) + ' إلى ' + formatLocalDateTime(period.endTime)
          : 'من ' + formatLocalDateTime(period.startTime) + ' وما تزال مستمرة حتى نهاية النطاق';
        return (
          '<div class="statistics-downtime-item' + (isLongest ? ' statistics-downtime-item--longest' : '') + '">' +
          '<div class="statistics-downtime-headline">' +
          '<span class="statistics-downtime-title-row"><span class="statistics-downtime-title">انقطاع #' + (index + 1) + '</span>' + (isLongest ? '<span class="statistics-badge statistics-badge--danger">الأطول</span>' : '') + '</span>' +
          '<span class="statistics-downtime-range">' + rangeText + '</span>' +
          '</div>' +
          '<div>المدة: ' + period.durationMinutes + ' دقيقة' + (period.endTime ? '' : ' (مفتوح)') + '</div>' +
          '</div>'
        );
      }).join("") + '</div>';
    }

    connectivitySummaryEl.innerHTML =
      '<div class="statistics-downtime-row">' +
      '<div class="statistics-kpis statistics-kpis-inline-3 statistics-downtime-kpis">' +
      '<div class="statistics-kpi statistics-kpi-compact"><span class="statistics-kpi-label">عدد الانقطاعات</span><span class="statistics-kpi-value statistics-kpi-value-compact">' + periods.length + '</span></div>' +
      '<div class="statistics-kpi statistics-kpi-compact"><span class="statistics-kpi-label">إجمالي الانقطاع</span><span class="statistics-kpi-value statistics-kpi-value-compact">' + (report && report.totalDowntimeMinutes ? report.totalDowntimeMinutes : 0) + ' د</span></div>' +
      '<div class="statistics-kpi statistics-kpi-compact"><span class="statistics-kpi-label">أطول انقطاع</span><span class="statistics-kpi-value statistics-kpi-value-compact">' + (longest ? longest.durationMinutes + ' د' : '-') + '</span></div>' +
      '</div>' +
      '<div class="statistics-downtime-scroll-panel">' + listHtml + '</div>' +
      '</div>';

    connectivityListEl.innerHTML = '';
  }

  function renderTelemetryRawTable(report) {
    var items = Array.isArray(report) ? report : [];
    if (!items.length) {
      telemetryRawTableEl.innerHTML = '<p class="history-info">لا توجد بيانات Telemetry ضمن النطاق المحدد.</p>';
      return;
    }

    renderTable(telemetryRawTableEl, ["الوقت", "الحرارة", "البطارية", "البنغ", "حالة الشبكة", "الواجهة", "مدة التشغيل", "نوع السجل"], items.map(function (item) {
      return [
        formatLocalDateTime(item.recordedAt),
        toFiniteOrNull(item.temperature) === null ? "-" : formatMetricNumber(item.temperature) + "°",
        toFiniteOrNull(item.battery) === null ? "-" : formatMetricNumber(item.battery) + "%",
        toFiniteOrNull(item.ping) === null ? "-" : formatMetricNumber(item.ping) + " ms",
        item.internet || "-",
        item.interfaceName || "-",
        item.uptime || "-",
        item.eventType || "sample"
      ];
    }));
  }

  function resolveStatusVisual(aiStatus) {
    var normalized = aiStatus === null || aiStatus === undefined ? null : Number(aiStatus);
    if (normalized === 1) {
      return statusOrder[0];
    }
    if (normalized === 0) {
      return statusOrder[1];
    }
    if (normalized === 2) {
      return statusOrder[2];
    }
    return statusOrder[3];
  }

  function renderTimeline(report) {
    var items = Array.isArray(report) ? report : [];
    if (!items.length) {
      timelineStripEl.innerHTML = "";
      timelineTextEl.innerHTML = '<p class="history-info">لا توجد بيانات زمنية ضمن النطاق.</p>';
      return;
    }

    var startMs = new Date(items[0].startTime || items[0].timestamp).getTime();
    var endMs = new Date(items[items.length - 1].endTime || items[items.length - 1].timestamp).getTime();
    var totalSpan = Math.max(1, endMs - startMs);

    timelineStripEl.innerHTML = items.map(function (item) {
      var segmentStart = new Date(item.startTime || item.timestamp).getTime();
      var segmentEnd = new Date(item.endTime || item.timestamp).getTime();
      var visual = resolveStatusVisual(item.aiStatus);
      var duration = Math.max(1, segmentEnd - segmentStart);
      var widthPercent = Math.max(0.18, (duration / totalSpan) * 100);
      var title = visual.label + ' | ' + formatLocalDateTime(item.startTime || item.timestamp) + ' -> ' + formatLocalDateTime(item.endTime || item.timestamp);
      return '<div class="statistics-timeline-segment" title="' + title + '" style="width:' + widthPercent + '%; background:' + visual.color + ';"></div>';
    }).join("");

    var legendHtml =
      '<div class="statistics-inline-legend">' +
      statusOrder.map(function (item) {
        return '<span class="statistics-inline-legend-item"><span class="statistics-inline-legend-swatch" style="background:' + item.color + ';"></span>' + item.label + '</span>';
      }).join("") +
      '</div>';

    timelineTextEl.innerHTML = legendHtml + buildTableHtml(["البداية", "النهاية", "الحالة", "الثقة"], items.map(function (item) {
      var visual = resolveStatusVisual(item.aiStatus);
      return [
        formatLocalDateTime(item.startTime || item.timestamp),
        formatLocalDateTime(item.endTime || item.timestamp),
        visual.label,
        item.confidence === null || item.confidence === undefined ? "-" : String(item.confidence) + "%"
      ];
    }));
  }

  function renderHourlyDistribution(report) {
    ensureChart("hourly", hourlyChartCanvas, {
      type: "bar",
      data: {
        labels: report.items.map(function (item) { return String(item.hourOfDay); }),
        datasets: [{
          label: "مرات الاكتشاف",
          data: report.items.map(function (item) { return item.count; }),
          backgroundColor: "#d13438",
          borderRadius: 6,
          maxBarThickness: 24
        }]
      },
      options: buildChartOptions()
    });

    var hoursRow = report.items.map(function (item) {
      return "<td>" + String(item.hourOfDay) + "</td>";
    }).join("");
    var countsRow = report.items.map(function (item) {
      return "<td>" + String(item.count) + "</td>";
    }).join("");

    hourlyTextEl.innerHTML =
      '<div class="statistics-hourly-table-wrap">' +
      '<table class="statistics-summary-table statistics-hourly-compact-table">' +
      '<tbody>' +
      '<tr><th>الساعة</th>' + hoursRow + '</tr>' +
      '<tr><th>عدد الاكتشافات</th>' + countsRow + '</tr>' +
      '</tbody>' +
      '</table>' +
      '</div>';
  }

  function renderComparison(report) {
    var items = Array.isArray(report.items) ? report.items : [];
    ensureChart("comparison", comparisonChartCanvas, {
      type: "bar",
      data: {
        labels: items.map(function (item) { return item.deviceName; }),
        datasets: [
          { label: "مكتشف", data: items.map(function (item) { return item.counts.detected; }), backgroundColor: "#d13438", borderRadius: 6, maxBarThickness: 22 },
          { label: "محتمل", data: items.map(function (item) { return item.counts.possible; }), backgroundColor: "#f59e0b", borderRadius: 6, maxBarThickness: 22 },
          { label: "لا يوجد هدف", data: items.map(function (item) { return item.counts.notDetected; }), backgroundColor: "#21a366", borderRadius: 6, maxBarThickness: 22 }
        ]
      },
      options: buildChartOptions()
    });

    renderTable(comparisonTextEl, ["الجهاز", "مكتشف", "محتمل", "لا يوجد هدف", "غير محدد", "الإجمالي"], items.map(function (item) {
      return [
        item.deviceName,
        String(item.counts.detected),
        String(item.counts.possible),
        String(item.counts.notDetected),
        String(item.counts.unknown),
        String(item.totalCount)
      ];
    }));
  }

  function renderEmptyChartShells() {
    ensureChart("status", statusChartCanvas, {
      type: "doughnut",
      plugins: [doughnutCenterTextPlugin],
      data: {
        labels: statusOrder.map(function (item) { return item.label; }),
        datasets: [{
          data: statusOrder.map(function () { return 0; }),
          backgroundColor: statusOrder.map(function (item) { return item.color; }),
          borderColor: "#ffffff",
          borderWidth: 2
        }]
      },
      options: buildChartOptions({
        cutout: "62%",
        scales: undefined,
        plugins: {
          legend: {
            position: "bottom",
            labels: {
              font: {
                family: "Segoe UI"
              },
              color: "#1b1f24"
            }
          },
          tooltip: {
            backgroundColor: "#1b1f24",
            titleColor: "#ffffff",
            bodyColor: "#f4f4ef",
            borderColor: "#d8d8d0",
            borderWidth: 1,
            padding: 10,
            titleFont: {
              family: "Segoe UI",
              weight: "700"
            },
            bodyFont: {
              family: "Segoe UI"
            }
          },
          statisticsDoughnutCenterText: {
            text: 0,
            label: "الإجمالي"
          }
        }
      })
    });

    ensureChart("packets", packetsChartCanvas, {
      type: "bar",
      data: {
        labels: ["المستلم", "المتوقع", "المفقود"],
        datasets: [{
          label: "عدد الباكتات",
          data: [0, 0, 0],
          backgroundColor: ["#0f766e", "#2563eb", "#d13438"],
          borderRadius: 6,
          maxBarThickness: 44
        }]
      },
      options: buildChartOptions({
        plugins: {
          legend: { display: false },
          tooltip: {
            backgroundColor: "#1b1f24",
            titleColor: "#ffffff",
            bodyColor: "#f4f4ef",
            borderColor: "#d8d8d0",
            borderWidth: 1,
            padding: 10,
            titleFont: { family: "Segoe UI", weight: "700" },
            bodyFont: { family: "Segoe UI" }
          }
        }
      })
    });

    ensureChart("telemetry", telemetryChartCanvas, {
      type: "line",
      data: {
        labels: [],
        datasets: [
          {
            label: "درجة الحرارة",
            data: [],
            borderColor: "#ea7a1f",
            backgroundColor: "rgba(234, 122, 31, 0.16)",
            borderWidth: 3,
            tension: 0.32,
            pointRadius: 2,
            pointHoverRadius: 4,
            spanGaps: true,
            yAxisID: "yTemperature"
          },
          {
            label: "البطارية",
            data: [],
            borderColor: "#2563eb",
            backgroundColor: "rgba(37, 99, 235, 0.14)",
            borderWidth: 3,
            tension: 0.28,
            pointRadius: 2,
            pointHoverRadius: 4,
            spanGaps: true,
            yAxisID: "yBattery"
          }
        ]
      },
      options: buildChartOptions({
        interaction: {
          mode: "index",
          intersect: false
        },
        plugins: {
          legend: {
            position: "bottom",
            labels: {
              font: {
                family: "Segoe UI"
              },
              color: "#1b1f24"
            }
          },
          tooltip: {
            backgroundColor: "#1b1f24",
            titleColor: "#ffffff",
            bodyColor: "#f4f4ef",
            borderColor: "#d8d8d0",
            borderWidth: 1,
            padding: 10,
            titleFont: {
              family: "Segoe UI",
              weight: "700"
            },
            bodyFont: {
              family: "Segoe UI"
            }
          }
        },
        scales: {
          x: {
            ticks: {
              color: "#5b626a",
              font: {
                family: "Segoe UI"
              }
            },
            grid: {
              color: "rgba(216, 216, 208, 0.55)"
            }
          },
          yTemperature: {
            type: "linear",
            position: "left",
            ticks: {
              color: "#5b626a",
              font: {
                family: "Segoe UI"
              }
            },
            title: {
              display: true,
              text: "الحرارة °",
              color: "#5b626a",
              font: {
                family: "Segoe UI",
                weight: "700"
              }
            },
            grid: {
              color: "rgba(216, 216, 208, 0.55)"
            }
          },
          yBattery: {
            type: "linear",
            position: "right",
            min: 0,
            max: 100,
            ticks: {
              color: "#5b626a",
              font: {
                family: "Segoe UI"
              }
            },
            title: {
              display: true,
              text: "البطارية %",
              color: "#5b626a",
              font: {
                family: "Segoe UI",
                weight: "700"
              }
            },
            grid: {
              drawOnChartArea: false
            }
          }
        }
      })
    });

    ensureChart("telemetryPing", telemetryPingChartCanvas, {
      type: "line",
      data: {
        labels: [],
        datasets: [{
          label: "Ping (ms)",
          data: [],
          borderColor: "#0f766e",
          backgroundColor: "rgba(15, 118, 110, 0.12)",
          borderWidth: 3,
          tension: 0.28,
          pointRadius: 2,
          pointHoverRadius: 4,
          spanGaps: true,
          fill: false
        }]
      },
      options: buildChartOptions({
        interaction: {
          mode: "index",
          intersect: false
        }
      })
    });

    ensureChart("hourly", hourlyChartCanvas, {
      type: "bar",
      data: {
        labels: [],
        datasets: [{
          label: "مرات الاكتشاف",
          data: [],
          backgroundColor: "#d13438",
          borderRadius: 6,
          maxBarThickness: 24
        }]
      },
      options: buildChartOptions()
    });

    ensureChart("comparison", comparisonChartCanvas, {
      type: "bar",
      data: {
        labels: [],
        datasets: [
          { label: "مكتشف", data: [], backgroundColor: "#d13438", borderRadius: 6, maxBarThickness: 22 },
          { label: "محتمل", data: [], backgroundColor: "#f59e0b", borderRadius: 6, maxBarThickness: 22 },
          { label: "لا يوجد هدف", data: [], backgroundColor: "#21a366", borderRadius: 6, maxBarThickness: 22 }
        ]
      },
      options: buildChartOptions()
    });
  }

  function resizeAllStatisticsCharts() {
    Object.keys(chartInstances).forEach(function (key) {
      var chart = chartInstances[key];
      if (chart && typeof chart.resize === "function") {
        chart.resize();
      }
    });
  }

  function autoLoadIfDevicesReady() {
    var devices = bridge.getDevices();
    if (!Array.isArray(devices) || !devices.length) {
      return false;
    }

    syncDeviceOptions(devices, bridge.getSelectedDeviceId());
    if (!deviceSelect.value && devices[0] && devices[0].id !== undefined && devices[0].id !== null) {
      deviceSelect.value = String(devices[0].id);
    }

    if (!deviceSelect.value) {
      return false;
    }

    hasAutoLoaded = true;
    loadStatistics();
    return true;
  }

  async function loadStatistics() {
    var deviceId = Number(deviceSelect.value);
    if (!Number.isFinite(deviceId) || deviceId <= 0) {
      setMessage("لا يوجد جهاز محدد لعرض الإحصائيات.", true);
      return;
    }

    try {
      setMessage("جاري تحميل الإحصائيات...", false);
      var query = buildRangeQuery();
      var responses = await Promise.all([
        bridge.apiRequest("/api/devices/" + deviceId + "/statistics?" + query),
        bridge.apiRequest("/api/statistics/comparison?" + query),
        bridge.apiRequest("/api/devices/" + deviceId + "/telemetry/series?" + query),
        bridge.apiRequest("/api/devices/" + deviceId + "/telemetry/connectivity?" + query)
      ]);

      var report = responses[0];

      var isOnline = renderHeroStrip(report);
      renderStatusDistribution(report.statusDistribution);
      renderReceivedVsExpected(report.receivedVsExpected);
      renderDowntime(report.downtime);
      renderTelemetrySeries(responses[2]);
      renderTelemetryDetails(responses[2]);
      renderTelemetryRawTable(responses[2]);
      renderConnectivityOutages(responses[3]);
      renderTimeline(report.timelineSummary);
      renderHourlyDistribution(report.hourlyDetectionDistribution);
      renderComparison(responses[1]);
      renderDeviceSubtitle(report);
      renderInsightLine(report, isOnline);
      renderLastUpdatedNow();
      applyEntranceAnimationOnce();
      setMessage("تم تحميل الإحصائيات للنطاق المحدد.", false);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "فشل تحميل الإحصائيات", true);
    }
  }

  rangeForm.addEventListener("submit", function (event) {
    event.preventDefault();
    loadStatistics();
  });

  last24Btn.addEventListener("click", function () {
    applyLast24HoursRange();
    loadStatistics();
  });

  window.addEventListener("dashboard:devices-loaded", function (event) {
    var detail = event && event.detail ? event.detail : {};
    syncDeviceOptions(detail.devices, detail.selectedDeviceId || bridge.getSelectedDeviceId());
    if (!hasAutoLoaded && detail.devices && detail.devices.length) {
      hasAutoLoaded = true;
      loadStatistics();
    }
  });

  window.addEventListener("dashboard:device-selected", function (event) {
    var detail = event && event.detail ? event.detail : {};
    if (detail.deviceId) {
      deviceSelect.value = String(detail.deviceId);
    }
  });

  var statisticsPanelObserver = new MutationObserver(function (mutations) {
    mutations.forEach(function (mutation) {
      if (mutation.type === "attributes" && mutation.attributeName === "class" && statisticsPanel.classList.contains("active")) {
        resizeAllStatisticsCharts();
      }
    });
  });

  statisticsPanelObserver.observe(statisticsPanel, {
    attributes: true,
    attributeFilter: ["class"]
  });

  renderEmptyChartShells();
  resizeAllStatisticsCharts();
  applyLast24HoursRange();
  syncDeviceOptions(bridge.getDevices(), bridge.getSelectedDeviceId());
  if (!autoLoadIfDevicesReady()) {
    window.setTimeout(function () {
      if (!hasAutoLoaded) {
        autoLoadIfDevicesReady();
      }
    }, 300);
  }
})();