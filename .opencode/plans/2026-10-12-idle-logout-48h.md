# تسجيل خروج تلقائي إذا مضت 48 ساعة بعد آخر خروج من التطبيق

## السلوك المطلوب (بموافقة المستخدم: مسح كامل مثل الخروج اليدوي)
- العدّاد يبدأ من **آخر خروج من التطبيق** (آخر مرة يذهب فيها للخلفية/يُغلق)، وليس آخر فتح.
- عند الإطلاق البارد: إذا مضت **≥ 48 ساعة** على آخر خروج → مسح كامل (توكن + مستخدم + اسم/كلمة/سيرفر المحفوظة) → شاشة الدخول.
- الطابع يُجدَّد أيضاً عند **العودة للمقدمة** والاستخدام المستمر → استخدام نشِط لا يُسجَّل خروجاً ولا يسبب تسجيل خروج (يُختم عند كل تحوّل paused/resumed).
- ساعة عكسية متقدمة (`stamp > now`) → معاملة كمنتهية (تسجيل خروج).
- غير مسجّل الدخول → تجاهل، مجرد تحديث الطابع.

## التعديلات

### 1. `flutter_app/lib/controllers/auth_controller.dart`
- ثابت `_lastExitKey = 'last_exit_at'` (SharedPreferences — epoch ms).
- دالة static `enforceIdleLogoutOnLaunch(AuthService auth, {Duration maxIdle = 48h})`:
  - قراءة `last` من prefs؛ `expired = last != null && (now - last ≥ maxIdle || last > now)`.
  - إن `expired && auth.isLoggedIn` → `auth.logout()` + حذف `_savedUsernameKey`/`_savedPasswordKey`/`_savedServerKey` + حذف كلمة المرور من `_secure` (نفس تسلسل `logout()` اليدوي).
  - دائماً: `prefs.setInt('last_exit_key', now)`؛ إرجاع `expired`.
  - static (بدون GetX) لتجنّب سباق مع `onInit`.
- دالة static `stampExit()` — تختتم الوقت الحالي في نفس المفتاح (تُستدعى من دورة الحياة).

### 2. `flutter_app/lib/main.dart`
- بعد `auth.load()` وقبل بدء `AppForegroundService` و`runApp`:
  `await AuthController.enforceIdleLogoutOnLaunch(auth);`
  → الخدمة لا تُشغَّل لجلسة منتهية؛ `isLoggedIn` تقرأ false → `/login`.
- تحويل `SpectroApp` إلى StatefulWidget مع `WidgetsBindingObserver`:
  - `didChangeAppLifecycleState`: عند `paused` (خروج للخلفية) و`resumed` (عودة) → `AuthController.stampExit()` (يحتاج Get.find بعد التسجيل — يُنفَّذ بعد `Get.put`).

### 3. `flutter_app/pubspec.yaml`
- `1.0.3+4` → `1.0.4+5`.

## التحقق
- `flutter analyze` = 73 خط الأساس.
- بناء release → تنصيب على الهواوي → نسخة على سطح المكتب (`spectro_phone_1.0.4+5.apk`).

## خارج النطاق
- لا تعديلات خادم (مدة JWT كما هي).
- لا تعديل شاشة الدخول.
