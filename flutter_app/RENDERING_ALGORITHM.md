# خوارزمية رسم المخطط الطيفي (Spectrogram Rendering Algorithm)

> دليل شامل لإعادة تنفيذ الرسم المطابق. يصف كل مرحلة من تحميل البيانات إلى رسم البكسل النهائي.

---

## ملخص Pipeline

```
بيانات JSON خام
    │
    ▼
DeviceHistory.fromJson()          فك ترميز المصفوفة (عادي أو gzip)
    │
    ▼
buildMatrixFromHistories()        تجميع الكتل في مصفوفة واحدة (في العزل)
    │
    ▼
buildRgba()                       قمع الضوضاء + خريطة الألوان + رسم البكسلات
    │                              (يعمل في isolate منفصل)
    ▼
rgbaToUiImage()                   تحويل البايتات إلى ui.Image
    │
    ▼
_SpectroPainter                   رسم الصورة + المحاور + الفجوات + المؤشرات
```

---

## هيكل المشروع

```
flutter_app/lib/
├── main.dart                          # نقطة الدخول + kServerBaseUrl
├── models/
│   ├── device.dart                    # نموذج الجهاز
│   ├── device_history.dart            # نموذج بيانات التاريخ + فك ترميز المصفوفة
│   └── marker.dart                    # نموذج العلامة (MarkerData)
├── screens/
│   ├── login_screen.dart              # شاشة تسجيل الدخول
│   ├── dashboard_screen.dart          # الشاشة الرئيسية مع كل الأوضاع
│   ├── fullscreen_spectrogram.dart    # العرض الكامل أفقي
│   └── notification_settings_screen.dart
├── services/
│   ├── api_client.dart                # HTTP client + JWT auth
│   ├── auth_service.dart              # إدارة JWT + SharedPreferences
│   ├── socket_service.dart            # Socket.IO + device:data
│   └── telegram_service.dart          # تنبيهات تيليجرام
├── utils/
│   ├── spectro.dart                   # خريطة الألوان + تحويل القيم (DO NOT MODIFY)
│   └── spectro_isolate.dart           # بناء المصفوفة + رسم البكسلات في العزل
└── widgets/
    ├── spectrogram_canvas.dart        # الويجت الرئيسي + painter
    └── spectrogram_axes_painter.dart  # محاور (legacy، الدوال الآن في spectrogram_canvas.dart)
```

---

## 1. تحميل البيانات (`device_history.dart`)

### صيغة البيانات المقبولة

المصفوفة يمكن أن تكون:
- **قائمة مباشرة** `List<List<double>>` — تُحوَّل مباشرة
- **خريطة gzip** `{ format: "gzip-base64-json-v1", payload: "..." }` — تُفك بـ base64 → gzip → JSON

### تطبيع القيم (`normalizeValue`)

```dart
static double normalizeValue(double raw, String? intensityType, double min, double max)
```

| intensityType | المعادلة | المدى |
|---|---|---|
| `'db'` | `(raw - (-95)) / ((-20) - (-95))` | خطي من [-95, -20] إلى [0, 1] |
| `'uint8'` | `raw / 255.0` | [0, 255] → [0, 1] |
| `'normalized'` | `clamp(raw, 0, 1)` | يكون أصلاً في [0, 1] |
| `'magnitude'` أو مجهول | `raw <= 1 ? raw : raw / 255` | تلقائي |
| NaN / Inf | `0` | — |

**الثوابت:**
- `dbMin = -95.0`
- `dbMax = -20.0`

### نطاق الشدة (`intensityRange`)

يمسح كل خلايا المصفوفة ويوجد الحد الأدنى والأقصى (يتخطى NaN/Inf). يُرجع `[min, max]` أو `[0, 1]` إذا كانت فارغة.

### AI Status

```dart
enum AiStatus { possible(0), detected(1), notDetected(2) }
```

- **الخادم يُرسل:** `aiStatus` كرقم (0, 1, 2) و `confidence` كـ **String** (مثلاً `"78.20"`)
- **التفسير:** `detected=1` (مكتشف)، `possible=0` (محتمل)، `notDetected=2` (غير مكتشف)

---

## 2. بناء المصفوفة في العزل (`spectro_isolate.dart`)

### `buildMatrixFromHistories(blocks, requestStart, requestEnd)`

**المدخلات:**
- `blocks`: قائمة `HistoryBlock` — كل كتلة تحتوي على `data`, `startTime`, `endTime`, `intensityType`, `minVal`, `maxVal`
- `requestStart`, `requestEnd`: نطاق الوقت المطلوب (ISO 8601)

**الخوارزمية:**
1. تحويل `requestStart`/`requestEnd` إلى ميلي ثانية
2. حساب `colsPerMs = totalDataCols / totalDataMs` (متوسط عام لجميع الكتل)
3. حساب `totalCols = rangeMs * colsPerMs`
4. إنشاء مصفوفة `targetRows x totalCols` مملوءة بـ 0
5. لكل كتلة:
   - حساب `startCol = (blockStart - fromMs) * colsPerMs`
   - حساب `endCol = (blockEnd - fromMs) * colsPerMs`
   - نسخ بيانات الكتلة إلى المصفوفة المشتركة
6. المناطق غير المغطاة تبقى = 0 (هذه هي الفجوات)

**ملاحظة:** `totalCols` قد يكون أكبر من العرض الفعلي للصورة. الصورة تُقص إلى `clamp(totalCols, 1, 4096)`.

---

## 3. قمع الضوضاء (`spectro_isolate.dart`)

### المعالجة لكل كتلة (`_processBlockMatrix`)

7 خطوات لكل كتلة بشكل مستقل:

#### الخطوة 1: هيستوجرام + عتبة

```
_collectNormalizedHistogram(matrix)
```

- **عدد الخانات:** 1024
- يُعايِن المصفوفة بشبكة مصغرة ~64x64 (`rowStep = max(1, rows ~/ 64)`)
- كل قيمة تُطبع إلى [0,1] ثم تُحوَّل لفهرس: `(v * 1023).floor()`
- النسبة المئوية 72: `target = 0.72 * (total - 1)`

**النتيجة:** `threshold = max(quantile_0.72, noiseThreshold)`

#### الخطوة 2: فتح الضوضاء + قناع نشط

```dart
for (r, c) in matrix:
  if matrix[r][c] < threshold:
    matrix[r][c] = 0.0
  mask[r][c] = matrix[r][c] > 0
```

#### الخطوة 3: إزالة هيكليّة (Morphological Erosion)

- **نواة:** 3x3
- **الشرط:** الخلية تبقى فقط إذا >= **3** من جيرانها الـ 9 (بما فيها نفسها) نشطون في القناع
- **الحدود:** الصف الأول والأخير، العمود الأول والأخير → تُصفَّر دائماً

```dart
int activeNeighbors = 0;
for (dr in -1..1):
  for (dc in -1..1):
    if mask[r+dr][c+dc]: activeNeighbors++
if activeNeighbors < 3: mask[r][c] = false
```

#### الخطوة 4: إزالة بكسلات معزولة (2 جولات)

**الثوابت:**
- `neighborhoodSize = 5` (نصف قطر = 2)
- `minActiveNeighbors = 2`

**الخوارزمية لكل خلية:**
1. عدّ الجيران النشطين في نافذة 5x5
2. إذا >= 2 → الخلية تبقى
3. إذا < 2 → تحقق من "دعم خطي": هل يوجد جيران نشطان في اتجاهين متعاكسين (أعلى/أسفل أو يمين/يسار)؟
4. إذا لا شيء من ذلك → تُحذف

**إزالة المكونات الصغيرة:**
- اتصال 8-المتداخل
- BFS/DFS لجمع حجم كل مكون
- المكونات < **15 بكسل** → تُحذف

**تُكرَّر الخطوة 4 مرتين** (2 passes).

#### الخطوة 5: ربط الفجوات (`_bridgeThinGaps`)

```dart
if inactive cell has active neighbors above AND below → activate
if inactive cell has active neighbors left AND right → activate
```

#### الخطوة 6: بناء المصفوفة المصفّاة

```dart
for each cell:
  if mask[r][c]: denoised[r][c] = matrix[r][c]
  else:          denoised[r][c] = 0.0
```

---

## 4. تطبيق الكسب (`_applyGain`)

```dart
double _applyGain(double value, double gainDb) {
  if (gainDb == 0 || value <= 0) return value;
  final scale = pow(10.0, gainDb / 20.0).toDouble();
  return (value * scale).clamp(0.0, 1.0);
}
```

**المعادلة:** `scale = 10^(gainDb / 20)` — تحويل dB إلى مقياس خطّي للسعة.

**كيفية التطبيق:**
- الصورة مُ.bnّية عند `gainDb = 0` (البيانات الأصلية)
- `ValueNotifier<double>` مشترك بين Dashboard و Fullscreen
- عند تغيير الكسب: `_onGainChanged()` يعيد بناء الصورة فقط (لا إعادة render كاملة)
- `SpectroRgbaResult` يُرجع `intensity` buffer + `gamma` للسماح بإعادة تطبيق الكسب لاحقاً

---

## 5. خريطة الألوان (`spectro.dart`)

### الخرائط المتاحة

```dart
// كل خانة: [position, R, G, B] — position في [0,1]، RGB في 0..255
kColorMapMagma = [
  [0.0,    0,   0,   4],
  [0.16,  28,  16,  68],
  [0.33,  79,  18, 123],
  [0.5,  129,  37, 129],
  [0.66, 181,  54, 122],
  [0.83, 229,  80, 100],
  [1.0,  252, 253, 191],
];

kColorMapSunset = [
  [0.0,  15,  16,  50],
  [0.2,  45,  24, 105],
  [0.4,  98,  33, 135],
  [0.6, 170,  52, 112],
  [0.8, 235,  96,  70],
  [1.0, 255, 190,  92],
];

kColorMapGrayscale = [
  [0.0,   0,   0,   0],
  [1.0, 255, 255, 255],
];
```

### `colorMapToColor(colorMap, value) -> [R, G, B]`

```dart
1. v = pow(clamp01(value), gamma)    // gamma = 1.0 حالياً = لا تغيير
2. إذا v <= أول خانة → أرجع لون الخانة الأولى
3. إذا v >= آخر خانة → أرجع لون الخانة الأخيرة
4. وإلا: ابحث عن الخانتين a, b المحصورتين
   t = (v - a.position) / (b.position - a.position)
   R = lerp(a.R, b.R, t)
   G = lerp(a.G, b.G, t)
   B = lerp(a.B, b.B, t)
```

**`lerp(a, b, t) = a + (b - a) * t`**

---

## 6. رسم البكسلات (حلقة العزل)

### المعادلات الأساسية

```dart
// لكل بكسل في صورة الناتج (px, py):
rowIndex = clamp(dataHeight - 1 - floor(py * dataHeight / height), 0, dataHeight - 1)
colIndex = clamp(floor(px * dataWidth / width), 0, dataWidth - 1)
value = combined[rowIndex][colIndex]
color = colorMapToColor(colorMap, _applyGain(value, gainDb))
bytes[offset]     = R
bytes[offset + 1] = G
bytes[offset + 2] = B
bytes[offset + 3] = 0xFF
```

**ملاحظات:**
- **Y مقلوب:** الصف 0 في البيانات = أعلى تردد = يظهر في **أسفل** الصورة
- **استرجاع أقرب جار** (nearest-neighbor): لا توجد مرشّحات تداخل
- **التنسيق:** RGBA8888 (4 بايتات لكل بكسل)

---

## 7. العرض (`spectrogram_canvas.dart`)

### تレイوت البناء

```
Container (خلفية: 0xFF140D28)
  Stack:
    [0] SingleChildScrollView (أفقي)
          SizedBox (عرض = max(العرض_المتاح, displayWidth + 34))
            Stack:
              [0] Positioned(left: 40, top: 4)
                    CustomPaint (SpectrogramAxesPainter)
    [1] Positioned(top: 8, right: 8)
          Column(أزرار الزووم)
```

### حساب الأبعاد

```dart
imageAreaHeight = containerHeight - 24        // 24px أسفل للمحاور
nativeHeight = imageAreaHeight                 // ارتفاع الصورة الأصلي
aspectRatio = img.width / img.height
nativeWidth = nativeHeight * aspectRatio
displayWidth = nativeWidth * zoomLevel
displayHeight = nativeHeight * zoomLevel
```

### الزووم

| الإجراء | المعادلة |
|---|---|
| `zoomIn()` | `_zoomLevel = (_zoomLevel * 1.5).clamp(0.05, 4.0)` |
| `zoomOut()` | `_zoomLevel = (_zoomLevel / 1.5).clamp(0.05, 4.0)` |
| `fitToScreen()` | `_zoomLevel = ((w - 34) / nativeWidth).clamp(0.05, 4.0)` |

**المدى:** [0.05, 4.0]، خطوة x1.5

### الزووم اللمسي (Pinch)

```dart
// onScaleUpdate مع pointerCount == 2:
newSpan = _scaleStart / details.scale
newStart = center - newSpan * anchor
newEnd = newStart + newSpan
// الحدود: newStart >= -(newSpan * 0.8)، newEnd <= 1.0 + newSpan * 0.8
```

### السحب (Pan)

```dart
// onScaleUpdate مع pointerCount == 1:
shift = dx / w * span
newStart = _viewportStart - shift
newEnd = _viewportEnd - shift
```

### Seed Snapshot (للعرض الكامل)

```dart
class CanvasSeedSnapshot {
  final ui.Image? image;
  final Uint8List? cachedIntensity;
  final int intensityWidth;
  final int intensityHeight;
  final double cachedGamma;
  // ... أخرى
}
```

- يُنشأ عند كل render جديد
- يُمرَّر إلى FullscreenSpectrogram لتجنب إعادة الرسم من الصفر
- يحتوي على صورة + بيانات الشدة الخام + gamma

---

## 8. الفجوات الزمنية

### خوارزمية حساب الفجوات (`_buildCoverageIntervals`)

```dart
List<CoverageInterval> _buildCoverageIntervals() {
  // 1. fromMs = requestStartTime أو أول startTime في البيانات
  // 2. toMs = requestEndTime أو آخر endTime في البيانات
  // 3. colsPerMs = مجموع أعمدة الكتل / مجموع مدة الكتل
  // 4. لكل كتلة:
  //    startCol = ((blockStart - fromMs) * colsPerMs).round()
  //    endCol = ((blockEnd - fromMs) * colsPerMs).round()
  //    → CoverageInterval(startMs: startCol, endMs: endCol)
}
```

**Fallback** (إذا لم تتوفر الأوقات): تstack الكتل بجانب بعضها دون فجوات.

### رسم الفجوات في `_SpectroPainter.paint()`

```
// 2b) Gap overlays (بعد رسم الصورة، قبل المحاور)
1. حساب gapScale = image.width / totalCols
2. تحويل coverageIntervals إلى م positions في الصورة
3. دمج التداخل (merge)
4. الم.delta = gaps = الفراغات بين الـ intervals المدمجة
5. لكل gap:
   - رسم مستطيل أزرق شفاف: Color(0x423667C2) — alpha = 26%
   - رسم خطوط جانبية: Color(0xE766C4E7)
   - كتابة النص: "لا توجد بيانات X د" (إذا عرض >= 52px)
```

### الثوابت

| القيمة | المعنى |
|---|---|
| `_gapFill = Color(0x423667C2)` | لون ملء الفجوة (أزرق، 26% شفافية) |
| `_gapStroke = Color(0xE766C4E7)` | لون حدود الفجوة |
| `_gapTextStyle.fontSize = 11` | حجم خط النص |

---

## 9. المحاور والشبكة

### الثوابت

| القيمة | المعنى |
|---|---|
| `left = 40` | هامش يسار لأرقام التردد |
| `right = 6` | هامش يمين |
| `top = 4` | هامش علوي |
| `bottom = 36` | هامش سفلي (عادي) |
| `bottom = 50` | هامش سفلي (مع شريط حالة مدمج) |
| `bottom = 68` | هامش سفلي (مع شريط حالة كامل) |
| `_yTicks = 5` | 5 خطوط أفقية (6 تسميات) |
| `_maxFrequency = 250` | أعلى تردد (Hz) |

### رسم الشبكة

```dart
// خطوط عمودية (4-8 حسب عرض الرسم، مستهدفة ~120px):
xTicks = clamp(floor(plotW / 120), 4, 8)
for tx in 0..xTicks:
  x = left + round(tx / xTicks * plotW)
  drawLine(x, top, x, top + plotH)

// خطوط أفقية (دائماً 5):
for ty in 0..5:
  y = top + round(ty / 5 * plotH)
  drawLine(left, y, left + plotW, y)
```

### حدود L-shape

```dart
path.moveTo(left, top)          // أعلى يسار
path.lineTo(left, top + plotH)  // أسفل يسار
path.lineTo(left + plotW, top + plotH)  // أسفل يمين
```

### تسميات التردد (Y-axis)

```
6 تسميات (0..5):
  yFrac = ly / 5
  yPos = topPad + round(yFrac * plotH)
  Hz = 250 - yFrac * 250
  النص: "${Hz.round()}" بدون "Hz"
  الموضع: x = left - 6 - عرض_النص (محاذاة يمين)
```

### تسميات الزمن (X-axis)

```
totalMs = endTime - startTime
إذا totalMs > 86400000 (24 ساعة): الصيغة "YYYY-MM-DD HH:MM"
وإلا: "HH:MM"

xTicks خطوط عمودية (4-8):
  lf = lx / xTicks
  labelX = left + round(lf * plotW)
  النص: منسق حسب lf
  الموضع: وسط أسفل كل tick
```

---

## 10. شريط حالة AI

### الألوان

| الحالة | اللون | الكود |
|---|---|---|
| `detected` (مكتشف) | أحمر | `Color(0xFFD13438)` |
| `notDetected` (غير مكتشف) | أخضر | `Color(0xFF21A366)` |
| `possible` (محتمل) | أصفر | `Color(0xFFF59E0B)` |
| `unknown` | رمادي | `Color(0xFF8A94A6)` |

### الرسم

```
// 8) AI Status bar (تحو عناوين الزمن)
- barY = pTop + plotH + 36
- barHeight = compactStatusBar ? 14 : 28
- لكل كتلة تاريخ:
  - تحديد الموضع الأفقي بناءً على startTime/endTime
  - رسم مستطيل باللون المناسب
  - كتابة النص + الثقة (مثلاً "مكتشف (78.2%)")
  - إذا عرض >= 50px (compact) أو >= 72px (عادي): يظهر النص
```

---

## 11. المؤشرات (Markers)

### النموذج

```dart
class MarkerData {
  final int timeMs;   // الوقت بالميلي ثانية
}
```

### الإجراءات

| الإجراء | الطريقة |
|---|---|
| **إضافة** | نقر مزدوج على الخط |
| **حذف** | نقر على الخط |
| **تحريك** | سحب من الخط أو صندوق التسمية |

### التقاطع (`_markerHitTest`)

```dart
// يتحقق: هل النقر على خط مؤشر؟
// يحسب: mx = pLeft + ((dataFrac - viewportStart) / span) * plotW
// يقارن: |position.dx - mx| < 5.0
```

### التقاطع مع صندوق التسمية (`_markerLabelHitTest`)

```dart
// يتحقق: هل النقر على صندوق التسمية؟
// يستخدم laneY و boxLeft و boxW و boxH منLogica الرسم
```

### رسم الخطوط والتصنيفات

```dart
// لكل marker مرئي:
1. رسم خط عمودي ذهبي: Color(0xF2FFD60A)
2. حساب وقت UTC → تحويل إلى محلي
3. تنسيق: "YYYY-MM-DD HH:MM:SS"
4. حساب موضع صندوق التسمية مع تجنب التداخل (lane system)
5. رسم صندوق: خلفية Color(0xDC12161E) + حدود ذهبية
```

### نظام Lane (تجنب التداخل)

```dart
const boxH = 27.0;
const laneGap = 8.0;
final laneBoxes = <_LaneBox>[];

// لكل marker:
laneY = labelTop
for (lb in laneBoxes):
  if horizontallyOverlap && laneY < lb.bottom + laneGap:
    laneY = lb.bottom + laneGap
laneBoxes.add(_LaneBox(left: boxLeft, bottom: laneY + boxH, width: boxW))
```

---

## 12. البث المباشر (Follow-live)

### أوضاع العرض

```dart
enum _RangeMode { latestPacket, lastHour, last5h, last24h, followLive, custom }
```

### تدفق البث المباشر

```
1. المستخدم يضغط "متابعة البث"
   → _setFollowLive() يستدعي fetchHistory() مع النطاق الحالي
   → يبدأ التصويت (polling) كل 5 ثوانٍ

2. Socket يُرسل device:data
   → _dataSub يستقبل الحزمة
   → يتحقق: deviceId مطابق + followLiveActive + ليس قيد التحميل
   → يتحقق من التكرار باستخدام _historyKeys ("$deviceId|$startTime|$endTime")
   → إذا كان قيد التحميل → يُخزّن في _pendingLivePackets
   → وإلا → _insertPacketLive(h)

3. _insertPacketLive(h):
   → يتحقق من aiStatus == detected → يُرسل تنبيه تيليجرام
   → يُضيف الحزمة إلى _histories
   → يُرتب حسب startTime
   → يُصفّي حسب _liveWindowMinutes (الحد الأقصى)
   → يحدث _requestStartTime و _requestEndTime
   → يحدث _liveDataNotifier
   → يستدعي forceRender()

4. Polling (كل 5 ثوانٍ):
   → fetchLatest() → إذا حزمة جديدة → _insertPacketLive()
```

### النافذة الزمنية

- القيم المتاحة: 5, 10, 15, 20, 30 دقيقة
- القيمة الافتراضية: 15 دقيقة
- `_requestStartTime = anchor - liveWindowMinutes`
- `_requestEndTime = anchor` (آخر endTime)

---

## 13. العرض الكامل (Fullscreen)

### الخصائص

- **اتجاه أفقي** (landscapeLeft/landscapeRight)
- **_immersiveSticky** (إخفاء شريط الحالة)
- **illo Shared gainNotifier** — نفس الكسب من Dashboard
- **illo Shared markers** — يُعاد عند الخروج

### التحكم

- **زر ملء الشاشة** (fitToScreen)
- **زر الخروج** (fullscreen_exit) → يُرجع FullscreenResult
- **شريط كسب مدمج** (Slider -24 إلى 24 dB)

### Seed Snapshot

```dart
// عند فتح Fullscreen:
// 1. يأخذ seedSnapshot من Dashboard
// 2. يمرر: seedImage, seedIntensity, seedGamma, etc.
// 3. SpectrogramCanvas يستخدم هذه البيانات كنقطة بداية
// 4. لا إعادة render من الصفر
```

---

## 14. الاتصال بالسيرفر

### `kServerBaseUrl`

```dart
const String kServerBaseUrl = 'http://172.20.20.92:3111';
```

### AuthService

- **التخزين:** SharedPreferences (`auth_token`, `auth_user`)
- **التحميل:** `load()` عند بدء التطبيق
- **ال_guard:** `isLoggedIn = token != null && token.isNotEmpty`

### ApiClient

| الدالة | Endpoint | الملاحظات |
|---|---|---|
| `fetchDevices()` | `GET /api/devices` | قائمة الأجهزة |
| `fetchLatest(path, id)` | `GET /api/devices/{id}/history/latest?decode=1` | آخر باكت |
| `fetchHistory(id, from, to)` | `GET /api/devices/{id}/history?from=...&to=...` | بدون decode=1 (العميل يفك الترميز) |

**ملاحظة مهمة:** `fetchHistory` لا يرسل `decode=1` لتجنب خطأ `decodeMatrix` على السيرفر. الترميز يتم client-side عبر `decodeMatrixPayload` في `DeviceHistory.fromJson`.

### SocketService

| الحدث | الاتجاه | البيانات |
|---|---|---|
| `connect` | → السيرفر | `{ token: "..." }` |
| `device:subscribe` | → السيرفر | `{}` |
| `device:data` | ← السيرفر | `DeviceHistory` payload |
| `check_ai_status` | → السيرفر | `{ startTime, endTime }` |
| `check_ai_status` (ack) | ← السيرفر | `{ ok: true, data: { items: [...] } }` |

**التوصل:** WebSocket (`ws://`)
**المصادقة:** JWT token في `opts.auth`

### TelegramService

- يُرسل تنبيهات عند `aiStatus == detected`
- يُرسل تنبيهات تغيير حالة التوصيل

---

## 15. جدول جميع الثوابت

| الثابت | القيمة | الموقع |
|---|---|---|
| `dbMin` | `-95.0` | `device_history.dart` |
| `dbMax` | `-20.0` | `device_history.dart` |
| `gamma` | `1.0` | `spectro.dart` |
| `noiseThreshold` (افتراضي) | `0.06` | `spectro_isolate.dart` |
| عدد خانات الهيستوجرام | `1024` | `spectro_isolate.dart` |
| حجم عينة الهيستوجرام | `~64x64` | `spectro_isolate.dart` |
| النسبة للعتبة | `0.72` (72%) | `spectro_isolate.dart` |
| عتبة الإزالة الهيكلية | `>= 3 من 9` جيران | `spectro_isolate.dart` |
| نصف قطر Neighborhood | `2` (نافذة 5x5) | `spectro_isolate.dart` |
| الحد الأدنى للجيران النشطين | `2` | `spectro_isolate.dart` |
| جولات إزالة المعزول | `2` | `spectro_isolate.dart` |
| حد المكونات الصغيرة | `15` بكسل | `spectro_isolate.dart` |
| الزووم الأدنى | `0.05` | `spectrogram_canvas.dart` |
| الزووم الأعلى | `4.0` | `spectrogram_canvas.dart` |
| خطوة الزووم | `x1.5` | `spectrogram_canvas.dart` |
| هامش يسار المحاور | `40px` | `spectrogram_canvas.dart` |
| هامش يمين المحاور | `6px` | `spectrogram_canvas.dart` |
| هامش علوي المحاور | `4px` | `spectrogram_canvas.dart` |
| هامش سفلي (عادي) | `36px` | `spectrogram_canvas.dart` |
| هامش سفلي (مدمج) | `50px` | `spectrogram_canvas.dart` |
| هامش سفلي (كامل) | `68px` | `spectrogram_canvas.dart` |
| تقسيمات Y | `5` | `spectrogram_canvas.dart` |
| أعلى تردد | `250 Hz` | `spectrogram_canvas.dart` |
| استهداف مسافة X | `120px` | `spectrogram_canvas.dart` |
| عتبة التاريخ | `24 ساعة (86400000 ms)` | `spectrogram_canvas.dart` |
| لون الخلفية | `0xFF140D28` | `spectrogram_canvas.dart` |
| لون الفجوة | `0x423667C2` (26% شفافية) | `spectrogram_canvas.dart` |
| لون حدود الفجوة | `0xE766C4E7` | `spectrogram_canvas.dart` |
| لون خط المؤشر | `0xF2FFD60A` (ذهبي) | `spectrogram_canvas.dart` |
| لون صندوق المؤشر | `0xDC12161E` (خلفية) | `spectrogram_canvas.dart` |
| عرض الصورة الأقصى | `4096` بكسل | `spectro_isolate.dart` |
| Polling interval | `5` ثوانٍ | `dashboard_screen.dart` |
|/max custom range | `2` ساعة | `dashboard_screen.dart` |
| live window choices | `5, 10, 15, 20, 30` دقيقة | `dashboard_screen.dart` |
| Gain range | `-24` إلى `24` dB | `dashboard_screen.dart` |
| Gain divisions | `48` | `dashboard_screen.dart` |

---

## اتفاقية تحديث هذا الملف

> **عند أي تعديل على التطبيق** (خوارزمية رسم، فيتشر جديد، تغيير ثوابت، إضافة شاشة):
> 1. حدّث هذا الملف ليعكس التغيير
> 2. أضف سطر في "سجل التغييرات" أدناه
> 3. لا تحذف أي معلومات موجودة — أضف فقط

### سجل التغييرات

| التاريخ | التغيير | المسؤول |
|---|---|---|
| 2026-09-09 | الإنشاء الأولي — تغطية كاملة للخوارزمية والفيتشرات | AI |
| 2026-09-09 | إزالة وضع الاختبار بالكامل (test_data.dart + أزرار + route) | AI |
| 2026-09-09 | إصلاح اختفاء الماركر فوراً في الوضع العادي (lastMarkerAddedAt guard) | AI |
