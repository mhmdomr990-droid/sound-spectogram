# إصلاح: تغيير ترقيم محور التردد (maxFrequency) لا يظهر إلا بعد logout/login

الحالة: بانتظار موافقة المستخدم على الخروج من وضع التخطيط والتنفيذ.

## التشخيص (مؤكَّد بالقراءة)

- المستخدم يعدّل `maxFrequency` للجهاز من الويب (`src/views/dashboard.ejs:416-418` حقول min/max) → ترقيم المحور الأسلى (0..500).
- التطبيق يجلب قائمة الأجهزة **مرة واحدة فقط** في `onInit` (`dashboard_controller.dart:83` → `_loadDevices` سطر 396) — لا تحديث لاحق ⇒ `selected.value?.maxFrequency` قديمة حتى logout/login (مثبّت جديد يعيد `onInit`) ✓ يطابق العَرَض تمامًا.
- حتى بعد تحديث القائمة: `SpectrogramCanvas.didUpdateWidget` **بلا شرط `maxFrequency`** (يوجد `logChanged` لـ `logFrequencyView`/`focusHz` فقط — سطر ~534) ⇒ المحور لا يعيد warp حتى render غير مرتبط.
- مصدر الترقيم فعلياً: `_effectiveMaxFreq()` (`spectrogram_canvas.dart:245`) = `widget.maxFrequency` أولاً ثم `frequencyBins` من البيانات ثم 250.

## التعديلات (3 نقاط، ملفّين)

### 1. `lib/controllers/dashboard_controller.dart`
- إضافة `Future<void> refreshDevicesMeta()`:
  - `final result = await api.fetchDevices();`
  - تحديث `devices.value = result` (مع الحفاظ على `selected` بالـid نفسه: استبدال بكائن جديد من النتيجة حتى تصل `maxFrequency` الجديدة).
  - **حراسة عدم التأثير على الرسم:** استبدال `selected.value` يتم **فقط** عند اختلاف القيم المؤثرة (`maxFrequency`/`name`/...) عن الحالية — وإلا لا تُمس `selected` إطلاقاً ⇒ في اللحظات العادية لا Obx rebuild ولا رسم (صفر تكلفة).
  - **بدون** استدعاء `loadRange()` (لا إعادة جلب تاريخ) وبدون مسح `error`/`loadingHistory` — فشل صامت لا يوقف العرض.
  - لو `selected` لم يعد موجوداً في النتيجة → اختر الأول كما في `_loadDevices`.
- استدعاؤها كل 60 ث: `Timer.periodic` جديد `_devicesMetaTimer` (يُلغي في `onClose`) — أو دمجها في موعد التلمتري القائم; يُفضل مؤقت مستقل بسيط.
- الـObx في `dashboard_screen.dart:323` يقرأ `c.selected.value` ✓ ⇒ إعادة البناء تحدث تلقائياً **عند التغيير فقط**.

### 2. `lib/widgets/spectrogram_canvas.dart`
- في `didUpdateWidget` (~سطر 534): إضافة `oldWidget.maxFrequency != widget.maxFrequency` إلى شرط المحور وإعادة تسمية `logChanged` → `axisChanged` ⇒ `_queueGainBuild()` (يُنتج warp جديد بترقيم 0..500).

### 3. لا تعديل في الويب (قراءة فقط).

## التحقق
1. `flutter analyze` = 74 (خط الأساس).
2. `flutter test test/buildrgba_golden_test.dart test/warp_display_test.dart` → 11/11 + pass.
3. بناء profile → تثبيت Waydroid.
4. اختبار فعلي: من الويب غيّر `maxFrequency` جهاز إلى 500 → **≤60 ث** يتحدّث ترقيم المحور في التطبيق دون logout/login؛ ثم اختبار عكسي (رجوع 200).
5. التأكد أن «تركيز حتى» + «عرض لوغاريتمي» ما زالت تعمل (لم تتتأثر).

## ملاحظات
- بديل مؤقت للمستخدم: logout/login يعمل (سيبقى كذلك) — الإصلاح يجعله غير ضروري.
- إن أراد المستخدم تحديثاً فورياً بلا انتظار 60 ث → إضافة زر تحديث في الشاشة (خيار ثانوي، يُنفذ عند الطلب).
