# إصلاح: تحديث ترقيم المحور (maxFrequency/focusHz) لا يظهر في وضع ملء الشاشة
# + خفض مهلات التحديث من 60 ث إلى 30 ث

الحالة: بانتظار موافقة المستخدم (وضع التخطيط). المستخدم اختار «الاثنان معاً».

## التشخيص (مؤكَّد بالقراءة)

- `_openFullscreen` (`dashboard_screen.dart:285-310`) يمرر `maxFrequency: c.selected.value?.maxFrequency` و`focusHz: c.focusHz.value` **ك snapshots ثابتة** لحظة فتح الـroute.
- `FullscreenSpectrogram` route منفصل **خارج Obx** الرئيسية ⇒ تحديث `selected`/`focusHz` من `refreshDevicesMeta` (كل 60 ث) لا يُعيد بناءه إطلاقاً.
- داخل `fullscreen_spectrogram.dart` تُمرَّر `widget.maxFrequency`/`widget.focusHz` ثابتة إلى `SpectrogramCanvas` (سطر 151-153) — `widget` لا تتغير ⇒ لا `didUpdateWidget` ⇒ لا warp.
- `logFrequencyView` داخل ملء الشاشة حالة محلية (`_logFrequencyView`) مع sync عند الخروج — **تبقى كما هي** (لا تعارض مع Obx).

## التعديل (نقطة واحدة)

### `lib/screens/fullscreen_spectrogram.dart`
- لفّ `SpectrogramCanvas` داخل الـbuilder الحالي بـ`Obx` يقرأ مباشرة من المتحكّم (إن كان مسجّلاً):
  ```dart
  Obx(() {
    final c = Get.isRegistered<DashboardController>()
        ? Get.find<DashboardController>() : null;
    return SpectrogramCanvas(
      ...نفس المعطيات الحالية...,
      maxFrequency: c?.selected.value?.maxFrequency ?? widget.maxFrequency,
      focusHz: c?.focusHz.value ?? widget.focusHz,
      logFrequencyView: _logFrequencyView,  // يبقى محلياً كما هو
      ...
    );
  })
  ```
- الاستيرادات: `package:get/get.dart` + `../controllers/dashboard_controller.dart`.
- الـObx تقرأ `selected` + `focusHz` فقط ⇒ أي تغيير فيهما (ولو أثناء فتح ملء الشاشة) يُعيد بناء الـcanvas → `didUpdateWidget` → شرط `axisChanged` (الذي أضفناه سابقاً يشمل `maxFrequency`) → warp واحد ✓.
- بدون تغيير: المنطق، الفجوات، الاستقبال، seed data، sync الخروج.

### `lib/controllers/dashboard_controller.dart` — خفض المهلات 60 → 30 ث
- `_devicesMetaTimer` (refreshDevicesMeta): `Duration(seconds: 60)` → `Duration(seconds: 30)`.
- `_telemetryTimer` (_fetchLatestTelemetry): `Duration(seconds: 60)` → `Duration(seconds: 30)`.
- **لا تغيير** لـ`_healthTimer` (30 ث أصلاً).
- الأثر: طلبان صغيران كل 30 ث فقط — بلا تكلفة رسم (الحارس يمنع إعادة البناء عند عدم اختلاف القيم) — أسرع استجابة للشريحة والترقيم.

## التحقق
1. `flutter analyze` = 74.
2. golden 11/11 + warp.
3. بناء profile → تثبيت على هواوي.
4. تجربة: افتح ملء الشاشة ← من الويب غيّر `maxFrequency` لجهاز (مثلاً 500) ← خلال ≤60 ث يتحدّث الترقيم داخل ملء الشاشة مباشرة (وأيضاً `تركيز حتى` لو غيّرته من الشاشة الرئيسية والمكملة مفتوحة).

## خارج النطع
- لا تعديل: `spectrogram_canvas.dart`، منطق الرسم/الفجوات/الاستقبال، الويب.
