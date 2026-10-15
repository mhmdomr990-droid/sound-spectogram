# نقل خوارزمية الرسم والألوان من الويب الجديد إلى Flutter — نطاق كامل

## القرارات
- **النطاق: كامل** — فك PNG + 13 خريطة + خوارزمية Sonic + noiseLevel + imageColorIntensity + تسميات تكيفية.
- **واجهة كاملة**: منتقي خريطة + منزلق ضوضاء + منزلق شدة لون في الداشبورد.

## المصدر
`/home/mhmd/Desktop/New Folder 1/sound_raspi_dashboard` (HEAD=74dbb18).

## المراحل

### المرحلة 1 — التوافق: فك png-gray-v1 (إلزامي)
`lib/models/device_history.dart`:
- في `decodeMatrixPayload`: إذا `format == 'png-gray-v1'` → فك `payload` (base64) كـPNG رمادي 8-bit:
  - تحقق توقيع PNG + IHDR (colorType=0, bitDepth=8, interlace=0).
  - اجمع IDAT → `ZLibDecoder` (من حزمة `archive` الموجودة) → unfilter لكل صف (مرشحات 0-4: None/Sub/Up/Average/Paeth — مطابق `png-gray.ts`).
  - صفوف PNG: 0 = أعلى الصورة. مع `rowOrder == 'descending'` → اعكس الصفوف (مثل الويب).
- `intensityType` الافتراضي لباكتات PNG: `uint8` (الموجود يبقى إن أرسله الخادم).

### المرحلة 2 — الألوان: 13 خريطة + colorMap عبر الخط
`lib/utils/spectro.dart`:
- استبدال `_magmaStops` بجدول `Map<String, List<ColorStop>>` يحوي الـ13 خريطة (magma, sunset, svsunset, sonic→svsunset, green, viridis, inferno, turbo, highgain, cherry, ice, gray, cividis) — نفس stops/values من `spectrogram.js:39-160`.
- `buildPaletteLut(colorMap, gamma)` بدل الافتراض magma.
- الافتراضي: `sonic`.

### المرحلة 3 — خوارزمية Sonic (استخراج القمم + الرسم)
`lib/utils/spectro.dart` + `spectro_isolate.dart` + `spectrogram_canvas.dart`:
- نقل `processSonicMatrix` إلى Dart (ثوابت: LOCAL_BINS=6, PROMINENCE=0.03, NOISE_FACTOR=1.5, SILENCE=0.04, TIME_TOLERANCE=max(2,⌈rows/150⌉), DB_RANGE=60, MAX_SCALE=8):
  - لكل عمود: normalize → max العمود (silence gate) → excess فوق المستوى المحلي (±6 bins، prefix-sum) → قمم (v[r]>v[r−1] ∧ v[r]≥v[r+1] ∧ excess>need) → إسقاط الوحيدة (لا قمة ±tolerance في العمود المجاور) → strength=value/top (أو dB) + offset بمنحنى تربيعي.
- الرسم: في `_applyGainAndBuildImage`/مسار isolate — إذا colorMap==sonic: رسم القمم كـsub-rows (حتى 8) بإزاحةها، مباشرة على مستوى العرض (بما فيها اللوق — نفس منطق sonic-log).
- **الافتراضي**: colorMap=sonic → نفس مظهر الويب افتراضياً.

### المرحلة 4 — noiseLevel + effectiveGamma + imageColorIntensity
- `effectiveGamma = gamma × (1 − 0.65 × noiseRelease)` حيث `noiseRelease = level≥10 ? 1 : level/10` (level=0 → release=0).
- LUT يُبنى من effectiveGamma (256 لون — تغيير رخيص).
- `imageColorIntensity` (−5..+5، افتراضي **+5**): في مسار رسم الصور — calmer: خلط مع لون الخلفية بنسبة؛ stronger: تعزيز القمم (نفس معادلة الويب `calm`/`vivid` ≈ spectrogram.js:2515).

### المرحلة 5 — تسميات محور لوق تكيفية
`lib/utils/log_axis.dart` + `spectrogram_canvas.dart`:
- للوق: خطوات أرقام دائرية [10,20,50,100,200,500,1000,2000,5000] — أصغر خطوة تحافظ على ≈32px بين تسميتين (حسب ارتفاع الرسم الفعلي) — مطابق `log-frequency-labels.js` الجديد.

### المرحلة 6 — واجهة التحكم (داشبورد)
- **منتقي خريطة لونية**: قائمة/صف أيقونات (13 خريطة، معاينة لون صغيرة) — يحفظ في SharedPreferences (`colorMap`) ويطبق فوراً (LUT فقط، لا إعادة حساب).
- **منزلق ضوضاء 0..10** (`noiseLevel`، محفوظ) → effectiveGamma.
- **منزلق شدة لون −5..+5** (`imageColorIntensity`، محفوظ، افتراضي +5).
- تمرير القيم الثلاثة عبر `WarpRequest`/طلب الرسم → isolate → LUT/رسم.
- لا تعديل الويب — flutter_app فقط.

## التحقق
1. `flutter analyze` = 73 خط الأساس (ملفاتي نظيفة).
2. `flutter test test/buildrgba_golden_test.dart test/warp_display_test.dart` — golden **قد يحتاج تحديثاً** إذا تغيّر LUT magma الافتراضي → تحديث ملفات golden بعد مراجعة (التغيير المقصود: sonic افتراضي؛ golden magma يبقى صالحاً إن ثبّت colorMap=magma في الاختبار).
3. اختبار وحدة جديد صغير لفك PNG (متجهة صغيرة معروفة).
4. بناء release → تنصيب على الهواوي → مقارنة بصرية مع الويب بنفس الباكتات.

## خارج النطاق
- تعديل مشروع الويب/الخادم.
- ميزة A/B compare وimage-tiles cache (كامل مسار الويب للصور) — الرسم عبر خط Flutter الحالي مع القمم/الألوان الجديدة يكفي المظهر.
