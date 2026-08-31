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
normalizeValue()                  تطبيع حسب intensityType
    │
    ▼
SpectrogramCanvas._render()       تجهيز الكتل وتجميع الأبعاد
    │
    ▼
SpectroIsolate.render()           قمع الضوضاء + تطبيق الكسب + رسم البكسلات
    │                              (يعمل في isolate منفصل)
    ▼
decodeImageFromPixels(RGBA8888)   تحويل البايتات إلى ui.Image
    │
    ▼
build()                           عرض RawImage + CustomPaint للمحاور
```

---

## 1. تحميل البيانات (`device_history.dart`)

### صيغة البيانات المقبولة

المصفوفة يمكن أن تكون:
- **قائمة مباشرة** `List<List<double>>` — تُحوَّل مباشرة
- **خريطة gzip** `{ format: "gzip-base64-json-v1", data: "..." }` — تُفك بـ base64 → gzip → JSON

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

---

## 2. تجهيز الكتل (`spectrogram_canvas.dart`)

### دالة `_render()`

```dart
Future<void> _render() async
```

**الخوارزمية:**
1. زيادة `_generation` للكشف عن التقادم
2. تصفية الكتل الفارغة
3. لكل DeviceHistory:
   - حساب `intensityRange` (min/max عالمي لكلية)
   - تطبيع كل قيمة: `normalizeValue(raw, type, min, max)`
   - تتبع: `maxRows` (أكبر عدد صفوف)، `totalCols` (مجموع الأعمدة)، أول `frequencyBins`非null، أقدم/أحدث طابع زمني
4. استدعاء `SpectroIsolate.render(blocks: ..., width: totalCols, height: maxRows)`
5. إذا الويجت لا يزال mounted والـ generation مطابق: `setState(() => _image = image)`

**ملاحظة مهمة:** أبعاد الصورة الناتجة = `totalCols x maxRows` — أي **بكسل واحد لكل عينة بيانات** عند الدقة الأصلية. الزووم يُطبَّق عبر التكبير في العرض فقط، لا إعادة رسم.

---

## 3. قمع الضوضاء (`spectro_isolate.dart`)

### الدخول

```dart
static Future<ui.Image> render({
  required List<List<List<double>>> blocks,  // كتل مطبّعة مسبقاً
  required List<List<double>> colorMap,
  double gainDb = 0.0,
  double noiseThreshold = 0.06,
  required int width,       // عرض صورة الناتج بالبكسل
  required int height,      // ارتفاع صورة الناتج بالبكسل
})
```

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
              [0] Positioned(left: 32, top: 0)
                    RawImage(image, fit: BoxFit.fill, filterQuality: medium)
              [1] Positioned.fill
                    CustomPaint(painter: SpectrogramAxesPainter)
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

---

## 8. المحاور والشبكة (`spectrogram_axes_painter.dart`)

### الثوابت

| القيمة | المعنى |
|---|---|
| `left = 32.0` | هامش يسار لأرقام التردد |
| `topPad = 0.0` | لا هامش علوي |
| `bottomPad = 20.0` | هامش سفلي لتسميات الزمن |
| `yTicks = 5` | 5 خطوط أفقية (6 تسميات) |
| `axisColor = 0xFFCFD7E6` | لون المحاور والحدود |
| `textColor = 0xFFD8E2FF` | لون النصوص |
| `gridColor = 0x29CFD7E6` | لون الشبكة (~16% شفافية) |

### رسم الشبكة

```dart
// خطوط عمودية (4-8 حسب عرض الرسم، مستهدفة ~120px):
xTicks = clamp(floor(plotW / 120), 4, 8)
for tx in 0..xTicks:
  x = left + round(tx / xTicks * plotW)
  drawLine(x, topPad, x, topPad + plotH)

// خطوط أفقية (دائماً 5):
for ty in 0..5:
  y = topPad + round(ty / 5 * plotH)
  drawLine(left, y, left + plotW, y)
```

### حدود L-shape

```dart
path.moveTo(left, topPad)          // أعلى يسار
path.lineTo(left, topPad + plotH)  // أسفل يسار
path.lineTo(left + plotW, topPad + plotH)  // أسفل يمين
```

### تسميات التردد (Y-axis)

```
6 تسميات (0..5):
  yFrac = ly / 5
  yPos = topPad + round(yFrac * plotH)
  إذا frequencyBins موجودة:
    Hz = bins[round(yFrac * (bins.length - 1))]
  وإلا:
    Hz = 24000 - yFrac * 24000
  النص: "${Hz.round()}" بدون "Hz"
  الموضع: x = left - 2 - عرض_النص (محاذاة يمين)
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

## 9. جدول جميع الثوابت

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
| هامش يسار المحاور | `32px` | `spectrogram_axes_painter.dart` |
| هامش أسفل المحاور | `20px` | `spectrogram_axes_painter.dart` |
| تقسيمات Y | `5` | `spectrogram_axes_painter.dart` |
| استهداف مسافة X | `120px` | `spectrogram_axes_painter.dart` |
| نطاق التردد الافتراضي | `0-24000 Hz` | `spectrogram_axes_painter.dart` |
| عتبة التاريخ | `24 ساعة (86400000 ms)` | `spectrogram_axes_painter.dart` |
| لون الخلفية | `0xFF140D28` | `spectrogram_canvas.dart` |
| لون الشبكة | `0x29CFD7E6` (~16%) | `spectrogram_axes_painter.dart` |
