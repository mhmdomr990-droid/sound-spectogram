# ميزة: تصدير لقطة PNG + بيانات CSV للنطاق الحالي

الحالة: الخطة معتمدة من المستخدم (اختار البديل **أ**) — التنفيذ موقوف حتى خروج وضع التخطيط.

## الهدف
- **PNG**: لقطة للإطار المعروض لحظة الضغط (طبيعتها: عمودية في العادي، أفقي في ملء الشاشة) + **اسم الجهاز والتاريخ/الوقت مطبوعين على الصورة** + **نص caption جاهز** عند المشاركة (كلاهما — معتمد).
- **CSV**: البيانات الخام للمدى المحمّل (تردد × زمن) مع تعليقات AI/العلامات + اسم الجهاز/التاريخ (بالفعل في التعليقات).

## البديل المعتمد (أ)
- لقطة الوضع العادي = عمودية كما يظهر داخل الإطار (بلا شرائح/أزرار).
- **زر تصدير داخل ملء الشاشة أيضاً** (بجانب fit/exit) → للصورة الأفقية: ادخل ملء الشاشة → تصدير.
- لا رسم offscreen، لا تدوير تلقائي، صفر مخاطر ذاكرة.

## القرارات التقنية (من فحص الكود)

- **لقطة PNG**: `RepaintBoundary` حول `SpectrogramCanvas` في `dashboard_screen.dart` + `boundary.toImage()` → PNG. يلتقط ما يظهر فعلاً (canvas يرسم المحور والعلامات داخل الـpainter) — **صفر تأثير على منطق الرسم** (غلاف فقط).
  - `CanvasSeedSnapshot.image` المتوفر في الكود غير مناسب (bitmap خام بلا محور/علامات).
- **CSV** من `c.histories` (`DeviceHistory`: `data` صفوف=ترددات × أعمدة=زمن، `frequencyBins`، `startTime/endTime`، `aiStatus`، `confidence`):
  - صيغة: أول عمود = `frequency_hz` ثم عمود لكل عينة زمنية بتوقيت ISO.
  - دمج الحزم زمنياً (ترتيب حسب `startTime`، التوقيت لكل عمود = `startTime + i/(cols-1)*المدة`).
  - تعليقات `#`: الجهاز، النطاق، وقت التصدير، كل باكت (aiStatus/confidence)، العلامات (markers).
  - **حد حماية**: لو مجموع الأعمدة > 2000 → decimate بـstride (مذكور في التعليق) لتفادي ملفات ضخمة (آخر ساعة ≈ 12 ألف عمود).
- **الحفظ/المشاركة**: الحزم المطلوبة غير موجودة في `pubspec.yaml` → إضافة `path_provider` + `share_plus` (حفظ في مستندات التطبيق ثم مشاركة عبر أي تطبيق — يتجنب مشاكل أذونيات التخزين).

## التعديلات

### 1. `pubspec.yaml`
- إضافة: `path_provider: ^2.1.5`، `share_plus: ^11.0.0` (متوافقان مع Dart ^3.13.1).

### 2. `lib/utils/export_service.dart` (جديد)
- `Future<void> exportPng(BuildContext context, GlobalKey boundaryKey, {required String deviceName})`:
  1. `RenderRepaintBoundary` → `toImage(pixelRatio: devicePixelRatio)` → `toByteData(png)`.
  2. **شريط المعلومات (ما بعد الالتقاط، بلا تعديل للودجت)**: `decodeImageFromBytes` → `PictureRecorder` → رسم الصورة + شريط أسود شفاف أسفلها (≈10% من الارتفاع، `Color(0x8A000000)`) + `TextPainter` يميناً: `deviceName` ويساراً: تاريخ/وقت التصدير (`yyyy-MM-dd HH:mm`) — دعم RTL وخط النظام.
  3. `toImage` → encode PNG → ملف `spectrogram_<name>_yyyyMMdd_HHmmss.png`.
  4. `Share.shareXFiles([XFile(path)], text: '<deviceName> — <yyyy-MM-dd HH:mm>')` ← caption جاهز.
  5. snackbar نجاح/فشل عربي.
- `Future<void> exportCsv(BuildContext context, List<DeviceHistory> histories, {String? deviceName})`:
  - بناء السلسلة (أعلاه) مع stride عند اللزوم → ملف CSV → مشاركة نص `'<deviceName> — <yyyy-MM-dd HH:mm>'` مع الملف.
- **ملاحظة**: الشريط يُرسم على الصورة النهائية فقط → صفر تأثير على الرسم/`golden` (لا لمس للودجت). معامل `deviceName` يمرَّر من الشاشة (`c.selected.value?.name ?? 'unknown'`).

### 3. `lib/screens/dashboard_screen.dart`
- لفّ `SpectrogramCanvas` (داخل Stack الرئيسي ~سطر 362) بـ`RepaintBoundary(key: _exportBoundaryKey)`.
- زر «تصدير» في شريط الأدوات (`_buildRangeControls` — أيقونة `Icons.save_alt` بجانب «إزالة العلامات»):
  - الضغط → bottom sheet: **«لقطة PNG» / «بيانات CSV» / «كلاهما» / «إلغاء»**.
- لا تعديل لأي منطق موجود (زر إضافي فقط + غلاف RepaintBoundary).

### 4. `lib/screens/fullscreen_spectrogram.dart`
- لفّ `SpectrogramCanvas` (Positioned.fill ~سطر 127) بـ`RepaintBoundary(key: _fsExportBoundaryKey)`.
- زر تصدير (`Icons.save_alt`) في صف أزرار `_fsBtn` (~سطر 292) → نفس الـbottom sheet (أو نافذة منبثقة ملائمة للوضع الأفقي).
- نفس الخدمة `exportService` (تمرير المفتاح + `deviceName` من `Get.find<DashboardController>().selected.value?.name`) — للصورة الأفقية من ملء الشاشة، **مع الشريط وال caption أيضاً**.

## التحقق
1. `flutter analyze` = خط الأساس (74).
2. golden 11/11 + warp (يتأكد أن الغلاف لا يؤثر على الرسم).
3. بناء release + سطح المكتب + تنصيب هواوي (حسب عادتنا).
4. يدوياً: تصدير PNG من الوضع العادي → عمودي = ما يظهر + **شريط سفلي باسم الجهاز والتاريخ/الوقت**؛ PNG من ملء الشاشة → أفقي مع الشريط نفسه؛ المشاركة تفتح ورقة الأندرويد فوراً مع **caption جاهز** (`Pi-01 — 2026-10-11 10:05`) على واتساب/تلغرام؛ CSV → يفتح في Excel/Sheets، الأعمدة الزمنية صحيحة، stride مذكور لو طُبّق.

## خارج النطاق
- لا تعديل: `spectrogram_canvas.dart` (منطق الرسم)، الفجوات، الاستقبال، الويب.
- لا أذونات تخزين جديدة (المشاركة تتكفل بالوجهة).
