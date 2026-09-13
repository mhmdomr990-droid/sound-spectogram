# Spectrogram Rendering & Gap Algorithm — Reference Specification

> **This file is IMMUTABLE.** It describes the **correct** algorithm that the Flutter app must implement.
> When rendering or gaps break, compare the code against this file and fix the code to match.
> Do NOT update this file to match broken code.

---

## 1. Data Flow

```
Server (JSON blocks)
    │
    ▼
DeviceHistory.fromJson()          Decode matrix (raw or gzip-base64)
    │
    ▼
buildMatrixFromHistories()        Merge blocks into one matrix (in isolate)
    │                             Zero-fill uncovered columns
    ▼
_processBlockMatrix()             Noise suppression pipeline (in isolate)
    │
    ▼
buildRgba()                       Intensity mapping + color map + pixel output
    │                             (runs in isolate, returns intensity buffer + RGBA)
    ▼
Apply Gain                        Rebuild image from cached intensity + gainDb
    │
    ▼
_SpectroPainter                   Draw image + axes + gaps + markers + status bar
```

---

## 2. Matrix Construction

**Function:** `buildMatrixFromHistories(blocks, requestStart, requestEnd)`

### Inputs
- `blocks`: List of `HistoryBlock` — each has `data` (2D matrix), `startTime`, `endTime`
- `requestStart`, `requestEnd`: ISO 8601 time strings defining the matrix time range

### Algorithm
1. `fromMs = parseMs(requestStart)` — left boundary in milliseconds
2. `toMs = parseMs(requestEnd)` — right boundary in milliseconds
3. `colsPerMs = totalDataCols / totalDataMs` — **global average** across ALL blocks
   - `totalDataCols = Σ (block.data[0].length)` for each block with non-empty data
   - `totalDataMs = Σ (block.endTime - block.startTime)` for each block with non-empty data
4. `totalCols = round((toMs - fromMs) × colsPerMs)`
5. Create matrix: `targetRows × totalCols`, **all zeros**
6. For each block:
   - `startCol = round((blockStart - fromMs) × colsPerMs).clamp(0, totalCols)`
   - `endCol = round((blockEnd - fromMs) × colsPerMs).clamp(0, totalCols)`
   - Copy block data into matrix at `[row][startCol .. endCol]`
7. Columns not covered by any block remain **0** (these are the gaps)

### Image Width
- `image.width = totalCols` (clamped to max **4096**)
- `image.height = targetRows` (clamped to max **4096**)

### Critical Rule
> `requestStartTime` MUST equal the first block's actual `startTime`.
> `requestEndTime` MUST equal the last block's actual `endTime`.
> If `requestStartTime` is set to a time BEFORE the first block, the matrix will have
> zero-filled columns at the start, causing a **blue gap strip on the left side**.

---

## 3. Noise Suppression Pipeline

Applied per-block before matrix construction.

### Step 1: Adaptive Noise Floor (Histogram)
- Collect normalized histogram: 1024 bins, sample ~64×64 grid
- Compute 72nd percentile → `adaptiveFloor`
- `threshold = max(adaptiveFloor, noiseThreshold)`

### Step 2: Threshold Gate
```
for each cell (r, c):
    if matrix[r][c] < threshold: matrix[r][c] = 0
    mask[r][c] = matrix[r][c] > 0
```

### Step 3: Isolated Pixel Removal
- Neighborhood: 5×5 (radius = 2)
- For each cell: count active neighbors in 5×5 window
- Keep if: `activeNeighbors >= 2` OR has **line support**
- Line support: both up+down active OR both left+right active

### Step 4: Singleton Component Removal
- Connected components via 8-connectivity BFS
- Components with size < **15 pixels** → delete entirely

### Step 5: Morphological Gap Bridging
```
if inactive cell has active neighbors above AND below → activate
if inactive cell has active neighbors left AND right → activate
```

---

## 4. Intensity Mapping

### Type Detection
| Condition | Type |
|-----------|------|
| max value ≤ 1.0 | `normalized` |
| max value ≤ 255.0 | `uint8` |
| max value > 255.0 | `magnitude` |

### Normalization
| Type | Formula | Range |
|------|---------|-------|
| `normalized` | `clamp01(value)` | [0, 1] |
| `uint8` | `value / 255.0` | [0, 1] |
| `db` | `(value - dbMin) / (dbMax - dbMin)` | [0, 1] |
| `magnitude` | Convert to dB: `20 × log10(value)`, then dB normalization | [0, 1] |

### Percentile Auto-Range (dB/magnitude)
- Collect subsampled dB values from the matrix
- `dbMin = 5th percentile`, `dbMax = 99th percentile`
- Map: `clamp01((dB - dbMin) / (dbMax - dbMin))`

### Display Gain
```
scale = 10^(gainDb / 20)
result = clamp01(value × scale)
```

---

## 5. Color Mapping (Magma)

### Gamma Correction
```
v = pow(normalizedValue, gamma)
```
Default `gamma = 1.0` (no change).

### Magma Colormap Stops
| Position | R | G | B |
|----------|---|---|---|
| 0.00 | 0 | 0 | 4 |
| 0.16 | 28 | 16 | 68 |
| 0.33 | 79 | 18 | 123 |
| 0.50 | 129 | 37 | 129 |
| 0.66 | 181 | 54 | 122 |
| 0.83 | 229 | 80 | 100 |
| 1.00 | 252 | 253 | 191 |

### Interpolation
1. Find two adjacent stops `a` and `b` such that `a.position ≤ v ≤ b.position`
2. `t = (v - a.position) / (b.position - a.position)`
3. `R = lerp(a.R, b.R, t)`, same for G, B
4. Output: RGB bytes (0–255), alpha = 0xFF

---

## 6. Column → Pixel Mapping

**Function:** `buildRgba(matrix, width, height, ...)`

### Per-Column Loop
For each matrix column `c` (0 to cols−1):
```
xStart = floor(c × width / cols)
xEnd   = ceil((c + 1) × width / cols)
```

Multiple columns may map to the same pixel → **bucket aggregation**:
- **max**: `bucketValue = max(bucketValue, newValue)`
- **hybrid**: `0.7 × max + 0.3 × mean`

### Y-Axis Inversion
Row 0 in the matrix = highest frequency = appears at the **bottom** of the image.
```
yNativeTop    = rows - rowEnd
yNativeBottom = rows - 1 - rowStart
```

### Final Pixel Value
```
value = intensityMapper(groupedValue)   // normalized [0, 1]
value = clamp01(value × gainScale)      // apply display gain
byteValue = max(0, min(255, round(value × 255)))
```

### Background
- All pixels initialized to background color `0xFF111026` (dark purple)
- Only cells with `byteValue > noiseThreshold` are painted

---

## 7. Viewport & Canvas Drawing

### Viewport
- Range: `[0.0, 1.0]` over the full image width
- Default: `viewportStart = 0.0`, `viewportEnd = 1.0` (show everything)
- Pinch/pan gestures modify these values

### Image Drawing
```
srcX0 = viewportStart × image.width
srcX1 = viewportEnd × image.width
destX0 = pLeft + ((viewportStart - vpStart) / span) × plotW
destX1 = pLeft + ((viewportEnd - vpStart) / span) × plotW

canvas.drawImageRect(image, src, dst, imgPaint)
```

### Painter Insets
| Edge | Value |
|------|-------|
| Left | 40 px |
| Right | 6 px |
| Top | 4 px |
| Bottom (no status bar) | 36 px |
| Bottom (compact status bar) | 50 px |
| Bottom (full status bar) | 68 px |

### Filter
- `isAntiAlias = false`
- `filterQuality = FilterQuality.none` (nearest-neighbor, no smoothing)

---

## 8. Gap Algorithm

This is the critical section for web parity.

### 8.1 Why Gaps Exist

The matrix is time-aligned: columns represent fixed time steps from `requestStartTime` to `requestEndTime`. When a data block doesn't cover a time range, those matrix columns are **0** (zero-filled). The gap overlay draws semi-transparent blue rectangles over these zero-filled regions to visually indicate missing data.

### 8.2 Coverage Intervals

Computed in the canvas painter, NOT in the isolate.

**Function:** `_buildCoverageIntervals()`

```
fromMs = parseMs(requestStartTime)
toMs = parseMs(requestEndTime)
colsPerMs = totalDataCols / totalDataMs    // same formula as matrix construction

for each history block with non-empty data:
    startCol = round((blockStart - fromMs) × colsPerMs).clamp(0, ∞)
    endCol = round((blockEnd - fromMs) × colsPerMs).clamp(0, ∞)
    if endCol > startCol:
        add CoverageInterval(startMs: startCol, endMs: endCol)
```

**IMPORTANT:** Despite field names `startMs`/`endMs`, these store **column indices**, not milliseconds.

### 8.3 Gap Detection (Cursor Sweep)

```
Input:  merged intervals (sorted by start, non-overlapping)
        visStartCol, visEndCol (visible column range from viewport)

cursor = visStartCol

for each interval iv in merged:
    if iv.startMs > cursor:
        GAP from cursor to iv.startMs        ← inter-block gap
    cursor = max(cursor, iv.endMs)

if cursor < visEndCol:
    GAP from cursor to visEndCol              ← trailing gap
```

**There is NO leading gap before the first interval** because:
- `cursor` starts at `visStartCol`
- First interval starts at `visStartCol` (or very close, since `requestStartTime = first block's startTime`)
- Therefore `iv.startMs > cursor` is false for the first interval → no gap drawn before it

### 8.4 Gap Rendering

For each detected gap `[gStart, gEnd]`:

```
gapScale = image.width / totalCols

scaledStart = round(gStart × gapScale)
scaledEnd = round(gEnd × gapScale)
clippedStart = scaledStart.clamp(visStartCol, visEndCol)
clippedEnd = scaledEnd.clamp(visStartCol, visEndCol)

gx0 = pLeft + ((clippedStart - visStartCol) / visCols) × plotW
gx1 = pLeft + ((clippedEnd - visStartCol) / visCols) × plotW
gw = gx1 - gx0

1. FILL:    canvas.drawRect(Rect(gx0, pTop, gw, plotH), gapFillPaint)
2. STROKE:  canvas.drawLine((gx0, pTop), (gx0, pTop + plotH), gapStrokePaint)
            canvas.drawLine((gx1, pTop), (gx1, pTop + plotH), gapStrokePaint)
3. LABEL:   if gw >= 52 px:
               gapMinutes = round((gEnd - gStart) / visCols × (toMs - fromMs) / 60000)
               text = "لا توجد بيانات {gapMinutes} د"
               centered horizontally in the gap
```

### 8.5 Leading Gap Prevention (~30s Bug)

**Root Cause:** `requestStartTime` was set to a time before the first block's actual start.
This caused zero-filled columns at the start of the matrix, and the gap overlay drew a blue strip on the left.

**Fix Rule:** `requestStartTime` MUST equal the first block's actual `startTime`.

| Mode | How to set requestStartTime |
|------|---------------------------|
| Custom range | `result.first.startTime` (NOT user-selected `from`) |
| Follow-live | `max(anchor - window, first block's startTime)` |
| Last hour / last 5h / last 24h | `result.first.startTime` |

### 8.6 Gap Colors & Sizes

| Element | Value |
|---------|-------|
| Fill color | `Color(0x423667C2)` — rgba(54, 103, 194, 0.26) |
| Stroke color | `Color(0xE766C4E7)` — rgba(102, 196, 231, 0.9) |
| Min width for label | 52 px |
| Font size | 11 px |
| Label format | `"لا توجد بيانات {N} د"` |

---

## 9. Time Axis (X)

### Labels
- Format: `HH:MM` (local timezone)
- If range > 24 hours: `YYYY-MM-DD HH:MM`

### Grid
- Vertical lines: 4–8 ticks (target ~120 px between ticks)
- `xTicks = clamp(floor(plotW / 120), 4, 8)`
- Grid color: `rgba(207, 215, 230, 0.16)`

### Label Placement
```
for i in 0..xTicks:
    lf = i / xTicks
    labelMs = fromMs + lf × (toMs - fromMs)
    labelX = pLeft + lf × plotW
    drawText(formatTime(labelMs), center: labelX, y: pTop + plotH + 6)
```

---

## 10. Frequency Axis (Y)

### Range
- **0 Hz** (bottom) to **250 Hz** (top) — **inverted**

### Labels
- 6 labels: 250, 200, 150, 100, 50, 0
- Format: bare number (no "Hz" suffix)
- Position: right-aligned at `x = pLeft - 6 - textWidth`

### Grid
- 5 horizontal lines (at each label position)
- Grid color: `rgba(207, 215, 230, 0.16)`

### L-Shape Border
```
path.moveTo(pLeft, pTop)
path.lineTo(pLeft, pTop + plotH)
path.lineTo(pLeft + plotW, pTop + plotH)
```

---

## 11. AI Status Bar

Drawn below the time axis labels.

| aiStatus | Color | Label |
|----------|-------|-------|
| `detected` (1) | `#D13438` (red) | "هدف مكتشف (X%)" |
| `notDetected` (2) | `#21A366` (green) | "لا يوجد هدف (X%)" |
| `possible` (0) | `#F59E0B` (amber) | "هدف محتمل (X%)" |
| unknown | `#8A94A6` (gray) | — |

- Bar Y position: `pTop + plotH + 36`
- Bar height: 28 px (normal) or 14 px (compact)
- Each block rendered as a colored rectangle spanning its time range
- Label shown if segment width ≥ 72 px (normal) or ≥ 50 px (compact)

---

## 12. Constants Reference

| Constant | Value | Meaning |
|----------|-------|---------|
| `dbMin` | `-95.0` | dB range minimum |
| `dbMax` | `-20.0` | dB range maximum |
| `gamma` | `1.0` | Gamma correction (1.0 = none) |
| `noiseThreshold` | `0.06` | Minimum noise gate |
| Histogram bins | `1024` | Histogram resolution |
| Noise floor percentile | `72` | Adaptive threshold percentile |
| Isolated pixel neighborhood | `5×5` (radius 2) | Window for neighbor counting |
| Min active neighbors | `2` | Minimum to keep a pixel |
| Singleton component threshold | `15 px` | Components smaller than this are deleted |
| `colsPerMs` | global average | `Σ columns / Σ milliseconds` across all blocks |
| Image max width | `4096 px` | Matrix columns clamped to this |
| Image max height | `4096 px` | Matrix rows clamped to this |
| Background color | `0xFF111026` | Dark purple |
| Gap fill color | `0x423667C2` | Blue, 26% opacity |
| Gap stroke color | `0xE766C4E7` | Light blue, 90% opacity |
| Gap label min width | `52 px` | Minimum gap width to show text |
| Max frequency | `250 Hz` | Top of Y-axis |
| Y ticks | `5` | Number of horizontal grid lines |
| X ticks | `4–8` | Vertical grid lines (target 120px spacing) |
| Painter left inset | `40 px` | Space for frequency labels |
| Painter right inset | `6 px` | Right padding |
| Painter top inset | `4 px` | Top padding |
| Painter bottom inset | `36 / 50 / 68 px` | Depends on status bar mode |
| Zoom min | `0.05` | Minimum zoom level |
| Zoom max | `4.0` | Maximum zoom level |
| Zoom step | `×1.5` | Zoom in/out multiplier |
| Live window default | `15 min` | Default follow-live window |
| Live window options | `5, 10, 15, 20, 30` min | Available window sizes |
| Polling interval | `8 sec` | How often to poll for new data |
| Max custom range | `2 hours` | Maximum custom range duration |
| Gain range | `-24 to +24 dB` | Display gain slider range |
| Gain divisions | `48` | Slider divisions |
| Marker hit radius | `5 px` | Tap tolerance for marker detection |
| Marker line color | `0xF2FFD60A` | Gold vertical line |
| Marker box background | `0xDC12161E` | Dark label box |
| Marker box height | `27 px` | Label box height |
| Marker lane gap | `8 px` | Vertical gap between overlapping labels |

---

## 13. Common Bugs & How to Fix Using This File

| Symptom | Section | Likely Cause | Fix |
|---------|---------|--------------|-----|
| ~30s blue strip on left side | §8.5 | `requestStartTime` set before first block | Set `requestStartTime = result.first.startTime` |
| No gap shown between two blocks | §8.2 | Coverage intervals not computed from data | Ensure `_buildCoverageIntervals()` uses block start/end times |
| Gap text shows wrong duration | §8.4 | `visCols` or time range wrong | Check `gapMin` formula: `(gapWidth / visCols) × (toMs - fromMs) / 60000` |
| Image appears stretched | §6 | `colsPerMs` mismatch between canvas and isolate | Both must use identical formula: `Σ columns / Σ milliseconds` |
| Colors look inverted | §10 | Y-axis inversion not applied | Row 0 = top freq = bottom of image: `yNative = rows - 1 - row` |
| Colors look wrong/washed out | §5 | Gamma or colormap error | Check `pow(v, gamma)` and magma stops match table in §5 |
| Gap appears after zooming | §8.3 | Cursor sweep using stale viewport columns | Recompute `visStartCol`/`visEndCol` from current viewport |
| Matrix has wrong width | §2 | `totalCols` calculation error | `totalCols = round((toMs - fromMs) × colsPerMs)` |
| Noise floor too aggressive | §3 | Percentile changed or threshold too high | Check 72nd percentile and `noiseThreshold = 0.06` |
| Single-pixel gaps in spectrogram | §3 Step 5 | Gap bridging not applied | Morphological bridge: inactive cell with active above+below → activate |
| Status bar misaligned with data | §11 | Status bar X position not using same time mapping as image | Must use same `fromMs`/`toMs` as the matrix |
| Markers jump when panning | — | Marker timeMs not converted correctly to viewport fraction | `markerFrac = (markerMs - fromMs) / (toMs - fromMs)` |
| Gain doesn't apply instantly | §4 | Using full re-render instead of intensity rebuild | Cache intensity buffer, rebuild image with `gainScale` only |
| Flicker on live updates | — | Full matrix rebuild on every packet | Use `insertPacketLive` — add/sort/remove, rebuild only on change |
