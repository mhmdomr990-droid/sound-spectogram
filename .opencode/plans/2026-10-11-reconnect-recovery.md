# إصلاح: عدم عودة الرسم بعد انقطاع يوم/يومين حتى logout/login

الحالة: بانتظار موافقة المستخدم (وضع التخطيط).

## التشخيص (مؤكَّد بالقراءة)

- JWT ‏`expiresIn: "1d"`؛ `isLoggedIn` (`auth_service.dart:39`) = وجود التوكن فقط.
- انقطاع يوم/يومين → توكن منتهٍ + فشل REST بـ401 → `error.value` ثابت (شاشة الخطأ)، وفشل `_loadDevices` يترك `selected == null`.
- التعافي الحالي **ناقص**:
  - `_onSocketStatusChanged(connected)` (`dashboard_controller.dart:~166`) يستدعي `_fetchLatestTelemetry` فقط — لا مسح `error` ولا إعادة تحميل.
  - `_healthCheck` بعد refresh ناجح (سطر ~184-188) يستدعي reconnect ثم `return` — لا تعافي للعرض.
  - زر «إعادة المحاولة» في شاشة الخطأ (`dashboard_screen.dart:335`) يستدعي `loadRange()` التي `return` مبكراً لو `selected == null` **قبل** مسح `error` (`dashboard_controller.dart:~476-480`) → زر ميت في حالات كثيرة.
- logout/login يعمل لأنه يبني كل شيء من جديد بتوكن جديد.

## التعديلات (ملفّان — بدون أي تغيير في منطق الرسم/الفجوات/الاستقبال)

### 1. `lib/controllers/dashboard_controller.dart`
- **`void recoverView()`** (عامة، تُستدعى من زر الإعادة):
  ```
  if (loadingDevices.value || loadingHistory.value) return;
  if (devices.isEmpty) → _loadDevices();   // يمسح error في البداية ويعيد الجلب بتوكن محدَّث
  else → loadRange();                       // يمسح error ثم يعيد تحميل النطاق (يعرف التعامل مع followLive)
  ```
  لا مسح `error` مباشرة يدوياً — المسح يحدث داخل المسارين الناجحين، وعند الفشل يُعاد ضبط رسالة جديدة (لا فقدان المعلومة).
- **تعافي بعد (إعادة)اتصال السوكت:** تتبّع `_wasDisconnected`:
  - في مستمع الحالة: عند `disconnected` → `_wasDisconnected = true`؛
  - عند `connected` و`_wasDisconnected == true` → `_wasDisconnected = false` ثم `await recoverView()`.
  - أول اتصال للتطبيق (بدون قطع سابق) لا يُشغّل التعافي (الراية false) → لا تحميل مزدوج عند الإقلاع.
  - ملاحظة: مع توكن منتهٍ يرفض الخادم المصافحة → `onConnectError` يبثّ disconnected ✓ فتصبح الراية true، وبعد refresh+reconnect يصل connected → تعافي بتوكن جديد ✓.
- **تعافي بعد refresh ناجح في `_healthCheck`:** بعد `refreshed != null` (في كلا الفرعين) استدعاء `recoverView()` — يغطي حالة: السوكت ما زال متصلاً لكن REST يفشل بـ401 (الخادم لا يقتل الاتصال الحيّ).

### 2. `lib/screens/dashboard_screen.dart` (سطر واحد)
- زر «إعادة المحاولة»: `onPressed: () => c.loadRange()` → `onPressed: () => c.recoverView()`.

## التحقق
1. `flutter analyze` = 74 (خط الأساس).
2. golden 11/11 + warp.
3. بناء profile → تثبيت على هواوي (`adb -s H9YNW20A29001562`).
4. اختبار عملي مُختصر لسيناريو الانقطاع:
   - أطفئ الواي فاي/الشبكة مع التطبيق مفتوح → انتظر حتى تظهر رسالة خطأ أو يتوقف العرض → أعد الشبكة → **≤60 ث** يعود الرسم تلقائياً دون logout/login.
   - اختبار الزر: مع حالة خطأ، ضغط «إعادة المحاولة» يعيد التحميل فعلاً (حتى لو كانت قائمة الأجهزة فارغة).
   - (اختبار انتهاء التوكن الحقيقي يحتاج يوماً كاملاً — لكنه يمر بنفس مسار التعافي المُختبر أعلاه).

## خارج النطع
- مشروع الويب قراءة فقط (لا تعديل `expiresIn` أو أي سلوك خادم).
- لا تعديل: `spectrogram_canvas.dart`، منطق الفجوات، `insertPacketLive`، استقبال الحزم، `buildRgba`.
